const levels = new Set(['INFO', 'SUCCESS', 'WARN', 'ERROR', 'DEBUG']);

export function log(level, message) {
  if (!levels.has(level)) throw new Error(`Unsupported log level: ${level}`);
  if (level === 'DEBUG' && process.env.NODE_ENV !== 'development') return;

  console.log(`[ ${level} ] ${new Date().toISOString()} ${message}`);
}

export function errorCode(error) {
  const code = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'UNKNOWN';
}
