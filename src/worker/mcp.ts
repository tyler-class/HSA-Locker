// MCP server: lets any MCP-capable assistant read this household's HSA ledger and record
// reimbursements. Tools call the same REST API the app uses, marked internal because
// OAuthProvider has already checked the assistant's token. No file access in v1.
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { centsToDecimal, entryStatus, filterLedger, type LedgerFilter } from '@shared/logic';
import { EXCLUDED_REASONS, reviewLabel } from '@shared/lookups';
import type { AppState, LedgerEntry, Reimbursement } from '@shared/types';
import type { Totals, YearTotals } from '@shared/logic';
import { app } from './app';
import { INTERNAL } from './auth';

type Call = <T>(method: string, path: string, body?: unknown) => Promise<T>;

class ToolError extends Error {}

function apiCaller(origin: string, env: Cloudflare.Env, ctx: ExecutionContext): Call {
  const internalEnv = { ...env, [INTERNAL]: true };
  return async <T>(method: string, path: string, body?: unknown) => {
    const res = await app.fetch(
      new Request(`${origin}/api${path}`, {
        method,
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
      }),
      internalEnv,
      ctx,
    );
    const data = (await res.json().catch(() => null)) as T & { message?: string };
    if (!res.ok) throw new ToolError(data?.message ?? `Request failed (${res.status}).`);
    return data;
  };
}

const text = (v: unknown) => ({
  content: [
    { type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) },
  ],
});
const fail = (e: unknown) => ({
  content: [
    { type: 'text' as const, text: e instanceof Error ? e.message : 'Something went wrong.' },
  ],
  isError: true,
});

const MONEY_NOTE =
  'Amounts are exact: *_cents fields are integer cents and amount strings are dollars to the cent. Only receipts count toward reimbursable totals; EOB lines are reference only and never count.';

const dollars = (c: number | null) => (c === null ? null : centsToDecimal(c));

function totalsView(t: Totals | YearTotals) {
  return {
    ...('year' in t ? { year: t.year ?? 'undated' } : {}),
    documented: dollars(t.documented_cents),
    reimbursed: dollars(t.reimbursed_cents),
    outstanding_reimbursable: dollars(t.outstanding_cents),
    pending_review: dollars(t.pending_review_cents),
    excluded: dollars(t.excluded_cents),
    receipts: t.receipt_count,
    eob_documents: t.eob_document_count,
    eob_lines: t.eob_line_count,
  };
}

