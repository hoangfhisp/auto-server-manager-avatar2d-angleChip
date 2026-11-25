const fs = require('fs');
const path = require('path');

/**
 * RotatingFileAppender (Infrastructure Layer - Logging)
 * High-performance, non-blocking asynchronous file logger with:
 * - Daily rotation: logs/app-YYYY-MM-DD.log, logs/error-YYYY-MM-DD.log
 * - Buffered asynchronous writes (zero event-loop blocking)
 * - Automatic retention cleanup: auto-deletes log files older than maxRetentionDays (default 7 days)
 *   protecting cPanel hosting disk quotas.
 */
class RotatingFileAppender {
  constructor({
    logsDir = path.resolve(process.cwd(), 'logs'),
    maxRetentionDays = 7,
    flushIntervalMs = 800
  } = {}) {
    this.logsDir = logsDir;
    this.maxRetentionDays = maxRetentionDays;
    this.flushIntervalMs = flushIntervalMs;

    this.currentDateStr = this._getDateStr();
    this.streams = new Map(); // key: 'app' | 'error' | 'access' -> WriteStream
    this.buffers = new Map(); // key -> Array<string>
    this.flushTimer = null;
    this.lastCleanupDate = null;

    this._ensureDir();
    this._startFlushLoop();
    this._cleanupOldLogs();
  }

  _getDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  _ensureDir() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (e) {
      console.error('[RotatingFileAppender] Cannot create logs directory:', e.message);
    }
  }

  _getStream(type) {
    const today = this._getDateStr();
    if (today !== this.currentDateStr) {
      // Midnight rotation: close old streams and update date
      this._rotateStreams(today);
    }

    if (!this.streams.has(type)) {
      const filePath = path.join(this.logsDir, `${type}-${this.currentDateStr}.log`);
      const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
      stream.on('error', (err) => {
        console.error(`[RotatingFileAppender] WriteStream error for ${type}:`, err.message);
      });
      this.streams.set(type, stream);
    }

    return this.streams.get(type);
  }

  _rotateStreams(newDateStr) {
    this.flushSync();
    for (const [type, stream] of this.streams.entries()) {
      try {
        stream.end();
      } catch (e) {}
    }
    this.streams.clear();
    this.currentDateStr = newDateStr;
    this._cleanupOldLogs();
  }

  write(type, text) {
    if (!this.buffers.has(type)) {
      this.buffers.set(type, []);
    }
    const buf = this.buffers.get(type);
    buf.push(text.endsWith('\n') ? text : text + '\n');

    // Flush immediately if buffer grows large (> 100 entries)
    if (buf.length >= 100) {
      this._flushType(type);
    }
  }

  _flushType(type) {
    const buf = this.buffers.get(type);
    if (!buf || buf.length === 0) return;

    const chunk = buf.join('');
    this.buffers.set(type, []);

    const stream = this._getStream(type);
    if (stream && !stream.destroyed) {
      stream.write(chunk);
    }
  }

  flushSync() {
    for (const type of this.buffers.keys()) {
      this._flushType(type);
    }
  }

  _startFlushLoop() {
    this.flushTimer = setInterval(() => {
      for (const type of this.buffers.keys()) {
        this._flushType(type);
      }
    }, this.flushIntervalMs);

    if (this.flushTimer.unref) {
      this.flushTimer.unref(); // Do not hold Node process open on exit
    }
  }

  /**
   * Scans logs directory and deletes files older than maxRetentionDays
   */
  _cleanupOldLogs() {
    const today = this._getDateStr();
    if (this.lastCleanupDate === today) return;
    this.lastCleanupDate = today;

    try {
      if (!fs.existsSync(this.logsDir)) return;
      const now = Date.now();
      const maxAgeMs = this.maxRetentionDays * 24 * 60 * 60 * 1000;
      const files = fs.readdirSync(this.logsDir);

      for (const file of files) {
        // Only inspect log files matching pattern: <type>-YYYY-MM-DD.log
        const match = file.match(/^(?:app|error|access|http)-(\d{4}-\d{2}-\d{2})\.log$/);
        if (match) {
          const fileDateStr = match[1];
          const fileTime = new Date(fileDateStr).getTime();
          if (!isNaN(fileTime) && (now - fileTime > maxAgeMs)) {
            const filePath = path.join(this.logsDir, file);
            try {
              fs.unlinkSync(filePath);
              console.log(`[RotatingFileAppender] Purged expired log file (> ${this.maxRetentionDays} days): ${file}`);
            } catch (delErr) {}
          }
        }
      }
    } catch (e) {
      console.warn('[RotatingFileAppender] Log cleanup warning:', e.message);
    }
  }

  close() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushSync();
    for (const stream of this.streams.values()) {
      try {
        stream.end();
      } catch (e) {}
    }
    this.streams.clear();
  }
}

// Default singleton instance
const defaultAppender = new RotatingFileAppender();

module.exports = {
  RotatingFileAppender,
  defaultAppender
};

