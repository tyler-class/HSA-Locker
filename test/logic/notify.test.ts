import { describe, expect, it } from 'vitest';
import {
  docLine,
  notifiedIds,
  pendingReview,
  reviewKey,
  reviewNotice,
  type ReviewDoc,
} from '../../src/shared/logic';

const now = new Date('2027-03-10T15:00:00Z');
const doc = (p: Partial<ReviewDoc> = {}): ReviewDoc => ({
  id: 'd1',
  kind: 'receipt',
  filename: 'scan.pdf',
  processed_at: '2027-03-10T14:50:00Z',
  reasons: ['bad_amount'],
  provider: 'Lakeside Pediatrics',
  ...p,
});

describe('Needs review: words', () => {
  it('one document says what and why, and links to it', () => {
    expect(reviewNotice([doc()])).toEqual({
      kind: 'review',
      key: 'd1',
      title: 'Needs review',
      body: 'Receipt from Lakeside Pediatrics: amount looks wrong',
      url: '/review/d1',
      tag: 'review-d1',
    });
  });

  it('several become one notification to Review', () => {
    const n = reviewNotice([doc({ id: 'c' }), doc({ id: 'a' }), doc({ id: 'b' })])!;
    expect(n.body).toBe('3 documents need review');
    expect(n.url).toBe('/review');
    expect(n.key).toBe('a b c');
    expect(n.tag).toBe('review-a');
  });

  it('nothing pending, no notification', () => {
    expect(reviewNotice([])).toBeNull();
  });

  it('words each kind of document and reason', () => {
    expect(docLine(doc({ kind: 'eob', reasons: ['unknown_patient', 'low_confidence'] }))).toBe(
      'EOB from Lakeside Pediatrics: patient not recognized, and 1 more',
    );
    expect(docLine(doc({ provider: null, reasons: ['missing_date'] }))).toBe(
      'Receipt: no date found',
    );
    expect(
      docLine(doc({ kind: 'unknown', provider: null, reasons: ['scanned_pdf_unsupported'] })),
    ).toBe('scan.pdf: scanned PDF: no text to read');
    expect(docLine(doc({ kind: null, provider: null, reasons: ['extraction_failed'] }))).toBe(
      'scan.pdf: couldn’t read this document',
    );
    expect(docLine(doc({ reasons: [] }))).toBe('Receipt from Lakeside Pediatrics needs review');
  });
});

describe('Needs review: which documents', () => {
  const since = '2027-03-01T00:00:00Z';

  it('only documents read since the device signed up, within the last 3 days', () => {
    const docs = [
      doc({ id: 'new' }),
      doc({ id: 'before-device', processed_at: '2027-02-20T00:00:00Z' }),
      doc({ id: 'four-days', processed_at: '2027-03-06T14:00:00Z' }),
      doc({ id: 'never-read', processed_at: null }),
    ];
    expect(
      pendingReview(docs, { notified: new Set(), deviceSince: since, now }).map((d) => d.id),
    ).toEqual(['new']);
    // A device that signed up after the document was read doesn't hear about it.
    expect(
      pendingReview(docs, { notified: new Set(), deviceSince: '2027-03-10T14:55:00Z', now }),
    ).toEqual([]);
  });

  it('once per document: ids already in a sent key are left out', () => {
    const keys = [reviewKey(['b', 'a']), reviewKey(['c'])];
    expect(keys).toEqual(['a b', 'c']);
    const notified = notifiedIds(keys);
    expect([...notified].sort()).toEqual(['a', 'b', 'c']);
    const docs = ['a', 'b', 'c', 'd'].map((id) => doc({ id }));
    expect(pendingReview(docs, { notified, deviceSince: since, now }).map((d) => d.id)).toEqual([
      'd',
    ]);
  });
});
