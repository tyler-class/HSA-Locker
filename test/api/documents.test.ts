import { SELF, env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import type { DocumentSummary, Entry, LedgerEntry } from '../../src/shared/types';
import { processDocument } from '../../src/worker/extract/pipeline';
import { Api, ORIGIN, fakePdf, receiptExtraction, session, upload } from './helpers';

let api: Api;

/** Waits for background processing, then makes sure it ran (idempotent). */
async function settle(id: string): Promise<{ document: DocumentSummary; entries: Entry[] }> {
  for (let i = 0; i < 40; i++) {
    const r = await api.get<{ document: DocumentSummary; entries: Entry[] }>(`/documents/${id}`);
    if (!['pending', 'processing'].includes(r.data.document.status)) return r.data;
    if (r.data.document.status === 'pending') await processDocument(env, id);
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('document never settled');
}

beforeAll(async () => {
  api = await session();
  await api.post('/people', { name: 'Sam Example', relationship: 'Self' });
  await api.post('/people', { name: 'Alex', relationship: 'Spouse' });
  await api.patch('/settings', { family_names: ['Example'], hsa_cards: ['4242'] });
});

describe('upload and extraction', () => {
  it('reads a clean receipt into an outstanding entry', async () => {
    const up = await upload(
      api,
      fakePdf('Lakeside Clinic. Amount paid $45.00', receiptExtraction()),
      'visit.pdf',
    );
    expect(up.status).toBe(201);
    const { document, entries } = await settle(up.data.document.id);
    expect(document.status).toBe('processed');
    expect(document.kind).toBe('receipt');
    expect(document.extraction_provider).toBe('fake');
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.amount_cents).toBe(4500);
    expect(e.person_id).toBeTruthy();
    expect(e.provider_id).toBeTruthy();
    expect(e.review_reasons).toEqual([]);
    // List endpoints never include the raw model output.
    const list = await api.get<{ documents: Record<string, unknown>[] }>('/documents');
    expect(JSON.stringify(list.data)).not.toMatch(/extraction_json|FAKE_EXTRACTION/);
  });

  it('stores identical bytes once', async () => {
    const bytes = fakePdf(
      'Same file twice $45.00',
      receiptExtraction({ appointment_date: '2024-01-01' }),
    );
    const a = await upload(api, bytes, 'a.pdf');
    const b = await upload(api, bytes, 'b.pdf');
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.data.duplicate).toBe(true);
    expect(b.data.document.id).toBe(a.data.document.id);
  });

  it('flags an amount that is not printed in the document', async () => {
    const up = await upload(
      api,
      fakePdf(
        'Lakeside Clinic. Amount paid $54.00',
        receiptExtraction({ amount: '45.00', appointment_date: '2024-04-01' }),
      ),
      'typo.pdf',
    );
    const { document, entries } = await settle(up.data.document.id);
    expect(document.status).toBe('needs_review');
    expect(entries[0]!.review_reasons).toContain('amount_not_in_source');
  });

  it('normalizes legacy-style names and flags strangers', async () => {
    const up = await upload(
      api,
      fakePdf('two lines $10.00 $20.00', {
        document_type: 'Receipt',
        line_items: [
          {
            ...receiptExtraction().line_items[0],
            patient_name: 'Example, Alex',
            amount: '10.00',
            appointment_date: '2024-05-01',
          },
          {
            ...receiptExtraction().line_items[0],
            patient_name: 'Jordan Smith',
            amount: '20.00',
            appointment_date: '2024-05-02',
          },
        ],
      }),
      'names.pdf',
    );
    const { entries } = await settle(up.data.document.id);
    const state = await api.get<{ people: { id: string; name: string }[] }>('/state');
    const alex = state.data.people.find((p) => p.name === 'Alex')!;
    expect(entries[0]!.person_id).toBe(alex.id);
    expect(entries[1]!.person_id).toBeNull();
    expect(entries[1]!.review_reasons).toContain('unknown_patient');

    // "Add as alias to X" resolves it.
    const r = await api.post<{ resolved: number }>(`/people/${alex.id}/alias`, {
      alias: 'Jordan Smith',
    });
    expect(r.data.resolved).toBe(1);
  });

  it('keeps EOB lines out of the money and marks HSA-card receipts', async () => {
    const eob = await upload(
      api,
      fakePdf('EOB', {
        document_type: 'EOB',
        line_items: [
          {
            appointment_date: '2024-06-01',
            patient_name: 'Sam Example',
            provider_name: 'Lakeside Physical Ther',
            description: 'NEUROMUSCULAR REEDUCATION 97112',
            amount: '99.00',
            billed: '150.00',
            confidence: 0.9,
          },
          {
            appointment_date: '2024-06-08',
            patient_name: 'Sam Example',
            provider_name: 'Lakeside Physical Ther',
            description: 'THERAPEUTIC EXERCISE 97110',
            billed: '120.00',
            confidence: 0.9,
          },
        ],
      }),
      'eob.pdf',
    );
    const e = await settle(eob.data.document.id);
    expect(e.document.kind).toBe('eob');
    expect(e.entries.map((x) => x.amount_cents)).toEqual([null, null]);
    expect(e.entries[0]!.billed_cents).toBe(15000);

    const hsa = await upload(
      api,
      fakePdf(
        'Paid $80.00 with card 4242',
        receiptExtraction({ amount: '80.00', card_last4: '4242', appointment_date: '2024-07-01' }),
      ),
      'hsa.pdf',
    );
    const h = await settle(hsa.data.document.id);
    expect(h.entries[0]!.excluded_reason).toBe('paid_with_hsa');
    expect(h.entries[0]!.excluded_auto).toBe(true);

    // Removing the card from the list makes it reimbursable again.
    await api.patch('/settings', { hsa_cards: [] });
    const after = await api.get<LedgerEntry>(`/entries/${h.entries[0]!.id}`);
    expect(after.data.excluded_reason).toBeNull();
    await api.patch('/settings', { hsa_cards: ['4242'] });
  });

  it('flags the same visit arriving in a second document', async () => {
    const x = receiptExtraction({ appointment_date: '2024-08-01', amount: '60.00' });
    const a = await upload(api, fakePdf('Visit $60.00 copy A', x), 'a1.pdf');
    await settle(a.data.document.id);
    const b = await upload(api, fakePdf('Visit $60.00 copy B (different bytes)', x), 'a2.pdf');
    const r = await settle(b.data.document.id);
    expect(r.entries[0]!.review_reasons).toContain('possible_duplicate');
    expect(r.entries[0]!.dup_of_entry_id).toBeTruthy();
    // Merge drops the second copy.
    expect((await api.post(`/entries/${r.entries[0]!.id}/merge`)).status).toBe(200);
    expect((await api.get(`/entries/${r.entries[0]!.id}`)).status).toBe(404);
  });

  it('sends unknown documents to review instead of dropping them', async () => {
    const up = await upload(
      api,
      fakePdf('Newsletter', {
        document_type: 'Unknown',
        line_items: [{ flag_for_review: true, additional_notes: 'Marketing' }],
      }),
      'news.pdf',
    );
    const { document, entries } = await settle(up.data.document.id);
    expect(document.status).toBe('needs_review');
    expect(document.review_reasons).toEqual(['not_a_receipt']);
    expect(entries).toHaveLength(0);
  });

  it('reprocessing replaces entries instead of duplicating them', async () => {
    const up = await upload(
      api,
      fakePdf('Again $45.00', receiptExtraction({ appointment_date: '2024-09-09' })),
      'again.pdf',
    );
    await settle(up.data.document.id);
    expect((await api.post(`/documents/${up.data.document.id}/reprocess`)).status).toBe(200);
    const r = await settle(up.data.document.id);
    expect(r.entries).toHaveLength(1);
    expect(await processDocument(env, up.data.document.id)).toBe('skipped');
  });

  it('serves the original only to signed-in users, with safe headers', async () => {
    const up = await upload(
      api,
      fakePdf('File $45.00', receiptExtraction({ appointment_date: '2024-10-10' })),
      'file.pdf',
    );
    const id = up.data.document.id;
    expect((await SELF.fetch(`${ORIGIN}/api/files/${id}`)).status).toBe(401);
    const res = await SELF.fetch(`${ORIGIN}/api/files/${id}`, { headers: { Cookie: api.cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline/);
    await res.arrayBuffer();
  });

  it('refuses files it cannot read', async () => {
    const r = await upload(api, 'hello world', 'notes.txt', 'text/plain');
    expect(r.status).toBe(415);
  });

  it('lets a scanned document be typed in by hand', async () => {
    // A PDF with no text layer and no vision fallback in the fake provider's eyes: no marker.
    const up = await upload(api, '%PDF-1.4\n', 'scan.pdf');
    const r = await settle(up.data.document.id);
    expect(r.document.status).toBe('needs_review');
    const add = await api.post<Entry>(`/documents/${up.data.document.id}/entries`, {
      type: 'receipt',
      service_date: '2024-11-11',
      amount_cents: 2500,
    });
    expect(add.status).toBe(201);
    await api.post(`/documents/${up.data.document.id}/approve`);
    const after = await api.get<{ document: DocumentSummary }>(`/documents/${up.data.document.id}`);
    expect(after.data.document.status).toBe('processed');
  });
});
