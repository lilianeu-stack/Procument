import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { errorCode, log } from './lib/logger.js';

// src/server.js -> backend/.env (the backend root, regardless of cwd).
const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const PLACEHOLDER_PATTERN = /^(REPLACE_WITH|YOUR[_-]|CHANGE[_-]?ME|CHANGEME|TODO|EXAMPLE|PLACEHOLDER)/i;
const REQUIRED_VARIABLES = ['DB_HOST', 'DB_USER', 'DB_NAME', 'JWT_SECRET'];

let server;
let pool;
let shutdownPromise;
let startupStage = 'environment configuration';

function env(name) {
  return String(process.env[name] ?? '').trim();
}

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERN.test(value);
}

function getConfig() {
  const environment = env('NODE_ENV') || 'development';
  const missing = REQUIRED_VARIABLES.filter((name) => !env(name));
  const placeholders = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'JWT_SECRET']
    .filter((name) => env(name) && isPlaceholder(env(name)));

  if (environment === 'production' && !env('DB_PASSWORD')) missing.push('DB_PASSWORD');
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Copy backend/.env.example to backend/.env and set the values for your MySQL server and a generated JWT secret.'
    );
  }
  if (placeholders.length) {
    throw new Error(
      `Placeholder value(s) still configured in backend/.env: ${placeholders.join(', ')}. ` +
      'Replace them with real local values before starting the backend.'
    );
  }
  if (env('JWT_SECRET').length < 32) {
    throw new Error('JWT_SECRET must be a random value of at least 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }

  const portValue = env('PORT') || (environment === 'development' ? '4000' : '');
  if (!portValue) throw new Error('PORT must be set when NODE_ENV is production.');
  const port = Number(portValue);
  if (!/^\d+$/.test(portValue) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a whole number between 1 and 65535.');
  }

  const databasePortValue = env('DB_PORT') || '3307';
  const databasePort = Number(databasePortValue);
  if (!/^\d+$/.test(databasePortValue) || !Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error('DB_PORT must be a whole number between 1 and 65535.');
  }

  return {
    environment,
    host: env('HOST') || '0.0.0.0',
    port
  };
}

function databaseTroubleshooting(error) {
  const code = errorCode(error);
  if (code === 'ER_ACCESS_DENIED_ERROR' || code === 'ER_DBACCESS_DENIED_ERROR') {
    return 'MySQL rejected DB_USER/DB_PASSWORD, or the user lacks access to DB_NAME. Check the credentials and grants in backend/.env.';
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return 'The configured DB_NAME does not exist. Create the database and load backend/database/schema.sql, or correct DB_NAME in backend/.env.';
  }
  if (code === 'ECONNREFUSED') {
    return 'MySQL refused the connection. Start the database service (or Docker container) and verify DB_HOST and DB_PORT in backend/.env.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'DB_HOST could not be resolved. Check the hostname in backend/.env.';
  }
  if (code === 'ETIMEDOUT' || code === 'PROTOCOL_CONNECTION_LOST') {
    return 'The MySQL connection timed out or was lost. Check database availability, network access, and firewall rules.';
  }
  return `MySQL connection failed (${code}). Verify DB_HOST, DB_PORT, DB_NAME, credentials, and that the schema is initialized.`;
}

function reportStartupFailure(error, stage) {
  const code = errorCode(error);
  if (error.code === 'EADDRINUSE') {
    log('ERROR', `Port ${env('PORT') || '4000'} is already in use. Stop the other process or set a different PORT in backend/.env.`);
  } else if (error.code === 'EACCES') {
    log('ERROR', `Permission denied while binding to port ${env('PORT') || '4000'}. Choose an unprivileged port and verify host permissions.`);
  } else if (error.code === 'EADDRNOTAVAIL') {
    log('ERROR', `Host ${env('HOST') || '0.0.0.0'} is unavailable. Verify the HOST setting in backend/.env and the network interfaces.`);
  } else if (stage === 'database') {
    log('ERROR', databaseTroubleshooting(error));
  } else if (stage === 'environment configuration' || stage === 'database configuration') {
    log('ERROR', error.message);
  } else {
    log('ERROR', `${stage} failed (${code}).`);
  }
}

function listen(app, config) {
  return new Promise((resolve, reject) => {
    const httpServer = app.listen(config.port, config.host);
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      httpServer.removeListener('error', reject);
      httpServer.requestTimeout = 120000;
      httpServer.headersTimeout = 65000;
      httpServer.keepAliveTimeout = 5000;
      resolve(httpServer);
    });
  });
}

