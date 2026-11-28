import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { verifyDatabaseConnection } from './config/db.js';
import { errorCode, log } from './lib/logger.js';
import api from './routes/api.js';

function isLocalOrigin(origin) {
  if (!origin) return false;
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname);
  } catch {
    return false;
  }
}

const app = express();
// Profile photos are loaded into object URLs by the shared avatar component;
// allow those image sources without weakening the rest of the CSP.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: { 'img-src': ["'self'", 'data:', 'blob:'] }
  }
}));
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin(origin, callback) {
    const localDevOrigin = process.env.NODE_ENV !== 'production' && isLocalOrigin(origin);
    if (!origin || origin === clientOrigin || localDevOrigin) return callback(null, true);
    return callback(null, false);
  }
}));
// Attachments are submitted as base64 in JSON so the existing API client can
// carry them without a second upload system. Allow room for a small document.
app.use(express.json({ limit: '12mb' }));
app.get('/api/health', async (_req, res) => {
  let database = 'connected';
  try {
    await verifyDatabaseConnection();
  } catch (error) {
    database = 'disconnected';
    log('WARN', `Health check could not reach MySQL (${errorCode(error)}).`);
  }

  const success = database === 'connected';
  return res.status(success ? 200 : 503).json({
    success,
    application: 'Procurement Management System',
    server: 'running',
    database,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime())
  });
});
app.use('/api', api);
app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) log('ERROR', `An API request failed (${errorCode(err)}): ${err.message}`);
  // Provider failures (502/503/504) carry a deliberately user-facing message;
  // only truly unexpected 500s are reduced to the generic notice.
  const message = status === 500 ? 'An unexpected server error occurred.' : err.message;
  return res.status(status).json({ message });
});

export default app;
