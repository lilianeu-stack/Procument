import { Router } from 'express';
import pool from '../config/db.js';
import { writeAudit } from '../lib/events.js';
import { authenticate } from '../middleware/auth.js';
import {
  availableExports, canExport, exportFilename, fetchExportRows, fetchRecord,
  renderCsv, renderPdf, renderRecordCsv, renderRecordPdf, renderRecordXlsx,
  renderXlsx
} from '../services/exports.js';

const router = Router();
const FORMATS = new Set(['pdf', 'xlsx', 'csv']);
const MIME_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8'
};

router.use(authenticate);

router.get('/available', (req, res) => {
  return res.json({ exports: availableExports().filter((item) => canExport(req.user, item.key)) });
});

router.get('/:key/:format', async (req, res, next) => {
  const { key, format } = req.params;
  if (!FORMATS.has(format)) {
    return res.status(400).json({ message: 'Unsupported export format. Choose pdf, xlsx, or csv.' });
  }
  if (!canExport(req.user, key)) {
    return res.status(403).json({ message: 'You do not have permission to export this report.' });
  }
  try {
    const reference = String(req.query.reference || '').trim().slice(0, 60);
    const report = await fetchExportRows(key, req.query, req.user);
    let content;
    if (format === 'pdf') content = await renderPdf(report, reference);
    else if (format === 'xlsx') content = await renderXlsx(report, reference);
    else content = renderCsv(report);

    try {
      await writeAudit(
        pool, req.user.id, 'exported', 'report', key,
        {
          format, rows: report.rows.length, reference: reference || null,
          dateField: report.dateField, from: report.from || null, to: report.to || null
        }
      );
    } catch (auditError) {
      // Export success should not depend on an audit insert; the global error
      // handler still records the failure for administrators.
      console.error('Export audit write failed:', auditError.message);
    }
    res.setHeader('Content-Type', MIME_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(report.label, format, reference)}"`);
    res.setHeader('Content-Length', content.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(content);
  } catch (error) {
    return next(error);
  }
});

router.get('/record/:type/:id/:format', async (req, res, next) => {
  const { type, id, format } = req.params;
  const recordId = Number(id);
  if (!FORMATS.has(format)) {
    return res.status(400).json({ message: 'Unsupported export format. Choose pdf, xlsx, or csv.' });
  }
  if (!Number.isInteger(recordId) || recordId < 1) {
    return res.status(400).json({ message: 'Invalid record reference.' });
  }
  try {
    const record = await fetchRecord(type, recordId, req.user);
    let content;
    if (format === 'pdf') content = await renderRecordPdf(record);
    else if (format === 'xlsx') content = await renderRecordXlsx(record);
    else content = renderRecordCsv(record);

    try {
      await writeAudit(
        pool, req.user.id, 'exported', 'record', `${type}:${recordId}`,
        { format, reference: record.reference, recordType: type }
      );
    } catch (auditError) {
      console.error('Record export audit write failed:', auditError.message);
    }
    res.setHeader('Content-Type', MIME_TYPES[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(record.label, format, record.reference)}"`);
    res.setHeader('Content-Length', content.length);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.end(content);
  } catch (error) {
    return next(error);
  }
});

export default router;
