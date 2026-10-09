import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts platform access tokens at rest with AES-256-GCM.
 * Format: "v<keyVersion>:<iv base64>:<auth tag base64>:<ciphertext base64>".
 * The key comes from SCOPIE_ENCRYPTION_KEY and never touches the database.
 * GCM's auth tag means a tampered or wrongly keyed value fails to decrypt instead of
 * returning garbage.
 */
export const CURRENT_KEY_VERSION = 1;

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64)');
  return key;
}

export function encryptToken(
  plaintext: string,
  base64Key: string,
  keyVersion = CURRENT_KEY_VERSION,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${keyVersion}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decryptToken(sealed: string, base64Key: string): string {
  const parts = sealed.split(':');
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0]!)) throw new Error('Malformed encrypted token');
  const [, iv, tag, ciphertext] = parts as [string, string, string, string];
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(base64Key), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function keyVersionOf(sealed: string): number {
  const match = /^v(\d+):/.exec(sealed);
  if (!match) throw new Error('Malformed encrypted token');
  return Number(match[1]);
}
