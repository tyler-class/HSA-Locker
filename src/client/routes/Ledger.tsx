import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  entryDate,
  filterFromParams,
  filterLedger,
  filterToParams,
  type LedgerFilter,
} from '@shared/logic';
import { EXCLUDED_REASONS } from '@shared/lookups';
import type { LedgerEntry } from '@shared/types';
import { excludedText, namesFor, ReasonChips, StatusChip } from '../components/bits';
import { EntrySheet } from '../components/EntrySheet';
import { Icon } from '../components/Icon';
import { ReimburseSheet } from '../components/ReimburseSheet';
import { useToast } from '../components/Toast';
import { UploadSheet } from '../components/UploadSheet';
import {
  ActionList,
  cx,
  Empty,
  PageHeader,
  PrimaryButton,
  Sheet,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { money, plural, shortDate } from '../lib/format';
import { useAppState, useLedger, useReimbursements } from '../lib/queries';
import { useSave } from '../lib/useSave';

const selectCls =
  'rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none';

export function Ledger() {
  const [params, setParams] = useSearchParams();
  const filter = filterFromParams(params);
  const { data: state } = useAppState();
  const ledger = useLedger();
  const reimbursements = useReimbursements();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<LedgerEntry | null>(null);
  const [reimburse, setReimburse] = useState<LedgerEntry[] | null>(null);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [upload, setUpload] = useState(false);
  const { run } = useSave();
  const toast = useToast();
  const names = useMemo(() => namesFor(state), [state]);
  const query = params.toString();

  const rows = useMemo(
    () =>
      state && ledger.data
        ? filterLedger(
            ledger.data,
            filterFromParams(new URLSearchParams(query)),
            state.settings.year_basis,
            names,
          )
        : [],
    [ledger.data, state, query, names],
  );
  const years = useMemo(() => {
    if (!state || !ledger.data) return [];
    const set = new Set<string>();
    for (const e of ledger.data)
      set.add(entryDate(e, state.settings.year_basis)?.slice(0, 4) ?? 'undated');
    return [...set].sort().reverse();
  }, [ledger.data, state]);
  if (!state) return null;

  const setFilter = (patch: Partial<LedgerFilter>) => {
    setParams(filterToParams({ ...filter, ...patch }), { replace: true });
    setSelected(new Set());
  };
  const chosen = rows.filter((e) => selected.has(e.id));
  const receiptsTotal = rows
    .filter((e) => e.type === 'receipt')
    .reduce((s, e) => s + (e.amount_cents ?? 0), 0);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="pb-28">
      <PageHeader
        title="Ledger"
        icon="receipt"
        action={
          <PrimaryButton icon="upload" onClick={() => setUpload(true)}>
            Upload
          </PrimaryButton>
        }
        sub={`${plural(rows.length, 'entry', 'entries')} · receipts ${money(receiptsTotal)}`}
      />

      <div className="flex flex-col gap-2 px-5 pt-2">
        <TextInput
          type="search"
          placeholder="Search provider, patient, description, amount"
          value={filter.q ?? ''}
          onChange={(e) => setFilter({ q: e.target.value })}
        />
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          <select
            aria-label="Status"
            className={selectCls}
            value={filter.status}
            onChange={(e) => setFilter({ status: e.target.value as LedgerFilter['status'] })}
          >
            <option value="all">Any status</option>
            <option value="outstanding">Outstanding</option>
            <option value="reimbursed">Reimbursed</option>
            <option value="excluded">Excluded</option>
            <option value="needs_review">Needs review</option>
          </select>
          <select
            aria-label="Year"
            className={selectCls}
            value={filter.year ?? ''}
            onChange={(e) =>
              setFilter({
                year:
                  e.target.value === ''
                    ? null
                    : e.target.value === 'undated'
                      ? 'undated'
                      : Number(e.target.value),
              })
            }
          >
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y === 'undated' ? 'No date' : y}
              </option>
            ))}
          </select>
          <select
            aria-label="Type"
            className={selectCls}
            value={filter.type}
            onChange={(e) => setFilter({ type: e.target.value as LedgerFilter['type'] })}
          >
            <option value="all">Receipts &amp; EOBs</option>
            <option value="receipt">Receipts</option>
            <option value="eob">EOB lines</option>
          </select>
          <select
            aria-label="Person"
            className={selectCls}
            value={filter.person ?? ''}
            onChange={(e) => setFilter({ person: e.target.value || null })}
          >
            <option value="">Everyone</option>
            {state.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Category"
            className={selectCls}
            value={filter.category ?? ''}
            onChange={(e) => setFilter({ category: e.target.value || null })}
          >
            <option value="">Any category</option>
            {state.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Provider"
            className={selectCls}
            value={filter.provider ?? ''}
            onChange={(e) => setFilter({ provider: e.target.value || null })}
          >
            <option value="">Any provider</option>
            {state.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Sort"
            className={selectCls}
            value={filter.sort}
            onChange={(e) => setFilter({ sort: e.target.value as LedgerFilter['sort'] })}
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Largest first</option>
            <option value="amount_asc">Smallest first</option>
            <option value="added_desc">Recently added</option>
          </select>
        </div>
      </div>

      {ledger.isPending ? null : rows.length === 0 ? (
        <Empty title="Nothing matches">Try fewer filters, or upload a receipt.</Empty>
      ) : (
        <ul className="px-5 pt-2" aria-label="Entries">
          <li className="flex items-center gap-3 border-b border-line py-2 text-xs text-soft">
            <input
              type="checkbox"
              aria-label="Select all"
              className="h-4 w-4 accent-[var(--accent)]"
              checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())
              }
            />
            Select all
          </li>
          {rows.map((e) => (
            <li
              key={e.id}
              className={cx(
                'flex items-center gap-3 border-b border-line',
                selected.has(e.id) && 'bg-accent-tint/50',
              )}
            >
              <input
                type="checkbox"
                aria-label="Select"
                className="h-4 w-4 flex-none accent-[var(--accent)]"
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
              />
              <button
                onClick={() => setOpen(e)}
                className="flex min-w-0 flex-1 items-center gap-3 py-3 text-left"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px]">
                    {names.providerOf(e)}
                    {e.type === 'eob' && e.description ? (
                      <span className="text-soft"> · {e.description}</span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-soft">
                    {names.personOf(e)} ·{' '}
                    {shortDate(entryDate(e, state.settings.year_basis)) || 'No date'}
                    {names.categoryOf(e) ? ` · ${names.categoryOf(e)}` : ''}
                    {e.excluded_reason ? ` · ${excludedText(e)}` : ''}
                  </span>
                  {e.review_reasons.length > 0 && <ReasonChips reasons={e.review_reasons} />}
                </span>
                <span className="flex flex-none flex-col items-end gap-1">
                  <span className="text-[15px] tnum">
                    {e.type === 'receipt' ? money(e.amount_cents) : ''}
                  </span>
                  <StatusChip entry={e} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {(reimbursements.data?.length ?? 0) > 0 && (
        <div className="px-5 pt-8">
          <h2 className="pb-1 text-sm font-semibold">Reimbursements</h2>
          {reimbursements.data!.slice(0, 12).map((r) => (
            <Link
              key={r.id}
              to={`/reimbursements/${r.id}`}
              className="flex items-center gap-3 border-b border-line py-2.5 text-sm"
            >
              <span className="flex-1">
                {shortDate(r.date)}
                {r.note ? <span className="text-soft"> · {r.note}</span> : null}
              </span>
              <span className="text-soft">{plural(r.entry_count, 'receipt')}</span>
              <span className="w-24 text-right tnum">{money(r.total_cents)}</span>
              <Icon name="chevRight" size={14} className="text-faint" />
            </Link>
          ))}
        </div>
      )}

      {/* Sticky action bar for the selection; sits above the phone tab bar. */}
      <div
        className={cx(
          'fixed inset-x-0 z-20 px-4 transition-transform md:left-60',
          'bottom-[calc(68px+env(safe-area-inset-bottom,0px))] md:bottom-4',
          chosen.length ? 'translate-y-0' : 'pointer-events-none translate-y-[200%]',
        )}
      >
        <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lg">
          <span className="flex-1 text-sm">
            {chosen.length} selected ·{' '}
            <span className="tnum">
              {money(
                chosen
                  .filter((e) => e.type === 'receipt')
                  .reduce((s, e) => s + (e.amount_cents ?? 0), 0),
              )}
            </span>
          </span>
          <PrimaryButton className="py-2" onClick={() => setReimburse(chosen)}>
            Mark reimbursed
          </PrimaryButton>
          <PrimaryButton tone="secondary" className="py-2" onClick={() => setExcludeOpen(true)}>
            Exclude…
          </PrimaryButton>
          <a
            className="inline-flex items-center gap-1.5 rounded-full bg-chip px-4 py-2 text-[15px] font-medium text-ink"
            href={`/api/export/ledger.csv?${filterToParams(filter).toString()}`}
          >
            Export CSV
          </a>
        </div>
      </div>
      {!chosen.length && rows.length > 0 && (
        <div className="px-5 pt-4">
          <a
            className="text-sm text-accent"
            href={`/api/export/ledger.csv?${filterToParams(filter).toString()}`}
          >
            Export these as CSV
          </a>
        </div>
      )}

      <Sheet
        open={excludeOpen}
        onClose={() => setExcludeOpen(false)}
        title="Exclude from reimbursable"
      >
        <ActionList
          actions={[
            ...EXCLUDED_REASONS.map(([k, label]) => ({
              icon: 'x' as const,
              label,
              onClick: async () => {
                await run(() =>
                  api.post('/entries/bulk', { ids: [...selected], action: 'exclude', reason: k }),
                );
                toast({ text: `Excluded ${plural(selected.size, 'entry', 'entries')}` });
                setExcludeOpen(false);
                setSelected(new Set());
              },
            })),
            {
              icon: 'undo' as const,
              label: 'Remove exclusion',
              onClick: async () => {
                await run(() =>
                  api.post('/entries/bulk', { ids: [...selected], action: 'unexclude' }),
                );
                setExcludeOpen(false);
                setSelected(new Set());
              },
            },
          ]}
        />
      </Sheet>
      <ReimburseSheet
        entries={reimburse}
        onClose={() => setReimburse(null)}
        onDone={() => setSelected(new Set())}
      />
      <EntrySheet entry={open} onClose={() => setOpen(null)} />
      <UploadSheet open={upload} onClose={() => setUpload(false)} />
    </div>
  );
}
