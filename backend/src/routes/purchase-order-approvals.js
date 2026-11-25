import { Router } from 'express';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import {
  approvalView, assertApprovalLinkUsable, assertApprovalRecipient,
  emailFailureMessage, expireApprovalIfNeeded, findApprovalByToken,
  notifySenderOfDecision, recordPurchaseOrderDecision, transaction
} from './workflows.js';

const router = Router();

function invalidDecision(decision, comment) {
  if (!['Approved', 'Rejected'].includes(decision)) {
    return 'Decision must be Approved or Rejected.';
  }
  if (decision === 'Rejected' && !String(comment || '').trim()) {
    return 'A rejection reason is required.';
  }
  return '';
}

// Public URL, but the token is a 256-bit secret whose hash is stored with one
// Purchase Order and one recipient. The staff session is checked separately so
// another signed-in user cannot use a forwarded link.
router.get('/purchase-order-approvals/:token', optionalAuthenticate, async (req, res, next) => {
  try {
    const approval = await findApprovalByToken(pool, req.params.token);
    await expireApprovalIfNeeded(pool, approval);
    assertApprovalLinkUsable(approval);
    assertApprovalRecipient(req.user, approval);

    if (!approval.viewedAt) {
      const viewedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await pool.execute(
        'UPDATE purchase_order_approval_requests SET viewed_at = ? WHERE id = ? AND viewed_at IS NULL',
        [viewedAt, approval.id]
      );
      approval.viewedAt = viewedAt;
      await writeAudit(
        pool, req.user.id, 'approval_link_viewed', 'purchase_order', approval.purchaseOrderId,
        { approvalRequestId: approval.id, recipientEmail: approval.recipientEmail }
      );
    }
    return res.json({ approval: await approvalView(pool, approval) });
  } catch (error) { return next(error); }
});

router.post('/purchase-order-approvals/:token/decision', optionalAuthenticate, async (req, res, next) => {
  const decision = req.body.decision;
  const comment = String(req.body.comment || '').trim().slice(0, 2000);
  const problem = invalidDecision(decision, comment);
  if (problem) return res.status(400).json({ message: problem });

  return transaction(async (connection) => {
    const approval = await findApprovalByToken(connection, req.params.token);
    await expireApprovalIfNeeded(connection, approval);
    assertApprovalLinkUsable(approval);
    assertApprovalRecipient(req.user, approval);

    await recordPurchaseOrderDecision(connection, {
      id: approval.purchaseOrderId,
      approval,
      decision,
      comment,
      actorId: req.user.id
    });

    const fresh = await findApprovalByToken(connection, req.params.token);
    const body = {
      message: decision === 'Approved'
        ? 'Purchase order approved. The sender has been notified.'
        : 'Purchase order rejected. The sender has been notified.',
      approval: await approvalView(connection, fresh),
      emailDelivery: null
    };
    return {
      body,
      afterCommit: async () => {
        body.emailDelivery = await notifySenderOfDecision(
          req.user.id, fresh, decision, comment
        );
        body.message = emailFailureMessage(
          body.emailDelivery,
          decision === 'Approved'
            ? 'Purchase order approved. The sender has been notified.'
            : 'Purchase order rejected. The sender has been notified.',
          'decision'
        );
      }
    };
  }, res, next);
});

export default router;
