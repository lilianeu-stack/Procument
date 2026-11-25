import 'dotenv/config';
import pool from './src/config/db.js';
import { decryptRefreshToken } from './src/services/google-email.js';

const [[connection]] = await pool.execute(
  `SELECT refresh_token AS refreshToken, token_iv AS tokenIv, token_tag AS tokenTag
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

const response = await fetch(
  'https://gmail.googleapis.com/gmail/v1/users/me/messages/1a2121faeae8bffe?format=full',
  { headers: { Authorization: `Bearer ${access_token}` } }
);
const full = await response.json();

function collect(part, output, indent = '') {
  console.log(indent + part.mimeType, 'parts=', (part.parts || []).length, 'data=', Boolean(part.body?.data));
  if (part.mimeType === 'text/html' && part.body?.data) {
    output.push(Buffer.from(part.body.data, 'base64url').toString('utf8'));
  }
  for (const child of part.parts || []) collect(child, output, indent + '  ');
}
const htmlParts = [];
collect(full.payload, htmlParts);
const html = htmlParts[0] || '';
const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
console.log('LINKS', JSON.stringify(links, null, 2));
console.log('HAS PATH LINK', html.includes('/committee-review?token='));
console.log('HAS HASH LINK', html.includes('/#/committee-review/Review?token='));
await pool.end();