function entryView(e: LedgerEntry, s: AppState) {
  const person = s.people.find((p) => p.id === e.person_id)?.name;
  const provider = s.providers.find((p) => p.id === e.provider_id)?.name;
  const category = s.categories.find((c) => c.id === e.category_id)?.name;
  return {
    id: e.id,
    type: e.type,
    status: entryStatus(e),
    service_date: e.service_date,
    payment_date: e.payment_date,
    patient: person ?? e.patient_name_raw,
    provider: provider ?? e.provider_name_raw,
    description: e.description,
    category: category ?? null,
    ...(e.type === 'receipt'
      ? { amount: dollars(e.amount_cents), amount_cents: e.amount_cents, card_last4: e.card_last4 }
      : {
          billed: dollars(e.billed_cents),
          allowed: dollars(e.allowed_cents),
          plan_paid: dollars(e.plan_paid_cents),
          patient_responsibility: dollars(e.patient_resp_cents),
        }),
    ...(e.excluded_reason ? { excluded_reason: e.excluded_reason } : {}),
    ...(e.reimbursement_id ? { reimbursement_id: e.reimbursement_id } : {}),
    ...(e.review_reasons.length ? { needs_review: e.review_reasons.map(reviewLabel) } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    document: e.doc_filename,
  };
}

const statusEnum = z.enum(['all', 'outstanding', 'reimbursed', 'excluded', 'needs_review']);
const excludedEnum = z.enum(EXCLUDED_REASONS.map(([k]) => k) as [string, ...string[]]);

function buildServer(call: Call) {
  const server = new McpServer({ name: 'hsa-locker', version: '1.0.0' });
  const state = () => call<AppState>('GET', '/state');
  const ledger = async () => (await call<{ entries: LedgerEntry[] }>('GET', '/entries')).entries;
  const find = (
    list: { id: string; name: string; aliases?: string[] }[],
    key: string | undefined,
    what: string,
  ) => {
    if (!key) return null;
    const k = key.trim().toLowerCase();
    const hit =
      list.find((x) => x.id === key) ??
      list.find(
        (x) => x.name.toLowerCase() === k || x.aliases?.some((a) => a.toLowerCase() === k),
      ) ??
      (list.filter((x) => x.name.toLowerCase().includes(k)).length === 1
        ? list.find((x) => x.name.toLowerCase().includes(k))
        : undefined);
    if (!hit)
      throw new ToolError(
        `No ${what} matches “${key}”. Options: ${list.map((x) => x.name).join(', ') || 'none'}.`,
      );
    return hit.id;
  };

  server.registerTool(
    'get_summary',
    {
      description: `Totals for the household's HSA: documented, reimbursed, outstanding reimbursable and pending review, overall and per year. ${MONEY_NOTE} Outstanding never includes amounts still waiting for review.`,
      inputSchema: z.object({ year: z.number().int().optional().describe('Only this year') }),
    },
    async ({ year }) => {
      try {
        const s = await call<{ totals: Totals; years: YearTotals[]; year_basis: string }>(
          'GET',
          '/summary',
        );
        const years = s.years.filter((y) => year === undefined || y.year === year).map(totalsView);
        return text({
          year_basis: s.year_basis,
          all_time: year === undefined ? totalsView(s.totals) : undefined,
          years,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_entries',
    {
      description: `List receipts and EOB lines. Filter by year, person, category, provider, status or text. ${MONEY_NOTE}`,
      inputSchema: z.object({
        year: z.number().int().optional(),
        person: z.string().optional().describe('Name or id'),
        category: z.string().optional(),
        provider: z.string().optional(),
        status: statusEnum.optional().describe('outstanding = reimbursable now'),
        type: z.enum(['all', 'receipt', 'eob']).optional(),
        text: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        const f: LedgerFilter = {
          year: a.year ?? null,
          person: find(s.people, a.person, 'person'),
          category: find(s.categories, a.category, 'category'),
          provider: find(s.providers, a.provider, 'provider'),
          status: a.status ?? 'all',
          type: a.type ?? 'all',
          q: a.text,
        };
        const names = {
          person: new Map(s.people.map((p) => [p.id, p.name])),
          provider: new Map(s.providers.map((p) => [p.id, p.name])),
          category: new Map(s.categories.map((c) => [c.id, c.name])),
        };
        const rows = filterLedger(await ledger(), f, s.settings.year_basis, names);
        const receipts = rows.filter((e) => e.type === 'receipt');
        return text({
          count: rows.length,
          receipts_total: centsToDecimal(receipts.reduce((t, e) => t + (e.amount_cents ?? 0), 0)),
          entries: rows.slice(0, a.limit).map((e) => entryView(e, s)),
          ...(rows.length > a.limit ? { truncated: true } : {}),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_entry',
    { description: `One entry by id. ${MONEY_NOTE}`, inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => {
      try {
        const [s, e] = await Promise.all([
          state(),
          call<LedgerEntry>('GET', `/entries/${encodeURIComponent(id)}`),
        ]);
        return text(entryView(e, s));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_review_queue',
    {
      description:
        'Entries waiting for review, with the reasons. Their amounts are not counted as outstanding until approved.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const [s, r] = await Promise.all([
          state(),
          call<{ entries: LedgerEntry[]; document_ids: string[] }>('GET', '/review'),
        ]);
        return text({
          documents_waiting: r.document_ids.length,
          entries: r.entries.map((e) => entryView(e, s)),
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_reimbursements',
    {
      description: 'Reimbursements recorded so far, newest first, with their totals.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const r = await call<{ reimbursements: Reimbursement[] }>('GET', '/reimbursements');
        return text(r.reimbursements.map((x) => ({ ...x, total: centsToDecimal(x.total_cents) })));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'mark_reimbursed',
    {
      description: `Record an HSA reimbursement covering these receipts (ids from list_entries). Only outstanding receipts can be included; EOB lines can't. Returns the total, to compare with the HSA withdrawal. ${MONEY_NOTE}`,
      inputSchema: z.object({
        entry_ids: z.array(z.string()).min(1).max(500),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Withdrawal date, YYYY-MM-DD'),
        note: z.string().max(300).optional(),
      }),
    },
    async (a) => {
      try {
        const r = await call<Reimbursement>('POST', '/reimbursements', {
          date: a.date,
          note: a.note ?? null,
          entry_ids: a.entry_ids,
        });
        return text({
          reimbursement_id: r.id,
          receipts: r.entry_count,
          total: centsToDecimal(r.total_cents),
          total_cents: r.total_cents,
        });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'unmark_reimbursed',
    {
      description:
        'Take receipts out of their reimbursement (they become outstanding again). A reimbursement left empty is removed.',
      inputSchema: z.object({ entry_ids: z.array(z.string()).min(1).max(500) }),
    },
    async ({ entry_ids }) => {
      try {
        const r = await call<{ changed: number }>('POST', '/entries/unreimburse', {
          ids: entry_ids,
        });
        return text(`Unmarked ${r.changed} receipt${r.changed === 1 ? '' : 's'}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'update_entry',
    {
      description: `Correct an entry's fields. Money is given in integer cents (amount_cents: 4500 = $45.00). person, provider and category take a name or id. ${MONEY_NOTE}`,
      inputSchema: z.object({
        id: z.string(),
        service_date: z.string().nullable().optional(),
        payment_date: z.string().nullable().optional(),
        person: z.string().nullable().optional(),
        provider: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        amount_cents: z.number().int().nullable().optional(),
        card_last4: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
      }),
    },
    async (a) => {
      try {
        const s = await state();
        const patch: Record<string, unknown> = {};
        for (const k of [
          'service_date',
          'payment_date',
          'description',
          'amount_cents',
          'card_last4',
          'notes',
        ] as const)
          if (a[k] !== undefined) patch[k] = a[k];
        if (a.person !== undefined)
          patch.person_id = a.person === null ? null : find(s.people, a.person, 'person');
        if (a.provider !== undefined)
          patch.provider_id =
            a.provider === null ? null : find(s.providers, a.provider, 'provider');
        if (a.category !== undefined)
          patch.category_id =
            a.category === null ? null : find(s.categories, a.category, 'category');
        await call('PATCH', `/entries/${encodeURIComponent(a.id)}`, patch);
        const e = await call<LedgerEntry>('GET', `/entries/${encodeURIComponent(a.id)}`);
        return text({ updated: entryView(e, s) });
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'approve_entry',
    {
      description:
        'Mark an entry in the review queue as checked. Its amount then counts as outstanding (if it is an unreimbursed, non-excluded receipt).',
      inputSchema: z.object({ id: z.string() }),
    },
    async ({ id }) => {
      try {
        await call('POST', `/entries/${encodeURIComponent(id)}/approve`);
        return text('Approved.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'exclude_entry',
    {
      description:
        'Exclude a receipt from reimbursable totals, with a reason: paid_with_hsa (already paid tax-free with the HSA card), not_eligible, or reimbursed_elsewhere. reason null removes the exclusion.',
      inputSchema: z.object({ id: z.string(), reason: excludedEnum.nullable() }),
    },
    async ({ id, reason }) => {
      try {
        await call('PATCH', `/entries/${encodeURIComponent(id)}`, { excluded_reason: reason });
        return text(reason ? `Excluded (${reason}).` : 'Exclusion removed.');
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}

/** The OAuthProvider apiHandler for /mcp. Only reached with a valid token. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    const origin = new URL(request.url).origin;
    const call = apiCaller(origin, env, ctx);
    const handler = createMcpHandler(() => buildServer(call));
    return handler.fetch(request);
  },
};
