const EventEmitter = require('events');
const CrossProcessBus = require('../ipc/CrossProcessBus');
const config = require('../../../config');

/**
 * SseEventBus (Infrastructure Layer)
 * Manages Server-Sent Events (SSE) clients and broadcasts logs and status events.
 * Fully synchronized with CrossProcessBus for multi-worker (cPanel / LiteSpeed) environments.
 */
class SseEventBus extends EventEmitter {
  constructor(crossProcessBus = null) {
    super();
    this.clients = new Set();
    this.ipcBus = crossProcessBus || new CrossProcessBus();

    // Listen to remote events published by other worker processes
    this.ipcBus.on('remote-event', (eventRecord) => {
      if (eventRecord && eventRecord.eventType && eventRecord.data !== undefined) {
        this.broadcastLocal(eventRecord.eventType, eventRecord.data);
      }
    });

    // Periodic heartbeat to keep connections alive
    setInterval(() => {
      this.broadcastLocal('ping', { time: Date.now() });
    }, 25000);
  }

  getIpcBus() {
    return this.ipcBus;
  }

  addClient(res, req = null) {
    let allowedOrigin = '*';
    const requestOrigin = req?.headers?.origin;
    const allowedOrigins = config?.cors?.allowedOrigins || ['*'];

    if (requestOrigin) {
      if (
        allowedOrigins.includes(requestOrigin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(requestOrigin)
      ) {
        allowedOrigin = requestOrigin;
      } else if (allowedOrigins.includes('*')) {
        allowedOrigin = '*';
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: 'CORS policy: SSE origin not allowed' }));
        return;
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': allowedOrigin
    });

    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'SSE Live Stream Connected', workerPid: process.pid })}\n\n`);
    this.clients.add(res);

    res.on('close', () => {
      this.clients.delete(res);
    });
  }

  addLog(entry) {
    // 1. Publish to shared disk and broadcast to remote workers
    const formatted = this.ipcBus.publishLog(entry);
    // 2. Broadcast immediately to local worker's connected SSE clients (e.g. PC)
    this.broadcastLocal('log', formatted);
    this.emit('log', formatted);
  }

  getLogs() {
    return this.ipcBus.getLogs();
  }

  getAccountLogs(accountId, username = null) {
    return this.ipcBus.getAccountLogs ? this.ipcBus.getAccountLogs(accountId, username) : [];
  }

  clearAccountLogs(accountId, username = null) {
    if (this.ipcBus.clearAccountLogs) {
      this.ipcBus.clearAccountLogs(accountId, username);
    }
  }

  clearLogs() {
    this.ipcBus.clearLogs();
    this.broadcastLocal('clear-logs', { success: true });
  }

  /**
   * Broadcast only to clients connected directly to this worker process
   */
  broadcastLocal(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch (err) {
        this.clients.delete(client);
      }
    }
  }

  /**
   * Broadcast locally AND publish to all other workers
   */
  broadcast(eventType, data) {
    this.broadcastLocal(eventType, data);
    this.ipcBus.publishEvent(eventType, data);
  }

  getClientCount() {
    return this.clients.size;
  }
}

module.exports = SseEventBus;
