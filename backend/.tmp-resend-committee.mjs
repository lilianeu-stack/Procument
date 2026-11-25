import jwt from 'jsonwebtoken';
import pool from './src/config/db.js';

const secret = process.env.JWT_SECRET || 'test-secret-with-at-least-thirty-two-characters';
const [[user]] = await pool.execute(
  "SELECT id, role FROM users WHERE role IN ('admin', 'procurement') AND active = TRUE ORDER BY FIELD(role, 'procurement', 'admin'), id LIMIT 1"
);
if (!user) throw new Error('No active procurement/admin user found.');
const token = jwt.sign({ id: user.id }, secret);

const [reviews] = await pool.execute(
  `SELECT r.id AS reviewId, r.rfq_id AS rfqId, r.token, r.recipient_email AS email,
          r.submitted_at AS submittedAt, f.reference
     FROM rfq_committee_reviews r JOIN rfqs f ON f.id = r.rfq_id
    WHERE r.submitted_at IS NULL
    ORDER BY r.id DESC LIMIT 1`
);
const review = reviews[0];
if (!review) throw new Error('No unsubmitted committee review found.');

const response = await fetch(
  `http://127.0.0.1:4000/api/rfqs/${review.rfqId}/committee-reviews/${review.reviewId}/resend`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}'
  }
);
console.log(JSON.stringify({
  status: response.status,
  body: await response.json(),
  review: { ...review, link: `${process.env.APP_BASE_URL || process.env.CLIENT_ORIGIN}/committee-review?token=${review.token}` }
}, null, 2));
await pool.end();
