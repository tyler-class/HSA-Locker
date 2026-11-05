import { describe, expect, it } from 'vitest';
import {
  matchPerson,
  matchProvider,
  normalizePatientName,
  providersLooselyEqual,
  withAlias,
} from '../../src/shared/logic';

const FAMILY = ['Example'];
const people = [
  { id: 'sam', name: 'Sam Example', aliases: [] },
  { id: 'alex', name: 'Alex', aliases: ['Alexandra Example'] },
  { id: 'mia', name: 'Mia Example', aliases: [] },
];

describe('normalizePatientName (legacy rules)', () => {
  it.each([
    ['Example, Sam', 'Sam Example'],
    ['Sam Example', 'Sam Example'],
    ['Sam (spouse)', 'Sam'],
    ['Sam Example (patient)', 'Sam Example'],
    ['EXAMPLE, SAM', 'Sam Example'],
    ['Example', 'Example'],
    ['  Mia   Example ', 'Mia Example'],
    ['Smith, Jordan', 'Smith, Jordan'], // not a family name: left alone, like the legacy code
  ])('%s → %s', (raw, out) => expect(normalizePatientName(raw, FAMILY)).toBe(out));
});

describe('matchPerson', () => {
  it('matches names and aliases exactly', () => {
    expect(matchPerson('Sam Example', people, FAMILY)).toEqual({ id: 'sam', via: 'exact' });
    expect(matchPerson('EXAMPLE, SAM', people, FAMILY)).toEqual({ id: 'sam', via: 'exact' });
    expect(matchPerson('Alexandra Example', people, FAMILY)).toEqual({ id: 'alex', via: 'exact' });
  });
  it('collapses "Alex" and "Alex Example" through the family name', () => {
    expect(matchPerson('Alex Example', people, FAMILY)).toEqual({ id: 'alex', via: 'family_name' });
    expect(matchPerson('Mia', people, FAMILY)).toEqual({ id: 'mia', via: 'family_name' });
  });
  it('does not guess', () => {
    expect(matchPerson('Alex Smith', people, FAMILY)).toBeNull();
    expect(matchPerson('Jordan', people, FAMILY)).toBeNull();
    expect(matchPerson('', people, FAMILY)).toBeNull();
    const twins = [
      { id: 'a', name: 'Sam', aliases: [] },
      { id: 'b', name: 'Sam', aliases: [] },
    ];
    expect(matchPerson('Sam', twins, FAMILY)).toBeNull();
  });
});

describe('providers', () => {
  const providers = [
    { id: 'pt', name: 'Lakeside Physical Therapy', aliases: [] },
    { id: 'gs', name: 'Riverbend Surgical Suites LLC', aliases: ['RSS'] },
  ];
  it('matches exact names and aliases, ignoring punctuation and LLC', () => {
    expect(matchProvider('LAKESIDE PHYSICAL THERAPY', providers)).toEqual({
      kind: 'exact',
      id: 'pt',
    });
    expect(matchProvider('Riverbend Surgical Suites', providers)).toEqual({
      kind: 'exact',
      id: 'gs',
    });
    expect(matchProvider('rss', providers)).toEqual({ kind: 'exact', id: 'gs' });
  });
  it('only suggests truncated EOB names', () => {
    expect(matchProvider('Lakeside Physical Ther', providers)).toEqual({
      kind: 'suggestion',
      id: 'pt',
      reason: 'truncated',
    });
    expect(matchProvider('Riverbend Surgical Suit', providers)).toMatchObject({
      kind: 'suggestion',
      id: 'gs',
    });
  });
  it('suggests near-identical spellings and ignores strangers', () => {
    expect(matchProvider('Lakeside Physical Therapy.', providers).kind).toBe('exact');
    expect(matchProvider('Lakside Physical Therapy', providers)).toMatchObject({
      kind: 'suggestion',
      reason: 'similar',
    });
    expect(matchProvider('Downtown Dental', providers)).toEqual({ kind: 'none' });
  });
  it('loose equality for duplicate checks', () => {
    expect(providersLooselyEqual('Lakeside Physical Ther', 'Lakeside Physical Therapy')).toBe(true);
    expect(providersLooselyEqual('', '')).toBe(false);
  });
  it('adds aliases once', () => {
    expect(withAlias('Sam', ['Sammy'], 'sammy ')).toEqual(['Sammy']);
    expect(withAlias('Sam', [], 'Samuel')).toEqual(['Samuel']);
    expect(withAlias('Sam', [], 'SAM')).toEqual([]);
  });
});
