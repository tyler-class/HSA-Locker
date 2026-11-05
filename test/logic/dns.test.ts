import { describe, expect, it } from 'vitest';
import { mxStatus, routingStatus } from '../../src/shared/logic';

describe('inbox setup checks', () => {
  it('recognizes Cloudflare Email Routing MX records', () => {
    expect(
      mxStatus([
        { type: 15, data: '20 route1.mx.cloudflare.net.' },
        { type: 15, data: '8 route2.mx.cloudflare.net.' },
      ]),
    ).toEqual({ status: 'ok', hosts: ['route1.mx.cloudflare.net', 'route2.mx.cloudflare.net'] });
    expect(mxStatus([{ type: 15, data: '10 in1-smtp.messagingengine.com.' }]).status).toBe('other');
    expect(mxStatus(undefined).status).toBe('missing');
    expect(mxStatus([{ type: 5, data: 'x.example.' }]).status).toBe('missing');
  });

  it('confirms routing from mail that arrived, and spots a mismatched name', () => {
    const addr = 'inbound@hsa.example.com';
    expect(routingStatus([], addr, 'hsa.example.com').status).toBe('waiting');
    expect(
      routingStatus(
        [{ to_addr: 'inbound@hsa.example.com', outcome: 'ignored', reason: 'empty_message' }],
        addr,
        'hsa.example.com',
      ).status,
    ).toBe('ok');
    expect(
      routingStatus(
        [{ to_addr: 'receipts@hsa.example.com', outcome: 'rejected', reason: 'unknown_recipient' }],
        addr,
        'hsa.example.com',
      ),
    ).toEqual({ status: 'mismatch', other: 'receipts@hsa.example.com' });
    // A rejection for another reason (e.g. paused) still proves the rule routes to the Worker.
    expect(
      routingStatus(
        [{ to_addr: 'inbound@hsa.example.com', outcome: 'rejected', reason: 'paused' }],
        addr,
        'hsa.example.com',
      ).status,
    ).toBe('ok');
  });
});
