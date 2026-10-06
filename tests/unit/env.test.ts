import { describe, expect, it } from 'vitest';
import { parsePublicEnv } from '@/lib/env';

describe('environment', () => {
  it('reports missing Supabase settings clearly', () => {
    expect(() => parsePublicEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('accepts a complete configuration', () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x'.repeat(40),
      }).NEXT_PUBLIC_SITE_URL,
    ).toBe('http://localhost:3000');
  });
});
