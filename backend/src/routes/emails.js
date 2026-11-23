import { Router } from 'express';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { allowRoles } from '../middleware/auth.js';
import { buildTestEmail, sendEmail, verifyEmailConnection } from '../services/email.js';
import {
  createResendDelivery, listRfqDeliveries, retryFailedDeliveries, sendRfqDeliveries
} from '../services/rfq-email.js';
import { emailConfigStatus, normalizeEmail, validEmail } from '../utils/email-config.js';

const router = Router();
const managers = ['admin', 'procurement'];

router.get('/email/config', allowRoles(...managers), (_req, res) => {
  return res.json({ config: emailConfigStatus() });
});

router.post('/email/verify', allowRoles(...managers), async (req, res, next) => {
  try {
    const result = await verifyEmailConnection();
    if (!result.ok) return res.status(503).json(result);
    await writeAudit(pool, req.user.id, 'verified', 'email_config', 'smtp', { ok: true });
    return res.json(result);
  } catch (error) { return next(error); }
});

router.post('/email/test', allowRoles(...managers), async (req, res, next) => {
  try {
    const recipient = normalizeEmail(req.user.email);
    if (!validEmail(recipient)) {
      return res.status(400).json({ message: 'Your account has no valid email address. Update it before sending a test.' });
    }
    const result = await sendEmail({ ...buildTestEmail(), to: recipient });
    await writeAudit(pool, req.user.id, 'tested', 'email_config', recipient, {
      status: result.status,
      reason: result.reason || null,
      providerMessageId: result.providerMessageId || null
    });
    if (!result.ok) return res.status(503).json({ message: result.error?.message || 'Email provider rejected the test message.', result });
    return res.json({
      message: 'Test message accepted by the email provider. Provider acceptance is not proof of inbox delivery.',
      result
    });
  } catch (error) { return next(error); }
});

router.get('/rfqs/:id/email-deliveries', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const result = await listRfqDeliveries(req.params.id);
    return res.json({ rfq, ...result, config: emailConfigStatus() });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/emails/retry-failed', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const result = await retryFailedDeliveries({ rfqId: req.params.id, userId: req.user.id });
    const deliveries = await listRfqDeliveries(req.params.id);
    return res.json({ message: 'Failed recipient retry completed.', result, ...deliveries });
  } catch (error) { return next(error); }
});

router.post('/rfqs/:id/email-deliveries/:deliveryId/resend', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const deliveryId = await createResendDelivery({
      rfqId: req.params.id,
      deliveryId: req.params.deliveryId,
      userId: req.user.id
    });
    if (!deliveryId) return res.status(404).json({ message: 'Delivery record not found for this RFQ.' });
    const result = await sendRfqDeliveries({ rfqId: req.params.id, deliveryIds: [deliveryId] });
    const deliveries = await listRfqDeliveries(req.params.id);
    return res.json({ message: 'RFQ link resent to the selected Supplier.', result, ...deliveries });
  } catch (error) { return next(error); }
});

export default router;
