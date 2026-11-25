import pool from './src/config/db.js';

const tokens = [
  '2ae4ba83963bb4825cfdbaa1c74c3e6f038d64e9e5dc979a875ffe3152d5f24b',
  '4fefa026530889c5dac830d75271656323383b79f21362beecde7de4af98203a',
  '432afc936bf26120e0dfa7819a9ef343b5652f278b002f1dc843038641d6b8f9',
  'f5794b924033d479a6436d6a8231d309afd20503475d73ee5923b0bdbf510e10',
  '74858543d9feee6709f4c265af3b3ad3940cd86ccf8ab560dce5f38c54bb1607',
  'e083f3ad70e090845a0f094949baee6ae3f5c84ef611c3cd283314ab14b2aef5'
];

for (const token of tokens) {
  const [[row]] = await pool.execute(
    'SELECT id, recipient_email, status, sent_at, opened_at, submitted_at FROM rfq_committee_reviews WHERE token = ?',
    [token]
  );
  const response = await fetch(`http://localhost:4000/api/committee-review/${token}`);
  const data = await response.json();
  console.log(token.slice(0, 12), 'db=', JSON.stringify(row), 'api=', response.status, data?.review?.reference || data?.message || 'NO REVIEW');
}
await pool.end();
