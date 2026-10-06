/** Only allow same-site relative paths as post-sign-in destinations (prevents open redirects). */
export function safeNextPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
