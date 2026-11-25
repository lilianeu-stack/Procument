import 'dotenv/config';
import pool from './src/config/db.js';
import { decryptRefreshToken } from './src/services/google-email.js';

const [[connection]] = await pool.execute(
  `SELECT mailbox, refresh_token AS refreshToken, token_iv AS tokenIv, token_tag AS tokenTag
     FROM google_email_connection WHERE id = 1`
);

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: decryptRefreshToken(connection.refreshToken, connection.tokenIv, connection.tokenTag),
    grant_type: 'refresh_token'
  })
});
const { access_token } = await tokenResponse.json();
if (!access_token) throw new Error(`No access token: ${await tokenResponse.text()}`);

const listResponse = await fetch(
  'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Asent+subject%3ARFQ-2026-E047CE&maxResults=10',
  { headers: { Authorization: `Bearer ${access_token}` } }
);
const list = await listResponse.json();
console.log('LIST', JSON.stringify(list.messages?.map((item) => item.id) || [], null, 2));

function decodeBody(payload) {
  if (payload.body?.data) return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  for (const part of payload.parts || []) {
    const found = decodeBody(part);
    if (found) return found;
  }
  return '';
}

for (const message of list.messages || []) {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?format=full`,
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  const full = await response.json();
  const body = decodeBody(full.payload);
  console.log('\nMESSAGE', message.id, 'SUBJECT', full.payload?.headers?.find((h) => h.name === 'Subject')?.value);
  console.log(body.slice(0, 4000));
}

await pool.end();
