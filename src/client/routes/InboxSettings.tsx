// Settings → Inbox: the email setup wizard, live status, forwarding help and verification codes.
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
};

/** Hostname that has at least three labels (a subdomain), e.g. hsa-in.example.com. */
function isSubdomain(h: string) {
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z]{2,63}$/.test(h);
}

export function InboxSettings() {
  const nav = useNavigate();
  const toast = useToast();
  const { data: state } = useAppState();
  const configured = !!state?.settings.inbox_address;
  const inbox = useInbox(configured);
  const [domain, setDomain] = useState(state?.settings.inbox_domain ?? '');
  const { run, busy, error } = useSave();
  if (!state) return null;
  const s = state.settings;
  const i = inbox.data;
  const waiting = configured && i && !i.last_received_at;
  const lastAccepted = i?.log.find((l) => l.outcome !== 'rejected');

  return (
    <div className="pb-16">
      <PageHeader
        title="Inbox"
        back="/settings"
        sub="Forward receipts and EOBs to HSA Locker by email."
      />

      <SectionLabel icon="inbox">1. Choose an email subdomain</SectionLabel>
      <div className="flex flex-col gap-3 px-6 pt-4 text-sm text-soft">
        <p>
          Use a <strong className="text-ink">new subdomain</strong> of a domain on your Cloudflare
          account, like <span className="font-mono text-ink">hsa-in.example.com</span>. Don’t use a
          domain that already gets email elsewhere: turning on Email Routing for it would take over
          its mail.
        </p>
        <div className="flex gap-2">
          <TextInput
            aria-label="Email subdomain"
            placeholder="hsa-in.example.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
          />
          <PrimaryButton
            disabled={busy || !isSubdomain(domain) || domain === s.inbox_domain}
            onClick={() => run(() => api.patch('/settings', { inbox_domain: domain }))}
          >
            Save
          </PrimaryButton>
        </div>
        {domain && !isSubdomain(domain) && (
          <p className="text-xs text-warn">
            Enter a subdomain (three parts or more), not the domain itself.
          </p>
        )}
        <p className="text-xs text-faint">
          No domain on Cloudflare? Skip this: uploading works for everything.
        </p>
        <ErrorText>{error}</ErrorText>
      </div>

      {s.inbox_address && (
        <>
          <SectionLabel icon="mail">Address</SectionLabel>
          <AddressName key={s.inbox_address} address={s.inbox_address} />

          <SectionLabel icon="settings">2. Point the address at HSA Locker</SectionLabel>
          <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Code>{s.inbox_address}</Code>
              </div>
              <Copy text={s.inbox_address} />
            </div>
            <p className="text-xs text-faint">
              This address is private: anyone who has it can send you documents.
            </p>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-ink">
              <li>
                In the{' '}
                <a
                  className="text-accent"
                  href="https://dash.cloudflare.com/?to=/:account/:zone/email/routing/overview"
                  target="_blank"
                  rel="noreferrer"
                >
                  Cloudflare dashboard
                </a>
                , open the domain <strong>{s.inbox_domain!.split('.').slice(-2).join('.')}</strong>{' '}
                → Email → Email Routing.
              </li>
              <li>
                Under <strong>Settings → Subdomains</strong>, add <strong>{s.inbox_domain}</strong>.
                Cloudflare adds its MX and SPF records for that subdomain only; your main domain’s
                email is untouched.
              </li>
              <li>
                Under <strong>Routing rules → Custom addresses</strong>, create{' '}
                <span className="font-mono">{s.inbox_address}</span> with the action{' '}
                <strong>Send to a Worker</strong>, and pick the Worker <strong>hsa-locker</strong>.
              </li>
            </ol>
          </div>

          <SectionLabel icon="check">3. Send a test</SectionLabel>
          <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
            <p className="text-soft">Email a receipt (a PDF or photo) to the address above.</p>
            {waiting ? (
              <p className="flex items-center gap-2 text-soft" role="status">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Waiting for the
                first email…
              </p>
            ) : lastAccepted ? (
              <p className="flex items-center gap-2 text-ok" role="status">
                <Icon name="check" size={16} /> Received {ago(lastAccepted.received_at)}:{' '}
                {lastAccepted.attachment_count} attachment
                {lastAccepted.attachment_count === 1 ? '' : 's'}, {lastAccepted.document_count}{' '}
                document{lastAccepted.document_count === 1 ? '' : 's'} logged.
              </p>
            ) : null}
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

          <SectionLabel icon="mail">4. Forward automatically</SectionLabel>
          <ForwardingHelp address={s.inbox_address} />

          <SectionLabel icon="inbox">Status</SectionLabel>
          <div className="flex flex-col gap-2 px-6 pt-4 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex-1">Accept new mail</span>
              <Switch
                label="Accept new mail"
                on={!s.inbox_paused}
                onChange={(on) =>
                  run(() => api.patch('/settings', { inbox_paused: !on }), [['inbox']])
                }
              />
            </div>
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
            <SubHeading>Recent mail</SubHeading>
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

/** The part before the @: random by default, or a name the person picks. */
function AddressName({ address }: { address: string }) {
  const [local, domain] = address.split('@') as [string, string];
  const [value, setValue] = useState(local);
  const { run, busy, error } = useSave();
  const valid = LOCAL_RE.test(value);
  return (
    <div className="flex flex-col gap-2 px-6 pt-4 text-sm">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label="Address name"
          className="min-w-0 flex-1 font-mono"
          value={value}
          onChange={(e) => setValue(e.target.value.trim().toLowerCase())}
        />
        <span className="flex-none font-mono text-soft">@{domain}</span>
        <PrimaryButton
          disabled={busy || !valid || value === local}
          onClick={async () => {
            if (
              confirm(
                `Change the address to ${value}@${domain}? The current one stops working, so update the Cloudflare routing rule to match.`,
              )
            )
              await run(() => api.patch('/settings', { inbox_local: value }), [['inbox']]);
          }}
        >
          Save
        </PrimaryButton>
      </div>
      <p className="text-xs text-faint">
        {value && !valid
          ? 'Use letters, numbers, dots, dashes or underscores.'
          : 'A name that’s easy to guess lets anyone send you documents. Rotate makes a random one.'}
      </p>
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
    <label className="flex items-center gap-3">
      <span className="flex-1 text-soft">{label}</span>
      <TextInput
        type="number"
        min={min}
        max={max}
        className="w-24 py-1.5 text-right"
        defaultValue={value}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= min && v <= max && v !== value)
            run(() => api.patch('/settings', { [key]: v }));
        }}
      />
    </label>
  );
  return (
    <details className="pt-2">
      <summary className="cursor-pointer text-sm text-ink">Limits</summary>
      <div className="flex flex-col gap-2 pt-3">
        {num('inbox_min_kb', 'Skip images smaller than (KB)', s.inbox_min_kb, 0, 5000)}
        {num('inbox_max_attachments', 'Attachments per email', s.inbox_max_attachments, 1, 50)}
        {num('inbox_max_mb', 'Largest email (MB)', s.inbox_max_mb, 1, 25)}
        {num('inbox_daily_cap', 'Emails per day', s.inbox_daily_cap, 1, 1000)}
        <label className="flex flex-col gap-1.5 pt-1">
          <span className="text-soft">
            Only accept mail from (optional). Forwarded mail keeps the original sender, so list your
            own address and your insurer’s, or leave empty.
          </span>
          <TextInput
            placeholder="you@example.com, @insurer.example"
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
      `Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address: ${address}.`,
      'Gmail sends a confirmation to HSA Locker. Its code appears on this page under “Verification waiting”. Enter it in Gmail.',
      'Then create a filter (Settings → Filters → Create new filter) for your insurer’s and providers’ senders, choose “Forward it to” this address. Forwarding only what matches keeps the rest of your mail private.',
      'To send one email by hand, just forward it to the address.',
    ],
    outlook: [
      'Outlook.com: Settings → Mail → Rules → Add new rule.',
      `Condition: From is your insurer or provider portal. Action: Forward to ${address}.`,
      'Some Microsoft 365 work accounts block forwarding outside the organization; forward by hand instead.',
    ],
    fastmail: [
      'Settings → Filters & Rules → New rule.',
      `Match the senders you want, then “Send a copy to” ${address}.`,
    ],
    apple: [
      'iCloud Mail on the web: Settings → Rules → Add a rule.',
      `If the message is from your insurer, forward to ${address}. iCloud may ask you to verify the address; the code shows up on this page.`,
      'In the Mail app, forward any single email to the address.',
    ],
  };
  return (
    <div className="flex flex-col gap-3 px-6 pt-4 text-sm">
      <div className="flex flex-wrap gap-1.5">
        {(['gmail', 'outlook', 'fastmail', 'apple'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={cx(
              'rounded-full px-3 py-1 text-sm',
              tab === k ? 'bg-accent-tint font-medium text-accent' : 'bg-chip text-soft',
            )}
          >
            {
              {
                gmail: 'Gmail',
                outlook: 'Outlook',
                fastmail: 'Fastmail',
                apple: 'iCloud / Apple Mail',
              }[k]
            }
          </button>
        ))}
      </div>
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-ink">
        {steps[tab].map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
