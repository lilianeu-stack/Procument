import { committeeReviewEmailHtml } from './src/services/committee-review.js';

const section = {
  id: 7,
  reference: 'RFQ-TEST',
  requisitionReference: 'PR-TEST',
  title: 'Test',
  department: 'IT',
  issuedAt: null,
  dueDate: null,
  message: '',
  requestedItems: [],
  suppliers: []
};
const html = committeeReviewEmailHtml({
  recipientName: 'Test',
  sections: [section],
  links: [{ id: 7, reference: 'RFQ-TEST', url: 'https://example.com/committee-review?token=abc' }],
  generatedAt: 'now'
});
console.log([...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]));
