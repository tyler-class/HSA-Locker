// Settings editors for People, Providers and Categories.
import { useState } from 'react';
import { PERSON_COLORS, RELATIONSHIPS } from '@shared/lookups';
import type { AppState, Person, Provider } from '@shared/types';
import { Dot } from '../components/bits';
import {
  ErrorText,
  GhostButton,
  IconButton,
  PrimaryButton,
  Sheet,
  TextInput,
} from '../components/ui';
import { api } from '../lib/api';
import { useSave } from '../lib/useSave';
import { Select } from '../components/Select';

function Aliases({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-soft">Other spellings on documents</span>
      <div className="flex flex-wrap gap-1.5">
        {value.map((a) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-chip py-0.5 pr-1 pl-2.5 text-sm"
          >
            {a}
            <IconButton
              icon="x"
              label={`Remove ${a}`}
              className="h-6 w-6"
              onClick={() => onChange(value.filter((x) => x !== a))}
            />
          </span>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !value.includes(draft.trim())) onChange([...value, draft.trim()]);
          setDraft('');
        }}
      >
        <TextInput
          placeholder="Add a spelling"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <GhostButton type="submit" icon="plus" disabled={!draft.trim()}>
          Add
        </GhostButton>
      </form>
    </div>
  );
}

export function PeopleEditor({ state }: { state: AppState }) {
  const [edit, setEdit] = useState<Person | 'new' | null>(null);
  const [family, setFamily] = useState(state.settings.family_names.join(', '));
  const { run, busy, error } = useSave();
  return (
    <div className="flex flex-col px-6 pt-2">
      {state.people.map((p) => (
        <button
          key={p.id}
          onClick={() => setEdit(p)}
          className="flex items-center gap-3 border-b border-line py-3 text-left"
        >
          <Dot color={p.color} />
          <span className="flex-1">{p.name}</span>
          <span className="text-sm text-faint">
            {p.relationship}
            {p.aliases.length
              ? ` · ${p.aliases.length} spelling${p.aliases.length === 1 ? '' : 's'}`
              : ''}
          </span>
        </button>
      ))}
      <GhostButton
        icon="plus"
        className="-ml-3 self-start text-accent"
        onClick={() => setEdit('new')}
      >
        Add person
      </GhostButton>
      <label className="flex flex-col gap-1.5 pt-3">
        <span className="text-xs text-soft">
          Family last names, comma-separated. “Example, Sam” and “Sam Example” then match Sam.
        </span>
        <div className="flex gap-2">
          <TextInput
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            placeholder="e.g. Example"
          />
          <PrimaryButton
            tone="secondary"
            disabled={busy}
            onClick={() =>
              run(() =>
                api.patch('/settings', {
                  family_names: family
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                }),
              )
            }
          >
            Save
          </PrimaryButton>
        </div>
      </label>
      <ErrorText>{error}</ErrorText>
      {edit && <PersonSheet person={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function PersonSheet({ person, onClose }: { person: Person | null; onClose: () => void }) {
  const [name, setName] = useState(person?.name ?? '');
  const [rel, setRel] = useState(person?.relationship ?? 'Self');
  const [color, setColor] = useState(person?.color ?? 'blue');
  const [aliases, setAliases] = useState(person?.aliases ?? []);
  const { run, busy, error } = useSave();
  return (
    <Sheet
      open
      onClose={onClose}
      title={person ? person.name : 'New person'}
      footer={
        <>
          {person ? (
            <GhostButton
              icon="trash"
              className="-ml-3 text-danger"
              onClick={async () => {
                if (!confirm(`Remove ${person.name}? Their receipts stay, without a person.`))
                  return;
                if (await run(() => api.del(`/people/${person.id}`))) onClose();
              }}
            >
              Remove
            </GhostButton>
          ) : (
            <GhostButton onClick={onClose}>Cancel</GhostButton>
          )}
          <PrimaryButton
            disabled={busy || !name.trim()}
            onClick={async () => {
              const body = { name: name.trim(), relationship: rel, color, aliases };
              const ok = await run(() =>
                person ? api.patch(`/people/${person.id}`, body) : api.post('/people', body),
              );
              if (ok) onClose();
            }}
          >
            Save
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-soft">Name</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-soft">Relationship</span>
          <Select
            label="Relationship"
            value={rel}
            onChange={(v) => setRel(v)}
            options={[...RELATIONSHIPS.map((r) => [r, r] as [string, string])]}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Color">
          {PERSON_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              aria-pressed={color === c}
              onClick={() => setColor(c)}
              className={`grid h-8 w-8 place-items-center rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`}
            >
              <Dot color={c} />
            </button>
          ))}
        </div>
        <Aliases value={aliases} onChange={setAliases} />
        <ErrorText>{error}</ErrorText>
      </div>
    </Sheet>
  );
}

export function ProvidersEditor({ state }: { state: AppState }) {
  const [edit, setEdit] = useState<Provider | 'new' | null>(null);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? state.providers : state.providers.slice(0, 12);
  return (
    <div className="flex flex-col px-6 pt-2">
      {list.map((p) => (
        <button
          key={p.id}
          onClick={() => setEdit(p)}
          className="flex items-center gap-3 border-b border-line py-3 text-left"
        >
          <span className="flex-1">{p.name}</span>
          {p.aliases.length > 0 && (
            <span className="text-sm text-faint">
              {p.aliases.length} spelling{p.aliases.length === 1 ? '' : 's'}
            </span>
          )}
        </button>
      ))}
      <div className="flex gap-1">
        <GhostButton icon="plus" className="-ml-3 text-accent" onClick={() => setEdit('new')}>
          Add provider
        </GhostButton>
        {state.providers.length > 12 && (
          <GhostButton onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : `Show all ${state.providers.length}`}
          </GhostButton>
        )}
      </div>
      {edit && (
        <ProviderSheet
          provider={edit === 'new' ? null : edit}
          state={state}
          onClose={() => setEdit(null)}
        />
      )}
    </div>
  );
}

function ProviderSheet({
  provider,
  state,
  onClose,
}: {
  provider: Provider | null;
  state: AppState;
  onClose: () => void;
}) {
  const [name, setName] = useState(provider?.name ?? '');
  const [aliases, setAliases] = useState(provider?.aliases ?? []);
  const [mergeInto, setMergeInto] = useState('');
  const { run, busy, error } = useSave();
  return (
    <Sheet
      open
      onClose={onClose}
      title={provider ? provider.name : 'New provider'}
      footer={
        <>
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton
            disabled={busy || !name.trim()}
            onClick={async () => {
              const body = { name: name.trim(), aliases };
              if (
                await run(() =>
                  provider
                    ? api.patch(`/providers/${provider.id}`, body)
                    : api.post('/providers', body),
                )
              )
                onClose();
            }}
          >
            Save
          </PrimaryButton>
        </>
      }
    >
      <div className="flex flex-col gap-4 py-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-soft">Name</span>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <Aliases value={aliases} onChange={setAliases} />
        {provider && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-xs text-soft">
              Same as another provider? Merge it: its receipts move and this name becomes a
              spelling.
            </span>
            <div className="flex gap-2">
              <Select
                label="Merge into"
                value={mergeInto}
                onChange={(v) => setMergeInto(v)}
                options={[
                  ['', 'Choose…'],
                  ...state.providers
                    .filter((p) => p.id !== provider.id)
                    .map((p) => [p.id, p.name] as [string, string]),
                ]}
                className="min-w-0 flex-1"
              />
              <PrimaryButton
                tone="secondary"
                disabled={!mergeInto || busy}
                onClick={async () => {
                  if (
                    await run(() =>
                      api.post(`/providers/${provider.id}/merge`, { into: mergeInto }),
                    )
                  )
                    onClose();
                }}
              >
                Merge
              </PrimaryButton>
            </div>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
      </div>
    </Sheet>
  );
}

export function CategoriesEditor({ state }: { state: AppState }) {
  const [draft, setDraft] = useState('');
  const { run, busy, error } = useSave();
  return (
    <div className="flex flex-col px-6 pt-2">
      <div className="flex flex-wrap gap-1.5">
        {state.categories.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1 rounded-full bg-chip py-0.5 pr-1 pl-3 text-sm"
          >
            {c.name}
            <IconButton
              icon="x"
              label={`Remove ${c.name}`}
              className="h-6 w-6"
              onClick={() =>
                confirm(`Remove ${c.name}? Entries keep their data without a category.`) &&
                run(() => api.del(`/categories/${c.id}`))
              }
            />
          </span>
        ))}
      </div>
      <form
        className="flex gap-2 pt-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          if (await run(() => api.post('/categories', { name: draft.trim() }))) setDraft('');
        }}
      >
        <TextInput
          placeholder="New category"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <GhostButton type="submit" icon="plus" disabled={busy || !draft.trim()}>
          Add
        </GhostButton>
      </form>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
