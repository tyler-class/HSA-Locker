// What HSA Locker's push notification says and when: "Needs review" once per document that
// reading leaves in Review, several at once as one, plus the app-icon count (documents in
// Review, the same number as the Review tab). Sending, the 8 a.m. to 9 p.m. window and the sent
// log are the Selfhost Kit's (src/worker/kit/push.ts). The daily email is src/worker/notify.ts.
import { reviewLabel } from '../lookups';
import type { DocKind } from '../types';

/** The kinds of notification, each with its own switch in Settings. */
export const NOTIFY_KINDS = [
  {
    id: 'review',
    label: 'Needs review',
    description: 'When a document needs a look after it’s read.',
  },
] as const;

export type NotifyKind = (typeof NOTIFY_KINDS)[number]['id'];

/** What the app-icon count counts, for the ⓘ in Settings. */
export const BADGE_MEANS = 'how many documents are waiting in Review';

/** Notifications wait outside these hours (local time on each device): 8 a.m. to 9 p.m. */
export const NOTIFY_FROM_HOUR = 8;
export const NOTIFY_UNTIL_HOUR = 21;

/** Documents read longer ago than this never notify (a device turned back on, a cron outage). */
export const NOTIFY_LOOKBACK_DAYS = 3;

/** A document in Review, as the notification needs it. */
export interface ReviewDoc {
  id: string;
  kind: DocKind | null;
  filename: string;
  /** When reading it finished (ISO). Null: never read (imported, typed in). */
  processed_at: string | null;
  /** The document's own reasons, then each entry's, in order. */
  reasons: string[];
  /** The provider on its first entry that has one. */
  provider: string | null;
}

export interface Notice {
  kind: NotifyKind;
  /** The documents it's about, sorted and joined: the kit's sent log keeps it, once per document. */
  key: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

const KEY_SEP = ' ';

/** The sent-log key for a set of documents. */
export const reviewKey = (ids: readonly string[]) => [...ids].sort().join(KEY_SEP);

/** Every document id already in a device's sent-log keys. */
export function notifiedIds(keys: readonly string[]): Set<string> {
  return new Set(keys.flatMap((k) => k.split(KEY_SEP)).filter(Boolean));
}

/**
 * The documents a device hasn't heard about yet: read after the device signed up (and within
 * the last few days), and not in an earlier notification to it.
 */
export function pendingReview(
  docs: readonly ReviewDoc[],
  o: { notified: ReadonlySet<string>; deviceSince: string; now: Date },
): ReviewDoc[] {
  const lookback = new Date(o.now.getTime() - NOTIFY_LOOKBACK_DAYS * 86_400_000).toISOString();
  const since = o.deviceSince > lookback ? o.deviceSince : lookback;
  const until = o.now.toISOString();
  return docs.filter(
    (d) =>
      d.processed_at && d.processed_at >= since && d.processed_at <= until && !o.notified.has(d.id),
  );
}

const KIND_WORD: Record<DocKind, string> = { receipt: 'Receipt', eob: 'EOB', unknown: 'Document' };

/** "Amount looks wrong" → "amount looks wrong" (keeps "EOB", "PDF" and the like). */
function lower(s: string): string {
  return /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** "Receipt from Lakeside Pediatrics: amount looks wrong". */
export function docLine(d: ReviewDoc): string {
  const what = d.provider
    ? `${KIND_WORD[d.kind ?? 'unknown']} from ${d.provider}`
    : d.kind && d.kind !== 'unknown'
      ? KIND_WORD[d.kind]
      : d.filename;
  const [first, ...rest] = [...new Set(d.reasons)];
  if (!first) return `${what} needs review`;
  const more = rest.length ? `, and ${rest.length} more` : '';
  return `${what}: ${lower(reviewLabel(first))}${more}`;
}

/** One notification for the documents a device hasn't heard about, or null when there are none. */
export function reviewNotice(docs: readonly ReviewDoc[]): Notice | null {
  if (!docs.length) return null;
  const ids = docs.map((d) => d.id);
  const one = docs.length === 1 ? docs[0]! : null;
  return {
    kind: 'review',
    key: reviewKey(ids),
    title: 'Needs review',
    body: one ? docLine(one) : `${docs.length} documents need review`,
    url: one ? `/review/${one.id}` : '/review',
    tag: `review-${[...ids].sort()[0]}`,
  };
}
