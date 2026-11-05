import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { LedgerEntry } from '@shared/types';
import { api } from '../lib/api';
import { formatDate, money } from '../lib/format';
import { useAppState } from '../lib/queries';
import { useSave } from '../lib/useSave';
import { ReasonChips, StatusChip } from './bits';
import { DocPreview } from './DocPreview';
import { bodyFromForm, EntryForm, formFromEntry } from './EntryForm';
import { useToast } from './Toast';
import { GhostButton, PrimaryButton, Sheet } from './ui';
import { useDocument } from '../lib/queries';

/** One entry: every field editable, the original document, and its actions. */
export function EntrySheet({ entry, onClose }: { entry: LedgerEntry | null; onClose: () => void }) {
  return entry ? <EntrySheetBody key={entry.id} entry={entry} onClose={onClose} /> : null;
}

function EntrySheetBody({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const { data: state } = useAppState();
  const doc = useDocument(entry.document_id);
  const [form, setForm] = useState(() => formFromEntry(entry));
  const [formError, setFormError] = useState('');
  const [showDoc, setShowDoc] = useState(false);
  const { run, busy, error } = useSave();
  if (!state) return null;

  async function save(approve = false) {
    const { body, error } = bodyFromForm(form);
    if (error) return setFormError(error);
    setFormError('');
    const ok = await run(async () => {
      await api.patch(`/entries/${entry.id}`, body);
      if (approve) await api.post(`/entries/${entry.id}/approve`);
      return true;
    });
    if (ok) onClose();
  }

  const reimbursed = !!entry.reimbursement_id;
  return (
    <Sheet
      open
      onClose={onClose}
      title={entry.type === 'eob' ? 'EOB line' : `Receipt · ${money(entry.amount_cents)}`}
      sub={
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip entry={entry} />
          {formatDate(entry.service_date ?? entry.payment_date)}
        </span>
      }
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <div className="flex gap-2">
            {entry.review_reasons.length > 0 && (
              <PrimaryButton tone="secondary" disabled={busy} onClick={() => save(true)}>
                Save &amp; approve
              </PrimaryButton>
            )}
            <PrimaryButton disabled={busy} onClick={() => save(false)}>
              Save
            </PrimaryButton>
          </div>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-2 pb-3">
        <ReasonChips reasons={entry.review_reasons} />
        {entry.source_quote && (
          <p className="text-xs text-faint">From the document: “{entry.source_quote}”</p>
        )}
        <EntryForm
          value={form}
          onChange={setForm}
          state={state}
          printed={{ patient: entry.patient_name_raw, provider: entry.provider_name_raw }}
          error={formError || error}
        />
        <div className="flex flex-wrap gap-x-1 border-t border-line pt-2">
          <GhostButton icon="eye" className="-ml-3" onClick={() => setShowDoc((v) => !v)}>
            {showDoc ? 'Hide document' : 'Show document'}
          </GhostButton>
          <a
            href={`/api/files/${entry.document_id}?download=1`}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 text-[15px] text-soft"
          >
            Download
          </a>
          {entry.type === 'receipt' && (
            <GhostButton
              icon={reimbursed ? 'undo' : 'check'}
              disabled={busy}
              onClick={async () => {
                if (reimbursed) {
                  await run(() => api.post('/entries/unreimburse', { ids: [entry.id] }));
                  toast({ text: 'Marked not reimbursed' });
                } else {
                  await run(() =>
                    api.post('/reimbursements', {
                      date: new Date().toISOString().slice(0, 10),
                      entry_ids: [entry.id],
                    }),
                  );
                  toast({ text: 'Marked reimbursed' });
                }
                onClose();
              }}
            >
              {reimbursed ? 'Mark not reimbursed' : 'Mark reimbursed'}
            </GhostButton>
          )}
          {reimbursed && (
            <GhostButton onClick={() => nav(`/reimbursements/${entry.reimbursement_id}`)}>
              View reimbursement
            </GhostButton>
          )}
          <GhostButton
            icon="refresh"
            disabled={busy || reimbursed}
            onClick={async () => {
              if (!confirm('Read this document again? Its entries are replaced (edits are lost).'))
                return;
              await run(() => api.post(`/documents/${entry.document_id}/reprocess`));
              onClose();
            }}
          >
            Reprocess
          </GhostButton>
        </div>
        {showDoc && doc.data && <DocPreview doc={doc.data.document} />}
        {doc.data?.inbox && (
          <p className="text-xs text-faint">
            Emailed from {doc.data.inbox.from_addr} on{' '}
            {formatDate(doc.data.inbox.received_at.slice(0, 10))}
            {doc.data.inbox.subject ? ` · “${doc.data.inbox.subject}”` : ''}
            {doc.data.document.has_eml && (
              <>
                {' · '}
                <a className="text-accent" href={`/api/files/${entry.document_id}?part=eml`}>
                  original email
                </a>
              </>
            )}
          </p>
        )}
        {doc.data && (
          <p className="text-xs text-faint">
            {doc.data.document.filename}
            {doc.data.document.extraction_model
              ? ` · read by ${doc.data.document.extraction_model}`
              : ''}
          </p>
        )}
      </div>
    </Sheet>
  );
}
