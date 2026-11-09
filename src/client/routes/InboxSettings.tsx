// Settings → Inbox: the email setup wizard, live status, forwarding help and verification codes.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Icon } from '../components/Icon';
import { useToast } from '../components/Toast';
import {
  cx,
  ErrorText,
  GhostButton,
  PageHeader,
  PrimaryButton,
  SectionLabel,
  SlideToggle,
  SubHeading,
  Switch,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { useAppState, useInbox } from '../lib/queries';
import { useSave } from '../lib/useSave';

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <GhostButton
      icon={done ? 'check' : 'copy'}
      className="py-1 text-accent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* selectable anyway */
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </GhostButton>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="block overflow-x-auto rounded-lg bg-chip px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-ink select-all">
      {children}
    </code>
  );
}

const OUTCOME: Record<string, string> = {
  received: 'Received',
  accepted: 'Accepted',
  duplicate: 'Already had it',
  rejected: 'Rejected',
  verification: 'Forwarding confirmation',
  ignored: 'Nothing to keep',
  failed: 'Couldn’t read',
};

const REASON: Record<string, string> = {
  unknown_recipient: 'wrong address',
  paused: 'inbox paused',
  too_large: 'too large',
  sender_not_allowed: 'sender not on the allow list',
  daily_cap: 'daily limit reached',
  no_usable_attachments: 'no PDFs or photos',
  empty_message: 'empty',
  too_many_attachments: 'some attachments over the limit',
  store_failed: 'couldn’t store it',
};

/** Hostname that has at least three labels (a subdomain), e.g. hsa-in.example.com. */
function isSubdomain(h: string) {
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/.test(h);
}

interface InboxCheck {
  dns: 'ok' | 'missing' | 'other' | 'unknown';
  mx: string[];
  routing: 'ok' | 'waiting' | 'mismatch';
  other_address: string | null;
}

/** One line of the setup checklist. */
function Check({ state, children }: { state: 'ok' | 'bad' | 'wait'; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cx(
          'mt-0.5 grid h-5 w-5 flex-none place-items-center rounded-full',
          state === 'ok'
            ? 'bg-ok text-white'
            : state === 'bad'
              ? 'bg-warn text-white'
              : 'bg-chip text-faint',
        )}
        aria-label={state === 'ok' ? 'Done' : state === 'bad' ? 'Problem' : 'Not yet'}
      >
        {state === 'ok' ? (
          <Icon name="check" size={13} strokeWidth={2.4} />
        ) : state === 'bad' ? (
          '!'
        ) : (
          ''
        )}
      </span>
      <span className={state === 'ok' ? 'text-ink' : 'text-soft'}>{children}</span>
    </li>
  );
}

