const { defaultAppender } = require('../../../infrastructure/logging/RotatingFileAppender');

/**
 * HttpAccessLogger (Interfaces Layer - Middleware)
 * High-performance, non-blocking HTTP request access logger.
 * Formats every incoming HTTP request and outputs to:
 * - logs/access-YYYY-MM-DD.log (Rotating async stream)
 */
function createHttpAccessLogger(appender = defaultAppender) {
  return function httpAccessLogger(req, res, next) {
    const startHrTime = process.hrtime();
    const timestamp = new Date().toISOString();
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || '127.0.0.1';
    const method = req.method;
    const url = req.originalUrl || req.url;

    // Hook into response finish
    res.on('finish', () => {
      const elapsedHr = process.hrtime(startHrTime);
      const elapsedMs = (elapsedHr[0] * 1000 + elapsedHr[1] / 1e6).toFixed(1);
      const statusCode = res.statusCode;

      // Filter out high-frequency noise like SSE ping/stream to protect disk
      if (url.includes('/api/bots/stream') || url.includes('/api/health')) {
        return;
      }

      const logLine = `[${timestamp}] [HTTP] ${method} ${url} ${statusCode} (${elapsedMs}ms) - IP: ${clientIp}`;

      if (appender) {
        appender.write('access', logLine);
      }
    });

    if (typeof next === 'function') {
      next();
    }
  };
}

module.exports = {
  createHttpAccessLogger
};

