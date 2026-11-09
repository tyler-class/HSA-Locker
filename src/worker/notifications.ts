// HSA Locker's push notifications on top of the Selfhost Kit's push (src/worker/kit/push.ts):
// "Needs review" for documents reading leaves in Review, and the app-icon count. The words and
// rules are in src/shared/logic/notify.ts. (The daily reminder email is ./notify.ts.)
import {
  notifiedIds,
  NOTIFY_FROM_HOUR,
  NOTIFY_KINDS,
  NOTIFY_UNTIL_HOUR,
  pendingReview,
  reviewNotice,
  type ReviewDoc,
} from '@shared/logic';
import type { DocKind } from '@shared/types';
import { all, first, REVIEW_DOC_WHERE } from './db';
import { pushRoutes, runPushJob, type PushDevice, type PushJobOptions } from './kit/push';

const ICON = '/pwa-192x192.png';

const arr = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? '[]')) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** The documents in Review (what the Review screen shows), with their reasons and provider. */
export async function loadReviewDocs(db: D1Database): Promise<ReviewDoc[]> {
  const docs = await all<{
    id: string;
    kind: DocKind | null;
    filename: string;
    processed_at: string | null;
    review_reasons_json: string;
    extraction_provider: string | null;
  }>(
    db,
    `SELECT d.id, d.kind, d.filename, d.processed_at, d.review_reasons_json, d.extraction_provider
     FROM documents d WHERE ${REVIEW_DOC_WHERE} ORDER BY d.received_at`,
  );
  const entries = await all<{ document_id: string; review_reasons_json: string; provider: string }>(
    db,
    `SELECT e.document_id, e.review_reasons_json, COALESCE(p.name, e.provider_name_raw) AS provider
     FROM entries e LEFT JOIN providers p ON p.id = e.provider_id
     WHERE e.document_id IN (SELECT d.id FROM documents d WHERE ${REVIEW_DOC_WHERE})
     ORDER BY e.document_id, e.sort_order`,
  );
  const byDoc = new Map<string, typeof entries>();
  for (const e of entries) byDoc.set(e.document_id, [...(byDoc.get(e.document_id) ?? []), e]);
  return docs.map((d) => {
    const es = byDoc.get(d.id) ?? [];
    return {
      id: d.id,
      kind: d.kind,
      filename: d.filename,
      // Imported from HSA Wizard: never read here, so never "just processed".
      processed_at: d.extraction_provider === 'hsa-wizard' ? null : d.processed_at,
      reasons: [...arr(d.review_reasons_json), ...es.flatMap((e) => arr(e.review_reasons_json))],
      provider: es.find((e) => e.provider)?.provider ?? null,
    };
  });
}

/** Document ids this device has already been told about (the kit's sent log; see the README). */
async function notifiedFor(db: D1Database, device: PushDevice): Promise<Set<string>> {
  const rows = await all<{ key: string }>(
    db,
    `SELECT key FROM selfhost_push_sent WHERE device_id = ? AND kind = 'review'`,
    device.id,
  );
  return notifiedIds(rows.map((r) => r.key));
}

/** The notification a device could get now, and its badge count. */
export function hsaPush(db: D1Database): Pick<PushJobOptions, 'build' | 'badge'> {
  // Loaded once per run (or request), not once per device.
  let docs: Promise<ReviewDoc[]> | null = null;
  const load = () => (docs ??= loadReviewDocs(db));
  return {
    async build(device, now) {
      const pending = pendingReview(await load(), {
        notified: await notifiedFor(db, device),
        deviceSince: device.created_at,
        now,
      });
      const n = reviewNotice(pending);
      return n
        ? [
            {
              kind: n.kind,
              key: n.key,
              message: { title: n.title, body: n.body, url: n.url, tag: n.tag },
            },
          ]
        : [];
    },
    async badge() {
      return (await load()).length;
    },
  };
}

/**
 * Sends what's due: from the cron (every 10 minutes; it also lets notifications held overnight
 * out at 8 a.m.) and right after documents are read. Between 9 p.m. and 8 a.m. on a device,
 * nothing goes out; what's waiting then goes as one notification at 8. Never throws.
 */
export function runNotifications(db: D1Database, o: Partial<PushJobOptions> = {}) {
  return runPushJob(db, {
    ...hsaPush(db),
    icon: ICON,
    hour: NOTIFY_FROM_HOUR,
    until: NOTIFY_UNTIL_HOUR,
    ...o,
  });
}

/**
 * After a document is read: notify now, unless more documents are being read or are queued,
 * so a batch (an email with several attachments, a multi-file upload, a sweep) becomes one
 * notification sent when the last one finishes. The cron catches anything left over.
 */
export async function notifyWhenIdle(db: D1Database, o: Partial<PushJobOptions> = {}) {
  try {
    const now = new Date().toISOString();
    // 10 minutes: the pipeline's STALE_MINUTES (a claim older than that is abandoned).
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    const busy = await first<{ n: number }>(
      db,
      `SELECT COUNT(*) AS n FROM documents WHERE
         (status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
         OR (status = 'processing' AND updated_at >= ?)`,
      now,
      stale,
    );
    if (Number(busy?.n ?? 0) > 0) return null;
    return await runNotifications(db, o);
  } catch (e) {
    console.warn('push: after-reading run failed', e);
    return null;
  }
}

/** /api/push/*: behind HSA Locker's sign-in (mounted after the guard in app.ts). */
export const push = pushRoutes({
  title: 'HSA Locker',
  kinds: NOTIFY_KINDS.map((k) => k.id),
  icon: ICON,
  fallbackSubject: 'mailto:hsalocker@tylerclass.net',
  badge: (device, now, db) => hsaPush(db).badge!(device, now, db),
});
