import { Router } from 'express';
import pool from '../config/db.js';
import { markNotificationRead } from '../lib/notification-reads.js';
import {
  countNotifications,
  createNotificationRecord,
  dismissNotification,
  getNotification,
  listNotifications,
  normalizeNotificationFilter
} from '../services/notification-service.js';

const router = Router();

function notificationId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// A single grouped response supplies the dropdown, the notification page, and
// the authoritative filter counts. Every row is constrained to the session's
// user id or to a broadcast row the user is allowed to see.
router.get('/', async (req, res, next) => {
  try {
    const filter = normalizeNotificationFilter(req.query.filter);
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const [notifications, counts] = await Promise.all([
      listNotifications(pool, req.user.id, { filter, limit, offset }),
      countNotifications(pool, req.user.id)
    ]);
    return res.json({ notifications, counts, filter, limit, offset });
  } catch (error) { return next(error); }
});

// Client-side failures (offline requests, timeouts) are recorded only when the
// server can verify them against the authenticated session. The recipient is
// always the authenticated user; a payload cannot address another account.
router.post('/', async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const notice = await createNotificationRecord(pool, {
      ...payload,
      userId: req.user.id,
      requestId: req.id || payload.requestId
    });
    if (!notice || notice.duplicate) {
      return res.status(200).json({ notification: null, duplicate: true });
    }
    const counts = await countNotifications(pool, req.user.id);
    return res.status(201).json({ notification: notice, counts });
  } catch (error) { return next(error); }
});

router.patch('/:id/read', async (req, res, next) => {
  try {
    const id = notificationId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid notification identifier.' });
    const existing = await getNotification(pool, id, req.user.id);
    if (!existing) return res.status(404).json({ message: 'Notification not found.' });
    const ids = await markNotificationRead(pool, req.user.id, id);
    const counts = await countNotifications(pool, req.user.id);
    return res.json({ message: 'Notification marked as read.', updated: ids.length, counts });
  } catch (error) { return next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const id = notificationId(req.params.id);
    if (!id) return res.status(400).json({ message: 'Invalid notification identifier.' });
    const result = await dismissNotification(pool, req.user.id, id);
    if (!result) return res.status(404).json({ message: 'Notification not found.' });
    const counts = await countNotifications(pool, req.user.id);
    return res.json({ message: 'Notification dismissed.', ...result, counts });
  } catch (error) { return next(error); }
});

export default router;
