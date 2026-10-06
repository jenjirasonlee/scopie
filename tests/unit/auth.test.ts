import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/auth/redirect';
import { isPublicPath } from '@/lib/db/proxy-session';
import { signInSchema, signUpSchema } from '@/schemas/auth';

describe('sign-in and sign-up validation', () => {
  it('normalizes email addresses', () => {
    expect(signInSchema.parse({ email: '  Jen@Example.COM ', password: 'x' }).email).toBe(
      'jen@example.com',
    );
  });

  it('requires a password of at least 8 characters to sign up', () => {
    expect(
      signUpSchema.safeParse({ fullName: 'Jen', email: 'jen@example.com', password: 'short' })
        .success,
    ).toBe(false);
    expect(
      signUpSchema.safeParse({ fullName: 'Jen', email: 'jen@example.com', password: 'long-enough' })
        .success,
    ).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(signInSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });
});

describe('post-sign-in redirects', () => {
  it('allows same-site paths only', () => {
    expect(safeNextPath('/canna/accounts')).toBe('/canna/accounts');
    expect(safeNextPath('https://evil.example')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});

describe('protected routes', () => {
  it('treats only auth pages as public', () => {
    expect(isPublicPath('/sign-in')).toBe(true);
    expect(isPublicPath('/sign-up')).toBe(true);
    expect(isPublicPath('/auth/confirm')).toBe(true);
    expect(isPublicPath('/')).toBe(false);
    expect(isPublicPath('/onboarding')).toBe(false);
    expect(isPublicPath('/canna/dashboard')).toBe(false);
    expect(isPublicPath('/sign-in-hack')).toBe(false);
  });
});
