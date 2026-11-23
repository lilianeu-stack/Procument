import { Router } from 'express';
import pool from '../config/db.js';
import { allowRoles } from '../middleware/auth.js';
import {
  createResendDelivery, listRfqDeliveries, retryFailedDeliveries, sendRfqDeliveries
} from '../services/rfq-email.js';

const router = Router();
const managers = ['admin', 'procurement'];

router.get('/rfqs/:id/email-deliveries', allowRoles(...managers), async (req, res, next) => {
  try {
    const [[rfq]] = await pool.execute('SELECT id, reference FROM rfqs WHERE id = ?', [req.params.id]);
    if (!rfq) return res.status(404).json({ message: 'RFQ not found.' });
    const result = await listRfqDeliveries(req.params.id);
    return res.json({ rfq, ...result });
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
