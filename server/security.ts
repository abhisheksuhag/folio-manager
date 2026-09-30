import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt.${salt.toString('base64url')}.${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, saltValue, hashValue] = encoded.split('.');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const salt = Buffer.from(saltValue, 'base64url');
  const stored = Buffer.from(hashValue, 'base64url');
  const derived = scryptSync(password, salt, stored.length);
  return timingSafeEqual(stored, derived);
}

function encryptionKey(hexKey: string): Buffer {
  if (!/^[a-f\d]{64}$/i.test(hexKey)) throw new Error('Encryption key must be 64 hexadecimal characters');
  return Buffer.from(hexKey, 'hex');
}

export function sealToken(token: string, hexKey: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(hexKey), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function openToken(sealed: string, hexKey: string): string {
  const [nonceValue, tagValue, ciphertextValue] = sealed.split('.');
  if (!nonceValue || !tagValue || !ciphertextValue) throw new Error('Invalid encrypted token');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(hexKey), Buffer.from(nonceValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
