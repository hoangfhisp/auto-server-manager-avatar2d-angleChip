const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { createTestServer } = require('./helpers/testServer');

describe('Deployment & Bootstrapper Smoke Test Suite (cPanel Passenger & VPS)', () => {
  it('DEPLOY-001: verifies cPanel entrypoint app.js syntax and integrity', () => {
    const appJsPath = path.resolve(__dirname, '../app.js');
    assert.ok(fs.existsSync(appJsPath), 'app.js must exist for cPanel Phusion Passenger');
    const content = fs.readFileSync(appJsPath, 'utf8');
    assert.ok(content.includes('./server.js'), 'app.js must delegate to server.js');
  });

  it('DEPLOY-002: verifies standalone entrypoint server.js exports HttpServer instance', () => {
    const serverJsPath = path.resolve(__dirname, '../server.js');
    assert.ok(fs.existsSync(serverJsPath), 'server.js must exist');
    const content = fs.readFileSync(serverJsPath, 'utf8');
    assert.ok(content.includes('HttpServer'), 'server.js must bootstrap HttpServer');
    assert.ok(content.includes('module.exports = app'), 'server.js must export app instance');
  });

  it('DEPLOY-003: configuration module loads environment gracefully with defaults', () => {
    assert.ok(config.app, 'config.app must be defined');
    assert.ok(['development', 'production', 'test'].includes(config.app.env));
    assert.ok(config.security.jwtSecret, 'JWT Secret must be configured');
    assert.ok(config.cors, 'CORS configuration must exist');
    assert.ok(Array.isArray(config.cors.allowedOrigins), 'Allowed CORS origins must be an array');
  });

  it('DEPLOY-004: boots up and shuts down cleanly within ephemeral test harness', async () => {
    const testServer = await createTestServer();
    assert.ok(testServer.port > 0, 'Server must bind to valid ephemeral port');
    assert.ok(testServer.baseUrl.startsWith('http://127.0.0.1:'));

    // Verify graceful stop terminates without throwing
    await assert.doesNotReject(async () => {
      await testServer.stop();
    });
  });
});
