const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createTestServer } = require('./helpers/testServer');
const config = require('../config');

describe('Server-Sent Events (SSE) Live Stream Test Suite (GET /api/events)', () => {
  let serverCtx;

  before(async () => {
    serverCtx = await createTestServer();
  });

  after(async () => {
    if (serverCtx) {
      await serverCtx.stop();
    }
  });

  it('SSE-001: handshakes properly with valid stream headers', async () => {
    const url = new URL('/api/events', serverCtx.baseUrl);

    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        assert.equal(res.statusCode, 200);
        assert.ok(res.headers['content-type'].includes('text/event-stream'));
        assert.ok(res.headers['cache-control'].includes('no-cache'));
        assert.equal(res.headers['connection'], 'keep-alive');
        assert.equal(res.headers['x-accel-buffering'], 'no');

        let receivedFirstChunk = false;
        res.on('data', (chunk) => {
          const str = chunk.toString();
          if (str.includes('"type":"connected"')) {
            receivedFirstChunk = true;
            req.destroy();
            resolve();
          }
        });

        res.on('error', (err) => {
          if (!receivedFirstChunk) reject(err);
        });
      });

      req.on('error', (err) => {
        // Ignored when destroying request intentionally
        if (req.destroyed) return;
        reject(err);
      });
    });
  });

  it('SSE-002: broadcasts domain events to live connected clients', async () => {
    const url = new URL('/api/events', serverCtx.baseUrl);

    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          if (buffer.includes('event: bot-status-updated')) {
            assert.ok(buffer.includes('acc-test-bot-123'));
            req.destroy();
            resolve();
          }
        });
      });

      req.on('error', (err) => {
        if (req.destroyed) return;
        reject(err);
      });

      // Broadcast an event 50ms after connection is established
      setTimeout(() => {
        serverCtx.httpServer.sseEventBus.broadcast('bot-status-updated', {
          accountId: 'acc-test-bot-123',
          status: 'RUNNING'
        });
      }, 50);
    });
  });

  it('SSE-003: streams live log entries pushed via addLog', async () => {
    const url = new URL('/api/events', serverCtx.baseUrl);

    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        let buffer = '';

        res.on('data', (chunk) => {
          buffer += chunk.toString();

          if (buffer.includes('Thu hoạch 500k xu nông trại')) {
            req.destroy();
            resolve();
          }
        });
      });

      req.on('error', (err) => {
        if (req.destroyed) return;
        reject(err);
      });

      // Emit log entry after client connects
      setTimeout(() => {
        serverCtx.httpServer.sseEventBus.addLog({
          text: 'Thu hoạch 500k xu nông trại thành công!',
          type: 'info'
        });
      }, 50);
    });
  });

  it('SSE-004: enforces CORS policy and rejects forbidden origin with 403', async () => {
    // Configure whitelist with localhost only
    const originalOrigins = config.cors.allowedOrigins;
    config.cors.allowedOrigins = ['https://trusted-dashboard.com'];

    try {
      const res = await serverCtx.get('/api/events', {
        Origin: 'https://evil-hacker-site.com'
      });

      assert.equal(res.status, 403);
      assert.equal(res.json.success, false);
      assert.ok(res.json.message.includes('CORS'));
    } finally {
      config.cors.allowedOrigins = originalOrigins;
    }
  });

  it('SSE-005: cleans up client reference on socket disconnection without memory leaks', async () => {
    const url = new URL('/api/events', serverCtx.baseUrl);
    const bus = serverCtx.httpServer.sseEventBus;
    const initialClientsCount = bus.getClientCount();

    await new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        // Assert client count incremented
        assert.equal(bus.getClientCount(), initialClientsCount + 1);

        // Abruptly disconnect client
        req.destroy();

        // Allow event loop tick for 'close' event
        setTimeout(() => {
          assert.equal(bus.getClientCount(), initialClientsCount);
          resolve();
        }, 60);
      });

      req.on('error', () => {
        // Expected on destroy
      });
    });
  });
});
