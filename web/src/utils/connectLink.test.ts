import { describe, expect, it } from 'vitest';

import { connectLink } from './connectLink.ts';

describe('connect link', () => {
  it('holds the version, the hub address and the token', () => {
    const link = connectLink('https://hub.example.com', 'a-long-test-token-123');
    expect(link.startsWith('psysonic-hub://connect?')).toBe(true);

    const q = new URL(link).searchParams;
    expect(q.get('v')).toBe('1');
    expect(q.get('url')).toBe('https://hub.example.com');
    expect(q.get('token')).toBe('a-long-test-token-123');
  });

  it('survives characters that need escaping', () => {
    const q = new URL(connectLink('http://192.168.1.5:5533', 'a+b/c=d&e')).searchParams;
    expect(q.get('url')).toBe('http://192.168.1.5:5533');
    expect(q.get('token')).toBe('a+b/c=d&e');
  });
});
