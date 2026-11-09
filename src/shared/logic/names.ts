// Matching names on documents to People and Providers.
// People: exact name/alias match, plus the legacy "Family Names" rule ("Example, Sam" and
// "Sam Example" are Sam when Example is a family name). Providers: exact name/alias match;
// truncated or near-identical names are only suggested, never merged silently.

/** Lowercase, letters/digits/spaces only, single spaces. */
export function nameKey(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, pre: string, c: string) => pre + c.toUpperCase());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Tidies a patient name as printed. Ported from HSA Wizard's normalizePatientName_:
 * drops anything in parentheses ("Sam (spouse)" → "Sam"); when a family name appears
 * anywhere, removes it (with a neighbouring comma) and puts it last ("Example, Sam" →
 * "Sam Example"). Added here: ALL CAPS becomes Title Case, and spaces are collapsed.
 */
export function normalizePatientName(raw: string, familyNames: string[] = []): string {
  let s = raw
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return '';
  if (s === s.toUpperCase() && /[A-Z]/.test(s)) s = titleCase(s);
  const families = familyNames.map((n) => n.trim()).filter(Boolean);
  if (!families.length) return s;
  const m = new RegExp(`\\b(${families.map(escapeRe).join('|')})\\b`, 'i').exec(s);
  if (!m) return s;
  const last = m[1]!;
  const first = s
    .replace(new RegExp(`,?\\s*${escapeRe(last)}\\s*,?`, 'i'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return first ? `${first} ${last}` : last;
}

export interface PersonLike {
  id: string;
  name: string;
  aliases: string[];
}

export interface PersonMatch {
  id: string;
  /** How it matched: an exact name/alias, or via the family-names rule / first name only. */
  via: 'exact' | 'family_name' | 'first_name';
}

/** Finds the person a printed patient name refers to, or null if unknown or ambiguous. */
export function matchPerson(
  raw: string | null | undefined,
  people: PersonLike[],
  familyNames: string[] = [],
): PersonMatch | null {
  if (!raw?.trim() || !people.length) return null;
  const normalized = normalizePatientName(raw, familyNames);
  const keys = new Set([nameKey(raw), nameKey(normalized)]);
  const exact = people.filter((p) =>
    [p.name, ...p.aliases].some((n) => keys.has(nameKey(normalizePatientName(n, familyNames)))),
  );
  if (exact.length === 1) return { id: exact[0]!.id, via: 'exact' };
  if (exact.length > 1) return null;

  const families = new Set(familyNames.map(nameKey));
  const tokens = nameKey(normalized).split(' ');
  const first = tokens[0]!;
  const rest = tokens.slice(1).join(' ');
  const firstOf = (n: string) => nameKey(normalizePatientName(n, familyNames)).split(' ')[0]!;

  // "Sam Example" ↔ "Sam" when Example is a family name (either side may carry the last name).
  const familyHit = people.filter((p) =>
    [p.name, ...p.aliases].some((n) => {
      const t = nameKey(normalizePatientName(n, familyNames)).split(' ');
      const pRest = t.slice(1).join(' ');
      if (t[0] !== first) return false;
      if (!rest && !pRest) return false;
      if (rest && !pRest) return families.has(rest);
      if (!rest && pRest) return families.has(pRest);
      return false;
    }),
  );
  if (familyHit.length === 1) return { id: familyHit[0]!.id, via: 'family_name' };
  if (familyHit.length > 1) return null;

  // Just a first name that belongs to exactly one person.
  if (!rest) {
    const byFirst = people.filter((p) => [p.name, ...p.aliases].some((n) => firstOf(n) === first));
    if (byFirst.length === 1) return { id: byFirst[0]!.id, via: 'first_name' };
  }
  return null;
}

const PROVIDER_NOISE = /\b(llc|inc|pc|pllc|pa|ltd|co|corp|corporation|the)\b/g;

export function providerKey(s: string): string {
  return nameKey(s).replace(PROVIDER_NOISE, ' ').replace(/\s+/g, ' ').trim();
}

/** Sørensen–Dice similarity of letter pairs, 0..1. */
export function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const m = new Map<string, number>();
    const t = s.replace(/ /g, '');
    for (let i = 0; i < t.length - 1; i++) {
      const p = t.slice(i, i + 2);
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  };
  if (a === b) return 1;
  const pa = pairs(a);
  const pb = pairs(b);
  let total = 0;
  pa.forEach((n) => (total += n));
  pb.forEach((n) => (total += n));
  if (!total) return 0;
  let overlap = 0;
  pa.forEach((n, k) => (overlap += Math.min(n, pb.get(k) ?? 0)));
  return (2 * overlap) / total;
}

export interface ProviderLike {
  id: string;
  name: string;
  aliases: string[];
}

export type ProviderMatch =
  | { kind: 'exact'; id: string }
  | { kind: 'suggestion'; id: string; reason: 'truncated' | 'similar' }
  | { kind: 'none' };

/**
 * Exact name/alias matches return the provider. A truncated EOB name ("Lakeside Surgical Suit")
 * or a near-identical spelling returns a suggestion only.
 */
export function matchProvider(
  raw: string | null | undefined,
  providers: ProviderLike[],
): ProviderMatch {
  const key = raw ? providerKey(raw) : '';
  if (!key) return { kind: 'none' };
  for (const p of providers)
    if ([p.name, ...p.aliases].some((n) => providerKey(n) === key))
      return { kind: 'exact', id: p.id };

  let best: { id: string; score: number; reason: 'truncated' | 'similar' } | null = null;
  for (const p of providers) {
    for (const n of [p.name, ...p.aliases]) {
      const k = providerKey(n);
      if (!k) continue;
      const [short, long] = key.length <= k.length ? [key, k] : [k, key];
      if (short.length >= 12 && long.startsWith(short)) {
        const score = 1 + short.length / 1000;
        if (!best || score > best.score) best = { id: p.id, score, reason: 'truncated' };
        continue;
      }
      const s = similarity(key, k);
      if (s >= 0.85 && (!best || s > best.score)) best = { id: p.id, score: s, reason: 'similar' };
    }
  }
  return best ? { kind: 'suggestion', id: best.id, reason: best.reason } : { kind: 'none' };
}

/**
 * HSA Wizard's fuzzyProviderMatch_: one name starts with or contains the other. Used for
 * duplicate checks only (where a truncated EOB name should still count as the same provider).
 * Unlike the legacy version, two blank names don't match.
 */
export function providersLooselyEqual(a: string | null | undefined, b: string | null | undefined) {
  const na = providerKey(a ?? '');
  const nb = providerKey(b ?? '');
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}

/** Adds an alias unless it's already the name or an alias (case-insensitively). */
export function withAlias(name: string, aliases: string[], alias: string): string[] {
  const a = alias.trim();
  if (!a) return aliases;
  const k = nameKey(a);
  if (nameKey(name) === k || aliases.some((x) => nameKey(x) === k)) return aliases;
  return [...aliases, a];
}
