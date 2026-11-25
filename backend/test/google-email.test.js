import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleAuthorizationUrl, decryptRefreshToken, encryptRefreshToken,
  googleEmailConfigStatus, parseGoogleMessage
} from '../src/services/google-email.js';

const configNames = [
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'GOOGLE_OAUTH_REDIRECT_URI',
  'GOOGLE_MAILBOX',
  'GOOGLE_TOKEN_ENCRYPTION_KEY',
  'NODE_ENV'
];
const previousConfig = Object.fromEntries(configNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of configNames) {
    if (previousConfig[name] === undefined) delete process.env[name];
    else process.env[name] = previousConfig[name];
  }
});

function configureGoogleEmail() {
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost:4000/api/email/google/callback';
  process.env.GOOGLE_MAILBOX = 'procurement@hopehavenschool.org';
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.NODE_ENV = 'development';
}

test('Google refresh tokens encrypt and decrypt with the configured key', () => {
  configureGoogleEmail();
  const secret = 'refresh-token-value';
  const encrypted = encryptRefreshToken(secret);
  assert.notEqual(encrypted.ciphertext, secret);
  assert.equal(decryptRefreshToken(encrypted.ciphertext, encrypted.iv, encrypted.tag), secret);
  assert.throws(() => decryptRefreshToken(encrypted.ciphertext, encrypted.iv, '0'.repeat(32)));
});

test('Google authorization URL requests least-privilege inbox access with one-time state', () => {
  configureGoogleEmail();
  const url = new URL(buildGoogleAuthorizationUrl('state-token'));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), process.env.GOOGLE_OAUTH_REDIRECT_URI);
  assert.equal(url.searchParams.get('state'), 'state-token');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.ok(url.searchParams.get('scope').includes('https://www.googleapis.com/auth/gmail.readonly'));
  assert.ok(url.searchParams.get('scope').includes('https://www.googleapis.com/auth/gmail.send'));
  assert.ok(!url.href.includes(process.env.GOOGLE_OAUTH_CLIENT_SECRET));
});

test('Google message parsing returns safe plain-text inbox data and unread status', () => {
  const body = 'Purchase order update';
  const message = parseGoogleMessage({
    id: 'gmail-id',
    threadId: 'thread-id',
    internalDate: '1795456800000',
    snippet: 'Your order has shipped',
    labelIds: ['INBOX', 'UNREAD'],
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'From', value: 'Supplier <sales@example.test>' },
        { name: 'To', value: 'procurement@hopehavenschool.org' },
        { name: 'Subject', value: 'Shipment update' }
      ],
      parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(body).toString('base64url') } }]
    }
  });
  assert.equal(message.id, 'gmail-id');
  assert.equal(message.from, 'Supplier <sales@example.test>');
  assert.equal(message.subject, 'Shipment update');
  assert.equal(message.body, body);
  assert.equal(message.unread, true);
  assert.equal(message.receivedAt, '2026-11-23 18:00:00');
});

test('Google email status never exposes OAuth client secrets', () => {
  configureGoogleEmail();
  const status = googleEmailConfigStatus();
  assert.equal(status.configured, true);
  assert.equal(status.mailbox, 'procurement@hopehavenschool.org');
  assert.ok(!JSON.stringify(status).includes(process.env.GOOGLE_OAUTH_CLIENT_SECRET));
});
