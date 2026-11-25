import { createHash, randomBytes } from 'node:crypto';

// The supplier pricing link is a 256-bit bearer secret. Only its SHA-256 hash
// is stored, so reading the database never reveals a usable private link.
export function createSupplierPricingToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSupplierPricingToken(token) };
}

export function hashSupplierPricingToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function isValidSupplierPricingTokenFormat(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));
}