export function InboxSettings() {
  const nav = useNavigate();
  const toast = useToast();
  const { data: state } = useAppState();
  const configured = !!state?.settings.inbox_address;
  const inbox = useInbox(configured);
  const check = useQuery({
    queryKey: ['inbox-check', state?.settings.inbox_address],
    queryFn: () => api.get<InboxCheck>('/inbox/check'),
    enabled: configured,
    refetchInterval: (q) =>
      q.state.data?.routing === 'ok' && q.state.data.dns === 'ok' ? false : 10_000,
  });
  const { run, busy } = useSave();
  if (!state) return null;
  const s = state.settings;
  const i = inbox.data;
  const c = check.data;
  const lastAccepted = i?.log.find((l) => l.outcome !== 'rejected');
  const sub = s.inbox_domain ?? 'hsa-in.example.com';
  const apex = sub.split('.').slice(-2).join('.');

  return (
    <div className="pb-16">
      <PageHeader
        title="Inbox"
        back="/settings"
        sub="Forward receipts and EOBs to HSA Locker by email."
      />

      <div className="mx-6 mt-2 flex flex-col gap-3 rounded-xl bg-chip p-4 text-sm">
        <p className="font-medium text-ink">
          All three steps are required, in this order. Mail won’t arrive until they’re done.
        </p>
        <ul className="flex flex-col gap-2">
          <Check
            state={
              !configured
                ? 'wait'
                : c?.dns === 'ok'
                  ? 'ok'
                  : c && c.dns !== 'unknown'
                    ? 'bad'
                    : 'wait'
            }
          >
            1. Subdomain added in Cloudflare
            {configured &&
              c?.dns === 'missing' &&
              ` (no mail records found for ${s.inbox_domain} yet)`}
            {configured &&
              c?.dns === 'other' &&
              ` (${s.inbox_domain} gets mail somewhere else: ${c.mx.join(', ')})`}
          </Check>
          <Check
            state={
              !configured
                ? 'wait'
                : c?.routing === 'ok'
                  ? 'ok'
                  : c?.routing === 'mismatch'
                    ? 'bad'
                    : 'wait'
            }
          >
            2. Routing rule in Cloudflare
            {configured && c?.routing === 'waiting' && ': confirmed when your test email arrives'}
            {c?.routing === 'mismatch' &&
              `: mail arrived for ${c.other_address}, which doesn’t match the address in step 3`}
          </Check>
          <Check state={configured ? 'ok' : 'wait'}>3. Address entered here</Check>
        </ul>
        <p className="text-xs text-faint">
          No domain on Cloudflare? Skip email: uploading works for everything.
        </p>
      </div>

      <SectionLabel icon="settings">1. In Cloudflare: add the subdomain</SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
        <p className="text-soft">
          Pick a <strong className="text-ink">new subdomain</strong> of a domain on your Cloudflare
          account, like <span className="font-mono text-ink">hsa-in.example.com</span>. Never the
          domain itself if it already gets email: that would take over its mail.
        </p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink">
          <li>
            Open the{' '}
            <a
              className="text-accent"
              href="https://dash.cloudflare.com/?to=/:account/:zone/email/routing/overview"
              target="_blank"
              rel="noreferrer"
            >
              Cloudflare dashboard
            </a>{' '}
            → your domain
            {s.inbox_domain ? (
              <>
                {' '}
                (<strong>{apex}</strong>)
              </>
            ) : (
              ''
            )}{' '}
            → <strong>Email → Email Routing</strong>.
          </li>
          <li>
            <strong>Settings → Subdomains</strong>: add the subdomain
            {s.inbox_domain ? (
              <>
                {' '}
                <strong>{s.inbox_domain}</strong>
              </>
            ) : (
              ''
            )}
            .
          </li>
          <li>
            If Cloudflare offers to add records or enable routing for the main domain, skip it.
          </li>
        </ol>
      </div>

      <SectionLabel icon="settings">2. In Cloudflare: create the routing rule</SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink">
          <li>
            In Email Routing, <strong>Routing rules → Custom addresses → Create address</strong>.
          </li>
          <li>
            Address:{' '}
            {s.inbox_address ? (
              <span className="font-mono">{s.inbox_address}</span>
            ) : (
              <>a name at your subdomain (use the same one in step 3)</>
            )}
            .
          </li>
          <li>
            Action <strong>Send to a Worker</strong>, destination <strong>hsa-locker</strong>. Save.
          </li>
        </ol>
      </div>

      <SectionLabel icon="mail">3. Here: enter the same address</SectionLabel>
      <AddressForm
        key={`${s.inbox_local}@${s.inbox_domain ?? ''}`}
        local={s.inbox_local}
        domain={s.inbox_domain}
      />

      {s.inbox_address && (
        <>
          <SectionLabel icon="check">Send a test</SectionLabel>
          <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Code>{s.inbox_address}</Code>
              </div>
              <Copy text={s.inbox_address} />
            </div>
            <p className="text-soft">
              Email a receipt (a PDF or photo) from Gmail or another provider. Sending from a mail
              service that hosts {apex} may keep it internal (Fastmail: set Routing to external).
            </p>
            {lastAccepted ? (
              <p className="flex items-center gap-2 text-ok" role="status">
                <Icon name="check" size={16} /> Received {ago(lastAccepted.received_at)}:{' '}
                {lastAccepted.attachment_count} attachment
                {lastAccepted.attachment_count === 1 ? '' : 's'}, {lastAccepted.document_count}{' '}
                document
                {lastAccepted.document_count === 1 ? '' : 's'} logged.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-soft" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Waiting for the
                first email…
              </p>
            )}
          </div>

          {i && i.verifications.length > 0 && (
            <>
              <SectionLabel icon="review">Verification waiting</SectionLabel>
              <div className="flex flex-col gap-3 px-6 pt-4">
                {i.verifications.map((v) => (
                  <div
                    key={v.id}
                    className="flex flex-col gap-2 rounded-xl bg-warn-tint p-4 text-sm"
                  >
                    <p className="font-medium text-ink">
                      {v.provider} wants to confirm forwarding to HSA Locker ({ago(v.received_at)}).
                    </p>
                    {v.code && (
                      <div className="flex items-center gap-1">
                        <span className="text-soft">Code:</span>
                        <span className="font-mono text-base text-ink">{v.code}</span>
                        <Copy text={v.code} />
                      </div>
                    )}
                    {v.link && (
                      <a
                        className="self-start text-accent"
                        href={v.link}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open the confirmation link
                      </a>
                    )}
                    <GhostButton
                      className="-ml-3 self-start"
                      onClick={() =>
                        run(() => api.post(`/inbox/verifications/${v.id}/dismiss`), [['inbox']])
                      }
                    >
                      Done, hide this
                    </GhostButton>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionLabel icon="mail">Sending receipts</SectionLabel>
          <ForwardingHelp address={s.inbox_address} />

          <SectionLabel icon="inbox">Status</SectionLabel>
          <div className="flex flex-col gap-2 px-6 pt-4 text-sm">
            {s.inbox_paused && (
              <p className="text-warn">
                The inbox is paused: all mail is rejected. Turn it back on under Limits.
              </p>
            )}
            {i && (
              <p className="text-soft">
                Last received {i.last_received_at ? ago(i.last_received_at) : 'never'} · last 30
                days: {i.stats_30d.accepted} accepted, {i.stats_30d.rejected} rejected
              </p>
            )}
            <div className="flex flex-wrap gap-x-1">
              <GhostButton
                icon="refresh"
                className="-ml-3"
                disabled={busy}
                onClick={async () => {
                  if (
                    !confirm(
                      'Make a new address? The current one stops working right away, so update your forwarding rules.',
                    )
                  )
                    return;
                  if (await run(() => api.post('/inbox/rotate'), [['inbox']]))
                    toast({ text: 'New address ready' });
                }}
              >
                Rotate address
              </GhostButton>
              <GhostButton
                icon="play"
                disabled={busy}
                onClick={() => run(() => api.post('/documents/process-now'))}
              >
                Process pending now
              </GhostButton>
              <GhostButton
                icon="undo"
                disabled={busy}
                onClick={() => run(() => api.post('/documents/retry-failed'))}
              >
                Retry failed
              </GhostButton>
            </div>
            <Limits />
            <h3 className="pt-5 pb-1 text-sm font-semibold text-ink">Recent mail</h3>
            <ul className="-mx-6 flex flex-col px-6">
              {(i?.log ?? []).slice(0, 20).map((l) => (
                <li
                  key={l.id}
                  className="flex items-baseline gap-3 border-b border-line py-2 text-xs"
                >
                  <span className="w-20 flex-none text-faint">{ago(l.received_at)}</span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {l.subject || '(no subject)'}
                    <span className="text-faint"> · {l.from_addr}</span>
                  </span>
                  <span
                    className={cx(
                      'flex-none',
                      l.outcome === 'rejected' || l.outcome === 'failed'
                        ? 'text-danger'
                        : 'text-soft',
                    )}
                  >
                    {OUTCOME[l.outcome] ?? l.outcome}
                    {l.reason && REASON[l.reason] ? ` (${REASON[l.reason]})` : ''}
                    {l.document_count ? ` · ${l.document_count}` : ''}
                  </span>
                </li>
              ))}
              {i && !i.log.length && <li className="py-2 text-xs text-faint">No mail yet.</li>}
            </ul>
          </div>
        </>
      )}
      <div className="px-6 pt-6">
        <GhostButton className="-ml-3" icon="back" onClick={() => nav('/settings')}>
          Back to Settings
        </GhostButton>
      </div>
    </div>
  );
}

const LOCAL_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

/** Step 3: the address, as name @ subdomain, matching the Cloudflare routing rule. */
function AddressForm({ local, domain }: { local: string; domain: string | null }) {
  const [name, setName] = useState(local);
  const [sub, setSub] = useState(domain ?? '');
  const { run, busy, error } = useSave();
  const nameOk = LOCAL_RE.test(name);
  const subOk = isSubdomain(sub);
  const changed = name !== local || sub !== (domain ?? '');
  return (
    <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
      <SubHeading>Subdomain</SubHeading>
      <TextInput
        aria-label="Email subdomain"
        placeholder="hsa-in.example.com"
        value={sub}
        onChange={(e) => setSub(e.target.value.trim().toLowerCase())}
      />
      {sub && !subOk && (
        <p className="text-xs text-warn">
          Enter the subdomain (three parts or more), not the domain itself.
        </p>
      )}
      <SubHeading>Address</SubHeading>
      <div className="flex items-center gap-2">
        <TextInput
          aria-label="Address name"
          className="min-w-0 flex-1 font-mono"
          value={name}
          onChange={(e) => setName(e.target.value.trim().toLowerCase())}
        />
        <span className="min-w-0 truncate font-mono text-soft">@{sub || 'subdomain'}</span>
      </div>
      <p className="text-xs text-faint">
        {name && !nameOk
          ? 'Use letters, numbers, dots, dashes or underscores.'
          : 'Must match the routing rule exactly. An easy-to-guess name lets anyone send you documents.'}
      </p>
      <PrimaryButton
        className="self-start"
        disabled={busy || !nameOk || !subOk || !changed}
        onClick={async () => {
          if (
            domain &&
            !confirm(
              `Change the address to ${name}@${sub}? The current one stops working, so the Cloudflare routing rule must match.`,
            )
          )
            return;
          await run(
            () => api.patch('/settings', { inbox_domain: sub, inbox_local: name }),
            [['inbox'], ['inbox-check']],
          );
        }}
      >
        Save address
      </PrimaryButton>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

function Limits() {
  const { data: state } = useAppState();
  const { run, error } = useSave();
  const s = state!.settings;
  const [allow, setAllow] = useState(s.inbox_allowlist.join(', '));
  const num = (key: string, label: string, value: number, min: number, max: number) => (
    <label className="flex items-center gap-3 border-b border-line py-2">
      <span className="min-w-0 flex-1 text-soft">{label}</span>
      <span className="w-24 flex-none">
        <TextInput
          type="number"
          min={min}
          max={max}
          className="py-1.5 text-right tnum"
          defaultValue={value}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isInteger(v) && v >= min && v <= max && v !== value)
              run(() => api.patch('/settings', { [key]: v }));
          }}
        />
      </span>
    </label>
  );
  return (
    <details className="pt-2">
      <summary className="cursor-pointer text-sm font-medium text-ink">Limits</summary>
      <div className="flex flex-col pt-2">
        <div className="flex items-center gap-3 border-b border-line py-2.5">
          <span className="min-w-0 flex-1 text-soft">
            Pause the inbox (rejects all mail, for emergencies)
          </span>
          <Switch
            label="Pause the inbox"
            on={s.inbox_paused}
            onChange={(paused) =>
              run(() => api.patch('/settings', { inbox_paused: paused }), [['inbox']])
            }
          />
        </div>
        {num('inbox_min_kb', 'Skip images smaller than (KB)', s.inbox_min_kb, 0, 5000)}
        {num('inbox_max_attachments', 'Attachments per email', s.inbox_max_attachments, 1, 50)}
        {num('inbox_max_mb', 'Largest email (MB)', s.inbox_max_mb, 1, 25)}
        {num('inbox_daily_cap', 'Emails per day', s.inbox_daily_cap, 1, 1000)}
        <label className="flex flex-col gap-1.5 pt-3">
          <span className="text-soft">Only accept mail from (optional)</span>
          <TextInput
            placeholder="you@example.com, @pharmacy.example"
            value={allow}
            onChange={(e) => setAllow(e.target.value)}
            onBlur={() =>
              run(() =>
                api.patch('/settings', {
                  inbox_allowlist: allow
                    .split(',')
                    .map((x) => x.trim().toLowerCase())
                    .filter(Boolean),
                }),
              )
            }
          />
          <span className="text-xs text-faint">
            Forwarded mail keeps the original sender’s address.
          </span>
        </label>
        <ErrorText>{error}</ErrorText>
      </div>
    </details>
  );
}

function ForwardingHelp({ address }: { address: string }) {
  const [tab, setTab] = useState<'gmail' | 'outlook' | 'fastmail' | 'apple'>('gmail');
  const steps: Record<typeof tab, string[]> = {
    gmail: [
      'Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address. Gmail sends a code to HSA Locker; it shows on this page under “Verification waiting”.',
      'Create a filter that matches only receipts (for example from a pharmacy’s receipt address, with “receipt” in the subject) and choose “Forward it to”.',
    ],
    outlook: [
      'Settings → Mail → Rules → Add new rule. Match only receipts, then “Forward to”.',
      'Some work accounts block forwarding outside the organization.',
    ],
    fastmail: [
      'Settings → Filters & Rules → New rule. Match only receipts, then “Send a copy to”.',
      'Settings → Domains: set Routing to “Always route mail to this domain externally” if the address is on a domain Fastmail hosts.',
    ],
    apple: [
      'iCloud Mail on the web: Settings → Rules → Add a rule. Match only receipts, then forward.',
      'iCloud may ask you to verify the address; the code shows on this page.',
    ],
  };
  return (
    <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
      <p className="text-ink">
        Receipts arrive in your own inbox as usual. Forward the ones you want to{' '}
        <span className="font-mono">{address}</span>.
      </p>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink">
        <li>
          <strong>By hand:</strong> forward the email. The receipt can be an attachment or the email
          itself.
        </li>
        <li>
          <strong>With an AI assistant</strong> that can use your email: ask it to find this week’s
          medical receipts and forward them to the address.
        </li>
      </ul>
      <details>
        <summary className="cursor-pointer text-ink">Optional: forward some automatically</summary>
        <div className="flex flex-col gap-3 pt-3">
          <p className="text-soft">
            Only for senders that send nothing but receipts. Never forward all mail from your
            insurer or doctor: statements and messages would end up in Review.
          </p>
          <SlideToggle<typeof tab>
            label="Email provider"
            value={tab}
            onChange={setTab}
            options={[
              ['gmail', 'Gmail'],
              ['outlook', 'Outlook'],
              ['fastmail', 'Fastmail'],
              ['apple', 'iCloud'],
            ]}
          />
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink">
            {steps[tab].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
      </details>
    </div>
  );
}
