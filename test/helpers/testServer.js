const http = require('http');
const HttpServer = require('../../src/interfaces/http/HttpServer');
const MockFactory = require('./mockFactory');
const { defaultJwtService } = require('../../src/infrastructure/security/JwtService');
const User = require('../../src/domain/entities/User');

/**
 * createTestServer
 * Boots up an HttpServer instance bound to an ephemeral dynamic port (port: 0)
 * with fully isolated in-memory doubles.
 */
async function createTestServer(customMocks = {}) {
  const settingRepo = customMocks.settingRepo || MockFactory.createMockSettingRepo();
  const userRepo = customMocks.userRepo || MockFactory.createMockUserRepo();
  const accountRepo = customMocks.accountRepo || MockFactory.createMockAccountRepo();
  const fileRepo = customMocks.fileRepo || MockFactory.createMockFileRepo();
  const proxyRepo = customMocks.proxyRepo || MockFactory.createMockProxyRepo();
  const refreshTokenRepo = customMocks.refreshTokenRepo || MockFactory.createMockRefreshTokenRepo();
  const transactionRepo = customMocks.transactionRepo || MockFactory.createMockTransactionRepo();
  const voucherRepo = customMocks.voucherRepo || MockFactory.createMockVoucherRepo();
  const transactionManager = customMocks.transactionManager || MockFactory.createMockTransactionManager();
  const payOsService = customMocks.payOsService || MockFactory.createMockPayOsService();
  const emailService = customMocks.emailService || MockFactory.createMockEmailService();
  const sseEventBus = customMocks.sseEventBus || new (require('../../src/infrastructure/logging/SseEventBus'))();
  const multiBotManager = customMocks.multiBotManager || MockFactory.createMockMultiBotManager(accountRepo, sseEventBus);

  const httpServer = new HttpServer({
    settingRepo,
    userRepo,
    accountRepo,
    fileRepo,
    proxyRepo,
    refreshTokenRepo,
    transactionRepo,
    voucherRepo,
    transactionManager,
    payOsService,
    emailService,
    sseEventBus,
    multiBotManager,
    ...customMocks
  });

  // Start on dynamic port 0, disable crons and watchdogs during test by default
  await httpServer.start(0, {
    runMigrator: false,
    startCron: false,
    startWatchdog: false,
    resumeBots: false,
    silent: true
  });

  const address = httpServer.server.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * Universal HTTP client helper against this test server instance
   */
  async function request(method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl);
      const reqHeaders = { ...headers };
      let payload = null;

      if (body !== null && body !== undefined) {
        if (typeof body === 'object' && !Buffer.isBuffer(body)) {
          payload = JSON.stringify(body);
          if (!reqHeaders['content-type'] && !reqHeaders['Content-Type']) {
            reqHeaders['Content-Type'] = 'application/json';
          }
        } else {
          payload = String(body);
        }
        reqHeaders['Content-Length'] = Buffer.byteLength(payload);
      }

      const req = http.request(url, {
        method,
        headers: reqHeaders
      }, (res) => {
        let rawData = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(rawData);
          } catch (e) {
            json = null;
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: rawData,
            json
          });
        });
      });

      req.on('error', reject);

      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  function createAuthToken(user) {
    const entity = user instanceof User ? user : new User(user);
    return defaultJwtService.generateAccessToken(entity);
  }

  return {
    httpServer,
    port,
    baseUrl,
    request,
    get: (p, h) => request('GET', p, null, h),
    post: (p, b, h) => request('POST', p, b, h),
    put: (p, b, h) => request('PUT', p, b, h),
    delete: (p, h) => request('DELETE', p, null, h),
    createAuthToken,
    mocks: {
      settingRepo,
      userRepo,
      accountRepo,
      fileRepo,
      proxyRepo,
      refreshTokenRepo,
      transactionRepo,
      voucherRepo,
      transactionManager,
      payOsService
    },
    async stop() {
      await httpServer.stop();
    }
  };
}

module.exports = { createTestServer };
