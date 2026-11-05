// Checking the inbox setup from what's publicly visible: the subdomain's MX records (from a
// DNS-over-HTTPS answer) and the inbox log (mail that actually arrived).

export type MxStatus = 'ok' | 'missing' | 'other';

/** Cloudflare Email Routing's MX hosts look like route1.mx.cloudflare.net. */
export function mxStatus(answers: { type?: number; data?: string }[] | undefined): {
  status: MxStatus;
  hosts: string[];
} {
  const hosts = (answers ?? [])
    .filter((a) => a.type === 15 && typeof a.data === 'string')
    .map((a) => a.data!.trim().split(/\s+/).pop()!.replace(/\.$/, '').toLowerCase());
  if (!hosts.length) return { status: 'missing', hosts };
  return {
    status: hosts.some((h) => /(^|\.)mx\.cloudflare\.net$/.test(h)) ? 'ok' : 'other',
    hosts,
  };
}

export type RoutingStatus = 'ok' | 'waiting' | 'mismatch';

/**
 * Whether the routing rule works, judged from the inbox log (newest first): mail to the current
 * address arrived → ok; only mail to other names at the subdomain (rejected as unknown) →
 * mismatch, with the name Cloudflare is actually routing; nothing yet → waiting.
 */
export function routingStatus(
  log: { to_addr: string | null; outcome: string; reason: string | null }[],
  address: string,
  domain: string,
): { status: RoutingStatus; other: string | null } {
  const addr = address.toLowerCase();
  const atDomain = log.filter((l) => l.to_addr?.toLowerCase().endsWith(`@${domain.toLowerCase()}`));
  if (atDomain.some((l) => l.to_addr?.toLowerCase() === addr && l.reason !== 'unknown_recipient'))
    return { status: 'ok', other: null };
  const wrong = atDomain.find(
    (l) =>
      l.outcome === 'rejected' &&
      l.reason === 'unknown_recipient' &&
      l.to_addr?.toLowerCase() !== addr,
  );
  return wrong ? { status: 'mismatch', other: wrong.to_addr } : { status: 'waiting', other: null };
}
