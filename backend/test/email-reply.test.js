import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequestedItemsEmail, extractReplyComment, findRequisitionReplyTag, replyTag
} from '../src/utils/email-reply.js';
import { buildRfqEmail } from '../src/services/email.js';

const token = 'a'.repeat(32);

test('reply tag links a reply to the correct requisition', () => {
  const tag = replyTag(42, token);
  const found = findRequisitionReplyTag(`Re: Requested items - PR-2026-F1 ${tag}`, `Reply tag: ${tag}`);
  assert.deepEqual(found, { requisitionId: 42, token });
  assert.equal(findRequisitionReplyTag('unrelated reply'), null);
});

test('recipient comment keeps typed text and removes quoted original email', () => {
  const body = [
    'Please deliver on Monday.',
    'We also need 2 extra units.',
    '',
    'On Tue, 24 Nov 2026, procurement wrote:',
    '> Request: PR-2026-F1',
    '> Requested items:',
    '> - PC 2 pieces x RWF 300.00',
    `> ${replyTag(42, token)}`
  ].join('\n');
  assert.equal(extractReplyComment(body), 'Please deliver on Monday.\nWe also need 2 extra units.');
});

test('requested items email contains a quantity form and reply instructions', () => {
  const email = buildRequestedItemsEmail({
    requisitionId: 42,
    reference: 'PR-2026-F1',
    title: 'IT office requirements',
    department: 'IT',
    requester: 'mugabo patrick',
    recipientPhone: '0781793232',
    message: 'Please confirm these quantities.',
    token,
    responseUrl: `http://localhost:5173/#/response?token=${token}`,
    items: [{
      itemName: 'PC',
      description: 'Desktop computer',
      quantity: 2,
      unit: 'pieces',
      estimatedUnitCost: 300,
      lineTotal: 600
    }]
  });

  assert.match(email.subject, /\[REQ:42:a{32}\]/);
  assert.match(email.text, /Item \| Description \| Quantity \| Unit price \| Total/);
  assert.match(email.text, /PC \| Desktop computer \| 2 pieces \| RWF 300\.00 \| RWF 600\.00/);
  assert.match(email.text, /GRAND TOTAL: RWF 600\.00/);
  assert.match(email.text, /ADD A COMMENT \/ RESPOND ONLINE/);
  assert.match(email.text, /http:\/\/localhost:5173\/#\/response\?token=a{32}/);
  assert.match(email.text, /TO ADD A COMMENT/);
  assert.match(email.html, /<th[^>]*>Quantity<\/th>/);
  assert.match(email.html, /2 pieces/);
  assert.match(email.html, /href="http:\/\/localhost:5173\/#\/response\?token=a{32}"/);
  assert.match(email.html, /Add a comment \/ respond online/);
  assert.match(email.html, /To add a comment/);
  assert.match(email.html, /\[REQ:42:a{32}\]/);
});

test('requested items email carries the sender name and inline signature image', () => {
  const signature = `data:image/webp;base64,${Buffer.from('signature-bytes').toString('base64')}`;
  const email = buildRequestedItemsEmail({
    requisitionId: 42,
    reference: 'HHR/28/11/26/0003',
    title: 'IT office requirements',
    senderName: 'Jane Sender',
    senderSignature: signature,
    token,
    responseUrl: `https://public.example.test/response/${token}`,
    items: [{
      itemName: 'PC',
      quantity: 2,
      unit: 'pieces',
      estimatedUnitCost: 300,
      lineTotal: 600
    }]
  });

  assert.match(email.text, /Sent by: Jane Sender/);
  assert.match(email.html, /Sent by/);
  assert.match(email.html, /Jane Sender/);
  assert.match(email.html, /src="cid:requisition-sender-signature"/);
  assert.equal(email.inlineImages.length, 1);
  assert.equal(email.inlineImages[0].cid, 'requisition-sender-signature');
  assert.equal(email.inlineImages[0].contentType, 'image/webp');
  assert.equal(email.inlineImages[0].content.toString('utf8'), 'signature-bytes');
  assert.doesNotMatch(email.html, /data:image/);
});

test('RFQ email carries the Procurement name and inline signature image', () => {
  const signature = `data:image/webp;base64,${Buffer.from('rfq-signature-bytes').toString('base64')}`;
  const email = buildRfqEmail({
    supplierName: 'Test Supplier',
    reference: 'RFQ-2026-0001',
    requisitionReference: 'PR-2026-F1',
    title: 'IT office requirements',
    items: [{ itemName: 'Laptop', quantity: 2, unit: 'unit' }],
    senderName: 'Jane Procurement',
    senderSignature: signature,
    rawToken: 'v1.payload.signature'
  });

  assert.match(email.text, /Sent by: Jane Procurement/);
  assert.match(email.html, /Sent by/);
  assert.match(email.html, /Jane Procurement/);
  assert.match(email.html, /src="cid:rfq-sender-signature"/);
  assert.equal(email.inlineImages.length, 1);
  assert.equal(email.inlineImages[0].cid, 'rfq-sender-signature');
  assert.equal(email.inlineImages[0].content.toString('utf8'), 'rfq-signature-bytes');
  assert.doesNotMatch(email.html, /data:image/);
});

test('supplier form email reuses the requisition item table and secure supplier link', () => {
  const email = buildRequestedItemsEmail({
    requisitionId: 42,
    reference: 'RFQ-1',
    title: 'IT office requirements',
    items: [{
      itemName: 'PC',
      description: 'Desktop computer',
      quantity: 2,
      unit: 'pieces',
      estimatedUnitCost: 300,
      lineTotal: 600
    }],
    token,
    subject: 'Requested items - RFQ-1',
    greeting: 'Dear Test Supplier,',
    details: [
      ['RFQ', 'RFQ-1'],
      ['Requisition', 'PR-2026-F1'],
      ['Supplier', 'Test Supplier']
    ],
    responseUrl: 'http://localhost:5173/#/supplier/RFQ?token=v1.test.token',
    responseLabel: 'View request and respond',
    responseIntro: 'Open this secure link to review the request and submit your response',
    responseHelp: 'Your response is visible to Procurement only.',
    instructionsTitle: 'To respond',
    instructionsText: 'Open the secure link above, review the requested items and submit your quotation.',
    includeReplyTag: false
  });

  assert.equal(email.subject, 'Requested items - RFQ-1');
  assert.match(email.text, /Item \| Description \| Quantity \| Unit price \| Total/);
  assert.match(email.text, /PC \| Desktop computer \| 2 pieces \| RWF 300\.00 \| RWF 600\.00/);
  assert.match(email.text, /VIEW REQUEST AND RESPOND/);
  assert.match(email.text, /#\/supplier\/RFQ\?token=v1\.test\.token/);
  assert.doesNotMatch(email.text, /\[REQ:42:a{32}\]/);
  assert.doesNotMatch(email.text, /Request for Quotation/);
  assert.match(email.html, /<th[^>]*>Quantity<\/th>/);
  assert.match(email.html, /View request and respond/);
  assert.match(email.html, /#\/supplier\/RFQ\?token=v1\.test\.token/);
  assert.doesNotMatch(email.html, /\[REQ:42:a{32}\]/);
});
