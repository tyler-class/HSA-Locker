import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from './helpers';

describe('mcp', () => {
  it('requires an OAuth token and advertises its metadata', async () => {
    const res = await SELF.fetch(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    const meta = await SELF.fetch(`${ORIGIN}/.well-known/oauth-protected-resource/mcp`);
    expect(meta.status).toBe(200);
    expect(((await meta.json()) as { resource: string }).resource).toBe(`${ORIGIN}/mcp`);
  });
});
