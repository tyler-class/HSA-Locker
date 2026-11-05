// Settings → Inbox: the address, its log, forwarding confirmations, rotate.
import { Hono } from 'hono';
import type { InboxLogRow, InboxVerification } from '@shared/types';
import { all, first, loadSettings, newInboxToken, nowIso, setSettingStmt } from '../db';
import { notFound, type AppEnv } from './util';

export const inbox = new Hono<AppEnv>();

inbox.get('/inbox', async (c) => {
  const db = c.env.DB;
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [settings, log, verifications, stats, last] = await Promise.all([
    loadSettings(db),
    all<InboxLogRow>(
      db,
      'SELECT id, received_at, to_addr, from_addr, subject, outcome, reason, size_bytes, attachment_count, document_count FROM inbox_log ORDER BY received_at DESC LIMIT 50',
    ),
    all<InboxVerification>(
      db,
      'SELECT id, received_at, provider, from_addr, subject, code, link FROM inbox_verifications WHERE dismissed_at IS NULL ORDER BY received_at DESC',
    ),
    first<{ accepted: number; rejected: number; total: number }>(
      db,
      `SELECT
         SUM(CASE WHEN outcome IN ('accepted', 'duplicate', 'received', 'verification') THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN outcome = 'rejected' THEN 1 ELSE 0 END) AS rejected,
         COUNT(*) AS total
       FROM inbox_log WHERE received_at >= ?`,
      since,
    ),
    first<{ received_at: string }>(
      db,
      "SELECT received_at FROM inbox_log WHERE outcome != 'rejected' ORDER BY received_at DESC LIMIT 1",
    ),
  ]);
  return c.json({
    address: settings.inbox_address,
    domain: settings.inbox_domain,
    paused: settings.inbox_paused,
    last_received_at: last?.received_at ?? null,
    stats_30d: {
      accepted: Number(stats?.accepted ?? 0),
      rejected: Number(stats?.rejected ?? 0),
      total: Number(stats?.total ?? 0),
    },
    log,
    verifications,
  });
});

/** New address; the old one stops working immediately. */
inbox.post('/inbox/rotate', async (c) => {
  await setSettingStmt(c.env.DB, 'inbox_token', newInboxToken()).run();
  return c.json({ address: (await loadSettings(c.env.DB)).inbox_address });
});

inbox.post('/inbox/verifications/:id/dismiss', async (c) => {
  const r = await c.env.DB.prepare(
    'UPDATE inbox_verifications SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL',
  )
    .bind(nowIso(), c.req.param('id'))
    .run();
  if (!r.meta.changes) throw notFound('Confirmation');
  return c.json({ ok: true });
});
