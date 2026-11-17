import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import api from './routes/api.js';

const app = express();
app.use(helmet());
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({
  origin(origin, callback) {
    const localDevOrigin = process.env.NODE_ENV !== 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || '');
    if (!origin || origin === clientOrigin || localDevOrigin) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  }
}));
app.use(express.json({ limit: '1mb' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api', api);
app.use((err, _req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  return res.status(status).json({
    message: status === 500 ? 'An unexpected server error occurred.' : err.message
  });
});

export default app;
