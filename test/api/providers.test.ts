import { describe, expect, it } from 'vitest';
import {
  getProvider,
  ProviderError,
  replyShape,
  WORKERS_AI_VISION_FALLBACK,
  WORKERS_AI_VISION_MODEL,
  workersAiText,
} from '../../src/worker/extract/providers';

describe('Workers AI replies', () => {
  it('reads the answer from each shape Workers AI uses', () => {
    expect(workersAiText({ response: '{"a":1}' })).toBe('{"a":1}');
    expect(workersAiText({ response: { a: 1 } })).toBe('{"a":1}');
    expect(workersAiText({ choices: [{ message: { content: '{"b":2}' } }] })).toBe('{"b":2}');
    expect(
      workersAiText({ choices: [{ message: { content: [{ type: 'text', text: '{"c":3}' }] } }] }),
    ).toBe('{"c":3}');
    expect(workersAiText({ result: { response: '{"d":4}' } })).toBe('{"d":4}');
  });

  it('says what came back when the answer is empty, without its contents', () => {
    const reply = {
      choices: [
        {
          finish_reason: 'length',
          message: { content: null, reasoning_content: 'Patient: Jane Doe, $12.34…' },
        },
      ],
      usage: {},
    };
    let err: unknown;
    try {
      workersAiText(reply);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe('empty_reply');
    expect((err as ProviderError).detail).toBe('finish=length reasoning keys=choices,usage');
    expect((err as ProviderError).detail).not.toMatch(/Jane|12\.34/);
    expect(replyShape(null)).toBe('type=null');
    expect(() => workersAiText({ response: '   ' })).toThrow(ProviderError);
  });
});

/** A Workers AI binding that answers per model, and remembers which models were asked. */
function fakeAi(answers: Record<string, unknown | Error>) {
  const asked: string[] = [];
  const env = {
    AI: {
      run: async (model: string) => {
        asked.push(model);
        const a = answers[model];
        if (a instanceof Error) throw a;
        return a;
      },
    },
  } as unknown as Cloudflare.Env;
  return { env, asked };
}

const photo = { system: 's', user: 'u', file: { base64: 'AAAA', mime: 'image/jpeg' } };

describe('reading a photo with Workers AI', () => {
  it('tries the second model once when the first answers with nothing', async () => {
    const { env, asked } = fakeAi({
      [WORKERS_AI_VISION_MODEL]: { choices: [{ finish_reason: 'length', message: {} }] },
      [WORKERS_AI_VISION_FALLBACK]: { response: '{"ok":true}' },
    });
    const r = await getProvider(env).complete(photo);
    expect(r).toEqual({ text: '{"ok":true}', model: WORKERS_AI_VISION_FALLBACK });
    expect(asked).toEqual([WORKERS_AI_VISION_MODEL, WORKERS_AI_VISION_FALLBACK]);
  });

  it('uses the first model alone when it answers', async () => {
    const { env, asked } = fakeAi({ [WORKERS_AI_VISION_MODEL]: { response: '{"ok":1}' } });
    expect((await getProvider(env).complete(photo)).model).toBe(WORKERS_AI_VISION_MODEL);
    expect(asked).toEqual([WORKERS_AI_VISION_MODEL]);
  });

  it('reports both failures when neither model can read it', async () => {
    const { env } = fakeAi({
      [WORKERS_AI_VISION_MODEL]: { choices: [{ finish_reason: 'length', message: {} }] },
      [WORKERS_AI_VISION_FALLBACK]: new Error('3040: Capacity temporarily exceeded'),
    });
    const err = await getProvider(env)
      .complete(photo)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).message).toBe('workers_ai_error');
    expect((err as ProviderError).retryable).toBe(true);
    expect((err as ProviderError).detail).toMatch(
      /^empty_reply finish=length .*; then workers_ai_error/,
    );
  });

  it('never tries a second model for text', async () => {
    const { env, asked } = fakeAi({});
    await getProvider(env)
      .complete({ system: 's', user: 'u' })
      .catch(() => {});
    expect(asked).toHaveLength(1);
  });
});