function displayUrl(config) {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const formatted = host.includes(':') ? `[${host}]` : host;
  return `http://${formatted}:${config.port}`;
}

function printReadyBanner(config) {
  const baseUrl = displayUrl(config);
  console.log('');
  console.log('[ SUCCESS ] Environment variables loaded');
  console.log('[ SUCCESS ] Database configuration validated');
  console.log('[ SUCCESS ] Database connection established');
  console.log('[ SUCCESS ] Database authentication successful');
  console.log('[ SUCCESS ] Express application initialized');
  console.log('[ SUCCESS ] API routes registered');
  console.log('[ SUCCESS ] Backend server started');
  console.log('');
  console.log('SERVER STATUS: RUNNING');
  console.log('DATABASE STATUS: CONNECTED');
  console.log('');
  console.log(`API: ${baseUrl}/api`);
  console.log(`HEALTH: ${baseUrl}/api/health`);
  console.log('');
  console.log('========================================');
}

async function closeResources() {
  if (server?.listening) {
    const closeServer = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    const forceCloseTimer = setTimeout(() => {
      log('WARN', 'Shutdown is taking longer than 10 seconds; closing remaining HTTP connections.');
      server.closeAllConnections?.();
    }, 10000);
    try {
      await closeServer;
    } finally {
      clearTimeout(forceCloseTimer);
    }
  }
  if (pool) await pool.end();
}

function shutdown(reason) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    log('INFO', `Shutting down (${reason})...`);
    try {
      await closeResources();
      log('SUCCESS', 'HTTP server and database connections closed.');
    } catch (error) {
      process.exitCode = 1;
      log('ERROR', `Shutdown could not close all resources (${errorCode(error)}).`);
    }
  })();
  return shutdownPromise;
}

process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('unhandledRejection', (reason) => {
  process.exitCode = 1;
  log('ERROR', `Unhandled promise rejection (${errorCode(reason)}); shutting down.`);
  void shutdown('unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  process.exitCode = 1;
  log('ERROR', `Uncaught exception (${errorCode(error)}); shutting down.`);
  void shutdown('uncaught exception');
});

async function start() {
  startupStage = 'environment configuration';
  log('INFO', 'Loading environment variables...');
  const dotenvResult = dotenv.config({ path: envPath });
  if (dotenvResult.error?.code === 'ENOENT') {
    throw new Error('backend/.env was not found. Run: Copy-Item backend\\.env.example backend\\.env - then configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME and JWT_SECRET.');
  }
  if (dotenvResult.error) {
    throw new Error('Unable to parse backend/.env. Check its syntax and encoding.');
  }
  const config = getConfig();

  const { emailConfigStatus } = await import('./utils/email-config.js');
  const { googleEmailConfigStatus } = await import('./services/google-email.js');
  const email = emailConfigStatus();
  const googleEmail = googleEmailConfigStatus();
  if (email.configured) {
    log('INFO', 'Supplier email delivery is configured through SMTP (credentials hidden).');
  } else if (googleEmail.configured) {
    log('INFO', 'SMTP is unavailable; Google Gmail API can send email after the mailbox is connected.');
  } else {
    log('WARN', `Email sending needs SMTP or Google OAuth. Missing SMTP variable(s): ${email.missing.join(', ')}. Missing Google variable(s): ${googleEmail.missing.join(', ')}.`);
  }

  startupStage = 'database configuration';
  log('INFO', 'Validating database configuration...');
  log('INFO', `Database target: ${env('DB_HOST')}:${env('DB_PORT') || '3307'} (credentials hidden)`);

  startupStage = 'database';
  log('INFO', 'Testing MySQL database connection...');
  const database = await import('./config/db.js');
  pool = database.default;
  await database.verifyDatabaseConnection();
  await database.applySchemaMigrations();

  startupStage = 'Express application initialization';
  log('INFO', 'Initializing Express application and API routes...');
  const { default: app } = await import('./app.js');

  startupStage = 'HTTP server startup';
  log('INFO', `Starting HTTP server on ${displayUrl(config)}...`);
  server = await listen(app, config);
  printReadyBanner(config);
}

try {
  await start();
} catch (error) {
  process.exitCode = 1;
  reportStartupFailure(error, startupStage);
  try {
    if (pool) await pool.end();
  } catch (closeError) {
    log('ERROR', `Could not close the database pool (${errorCode(closeError)}).`);
  }
}
