const { defaultAppender } = require('./RotatingFileAppender');

/**
 * Logger (Infrastructure Layer - Logging)
 * Enterprise-grade structured logging system:
 * - Dual output: formatted console output + non-blocking rotating file output
 * - Structured levels: INFO, WARN, ERROR, DEBUG
 * - Categorized file outputs:
 *     INFO / WARN  -> logs/app-YYYY-MM-DD.log
 *     ERROR        -> logs/app-YYYY-MM-DD.log AND logs/error-YYYY-MM-DD.log (with cause & full stack)
 * - Clean Architecture compliant, zero dependency on web frameworks
 */
class Logger {
  constructor(context = 'App', appender = defaultAppender) {
    this.context = context;
    this.appender = appender;
  }

  _format(level, message, ...args) {
    const timestamp = new Date().toISOString();
    let text = typeof message === 'string' ? message : (message instanceof Error ? (message.stack || message.message) : JSON.stringify(message));

    let extraStr = '';
    if (args.length > 0) {
      extraStr = ' ' + args.map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }
        return String(a);
      }).join(' ');
    }

    const consolePrefix = `[${timestamp}] [${level}] [${this.context}]`;
    const logLine = `${consolePrefix} ${text}${extraStr}`;
    return { timestamp, level, text, extraStr, logLine };
  }

  info(message, ...args) {
    const { logLine } = this._format('INFO', message, ...args);
    console.log(logLine);
    if (this.appender) {
      this.appender.write('app', logLine);
    }
  }

  warn(message, ...args) {
    const { logLine } = this._format('WARN', message, ...args);
    console.warn(logLine);
    if (this.appender) {
      this.appender.write('app', logLine);
    }
  }

  error(message, ...args) {
    const { logLine } = this._format('ERROR', message, ...args);
    console.error(logLine);

    // Deep error inspection: include err.cause if available
    let detailedError = logLine;
    for (const item of [message, ...args]) {
      if (item && item.cause) {
        const c = item.cause;
        const meta = [c.code, c.errno, c.sqlState].filter(Boolean).join(' / ');
        detailedError += `\n  Caused by: ${meta ? `[${meta}] ` : ''}${c.stack || c.message || String(c)}`;
      }
    }

    if (this.appender) {
      this.appender.write('app', detailedError);
      this.appender.write('error', detailedError);
    }
  }

  debug(message, ...args) {
    if (process.env.NODE_ENV !== 'production') {
      const { logLine } = this._format('DEBUG', message, ...args);
      console.debug(logLine);
      if (this.appender) {
        this.appender.write('app', logLine);
      }
    }
  }
}

// LoggerFactory for clean DI and context instantiation
class LoggerFactory {
  static getLogger(context = 'App') {
    return new Logger(context);
  }
}

const defaultLogger = new Logger('App');

module.exports = {
  Logger,
  LoggerFactory,
  logger: defaultLogger
};
