// Role-aware, shared in-app messaging API. Mounted before the portal firewall
// so every authenticated staff portal can use the same privacy rules and data.

import { Router } from 'express';
import pool from '../config/db.js';
import { allowRoles } from '../middleware/auth.js';
import {
  countUnreadMessages, createMessage, findAttachment, getThread, httpError,
  listConversations, markMessageRead
} from '../services/message-service.js';

const router = Router();
const MESSAGE_ROLES = ['admin', 'procurement', 'supervisor', 'requestor', 'storekeeper'];

async function transaction(handler, res, next) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await handler(connection);
    await connection.commit();
    return res.status(result.status || 200).json(result.body);
  } catch (error) {
    await connection.rollback();
    return next(error);
  } finally {
    connection.release();
  }
}

router.get('/conversations', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    return res.json(await listConversations(req.user, {
      filter: req.query.filter,
      search: req.query.search,
      page: req.query.page,
      pageSize: req.query.pageSize
    }));
  } catch (error) { return next(error); }
});

// Loading a thread deliberately never marks any message read. The client calls
// the explicit read endpoint only after a message has actually been opened.
router.get('/thread', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    return res.json(await getThread(req.user, {
      participantId: req.query.userId,
      announcementId: req.query.announcementId,
      page: req.query.page,
      pageSize: req.query.pageSize
    }));
  } catch (error) { return next(error); }
});

router.get('/unread-count', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    return res.json({ unread: await countUnreadMessages(pool, req.user.id) });
  } catch (error) { return next(error); }
});

router.post('/', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    return await transaction(async (connection) => {
      const body = await createMessage(req.user, req.body || {}, connection);
      return { status: 201, body };
    }, res, next);
  } catch (error) { return next(error); }
});

router.patch('/:id/read', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    return await transaction(async (connection) => {
      const body = await markMessageRead(connection, req.user, req.params.id);
      return { status: 200, body };
    }, res, next);
  } catch (error) { return next(error); }
});

router.get('/attachments/:attachmentId', allowRoles(...MESSAGE_ROLES), async (req, res, next) => {
  try {
    const attachment = await findAttachment(req.user, req.params.attachmentId);
    if (!attachment) return res.status(404).json({ message: 'Attachment not found.' });
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${String(attachment.fileName).replace(/["\r\n]/g, '_')}"`);
    res.setHeader('Content-Length', attachment.fileSize);
    return res.send(attachment.fileData);
  } catch (error) { return next(error); }
});

// Service errors reach the shared Express error middleware so every API
// response has the same request id, safe message, log record and notification.

export default router;
