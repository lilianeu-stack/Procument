import { createHash, randomBytes } from 'node:crypto';

// The approval token is a high-entropy bearer secret. The database stores only
// its SHA-256 hash, so a database read cannot be used to open an approval link.
export function createPurchaseOrderApprovalToken() {
  return randomBytes(32).toString('base64url');
}

export function hashPurchaseOrderApprovalToken(token) {
  return createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

export function isValidPurchaseOrderApprovalToken(token) {
  return /^[A-Za-z0-9_-]{43}$/.test(String(token || ''));
}
