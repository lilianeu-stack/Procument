import { createHmac, timingSafeEqual } from 'node:crypto';

const VERSION = 'v1';

function secret() {
  const value = String(process.env.JWT_SECRET || '');
  if (!value) throw new Error('JWT_SECRET is required to sign supplier RFQ links.');
  return value;
}

function sign(payload) {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

// The token carries only the RFQ and Supplier identifiers. It is signed with
// the server secret, so a Supplier cannot guess another Supplier's link and no
// plaintext token needs to be stored in the database.
export function createRfqToken(rfqId, supplierId) {
  const payload = Buffer.from(`${Number(rfqId)}:${Number(supplierId)}`, 'utf8').toString('base64url');
  return `${VERSION}.${payload}.${sign(payload)}`;
}

export function parseRfqToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts;
  const expected = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const decoded = Buffer.from(payload, 'base64url').toString('utf8');
  const match = /^(\d+):(\d+)$/.exec(decoded);
  if (!match) return null;
  const rfqId = Number(match[1]);
  const supplierId = Number(match[2]);
  if (!Number.isInteger(rfqId) || rfqId < 1 || !Number.isInteger(supplierId) || supplierId < 1) return null;
  return { rfqId, supplierId };
}
