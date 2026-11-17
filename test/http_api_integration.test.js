const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers/testServer');
const User = require('../src/domain/entities/User');
const Account = require('../src/domain/entities/Account');
const { hashPassword } = require('../src/infrastructure/security/EncryptionService');

describe('HTTP API Integration Test Suite (Dynamic Port & Sandboxed CI)', () => {
  let serverCtx;
  let adminUser;
  let regularUser;
  let adminToken;
  let userToken;

  before(async () => {
    const passwordHash = await hashPassword('SecureP@ssw0rd123!');
    adminUser = new User({
      id: 'admin-ci-1',
      username: 'ci_admin',
      email: 'admin@ci.local',
      password: passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      balance: 500000
    });

    regularUser = new User({
      id: 'user-ci-1',
      username: 'ci_user',
      email: 'user@ci.local',
      password: passwordHash,
      role: 'USER',
      status: 'ACTIVE',
      balance: 100000
    });

    serverCtx = await createTestServer();
    await serverCtx.mocks.userRepo.save(adminUser);
    await serverCtx.mocks.userRepo.save(regularUser);

    adminToken = serverCtx.createAuthToken(adminUser);
    userToken = serverCtx.createAuthToken(regularUser);
  });

  after(async () => {
    if (serverCtx) {
      await serverCtx.stop();
    }
  });

  describe('Group 1: Authentication & Public Endpoints', () => {
    it('AUTH-INT-001: rejects registration with weak password (HTTP 400)', async () => {
      const res = await serverCtx.post('/api/auth/register', {
        email: 'newuser@ci.local',
        username: 'newuser',
        password: '123'
      });
      assert.equal(res.status, 400);
      assert.equal(res.json.success, false);
    });

    it('AUTH-INT-002: successfully registers valid user (HTTP 200/201)', async () => {
      const res = await serverCtx.post('/api/auth/register', {
        email: 'brandnew@ci.local',
        username: 'brandnew',
        password: 'ValidPassword123!'
      });
      assert.ok([200, 201].includes(res.status));
      assert.equal(res.json.success, true);
      assert.ok(res.json.data);
      const email = res.json.data.email || (res.json.data.user && res.json.data.user.email);
      assert.equal(email, 'brandnew@ci.local');
    });

    it('AUTH-INT-003: rejects login with invalid credentials (HTTP 401)', async () => {
      const res = await serverCtx.post('/api/auth/login', {
        email: 'user@ci.local',
        password: 'WrongPassword123!'
      });
      assert.equal(res.status, 401);
      assert.equal(res.json.success, false);
    });

    it('AUTH-INT-004: logs in with valid credentials returning JWT access token', async () => {
      const res = await serverCtx.post('/api/auth/login', {
        email: 'user@ci.local',
        password: 'SecureP@ssw0rd123!'
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.data.accessToken);
      assert.equal(res.json.data.user.email, 'user@ci.local');
    });
  });

  describe('Group 2: Security & RBAC Enforcement on Real Socket', () => {
    it('SEC-INT-001: unauthenticated request to protected route returns 401', async () => {
      const res = await serverCtx.get('/api/billing/balance');
      assert.equal(res.status, 401);
      assert.equal(res.json.success, false);
    });

    it('SEC-INT-002: regular USER attempting ADMIN route returns 403 Forbidden', async () => {
      const res = await serverCtx.get('/api/files', {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.success, false);
    });

    it('SEC-INT-003: ADMIN accessing ADMIN route is permitted (HTTP 200)', async () => {
      const res = await serverCtx.get('/api/files', {
        Authorization: `Bearer ${adminToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(Array.isArray(res.json.data.files));
    });

    it('SEC-INT-004: non-existent API route returns 404 API endpoint not found', async () => {
      const res = await serverCtx.get('/api/unknown/endpoint/route', {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 404);
      assert.equal(res.json.success, false);
    });

    it('SEC-INT-005: malformed JSON body returns 400 Bad Request', async () => {
      const res = await serverCtx.request('POST', '/api/auth/login', '{"not valid json:');
      assert.equal(res.status, 400);
      assert.equal(res.json.success, false);
    });
  });

  describe('Group 3: Rental & Billing API Flow', () => {
    it('RENT-INT-001: retrieves available rental pricing plans', async () => {
      const res = await serverCtx.get('/api/rental/plans', {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.data);
      assert.ok(Array.isArray(res.json.data.plans) || typeof res.json.data.plans === 'object');
    });

    it('BILL-INT-001: fetches current user balance', async () => {
      const res = await serverCtx.get('/api/billing/balance', {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.equal(res.json.data.balance, 100000);
    });

    it('BILL-INT-002: creates payOS deposit order with 12-digit orderCode', async () => {
      const res = await serverCtx.post('/api/billing/payos-order', {
        amount: 50000
      }, {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(res.json.data.checkoutUrl);
      assert.ok(res.json.data.orderCode);
      assert.ok(String(res.json.data.orderCode).length >= 11 && String(res.json.data.orderCode).length <= 13);
    });
  });

  describe('Group 4: Account CRUD & Ownership Enforcement', () => {
    let rentedAccountId;

    it('ACC-INT-001: regular user cannot arbitrarily create unrented slot directly', async () => {
      const res = await serverCtx.post('/api/accounts', {
        username: 'unauthorized_nick'
      }, {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 400);
      assert.equal(res.json.success, false);
    });

    it('ACC-INT-002: user rents a bot slot via rental checkout', async () => {
      const res = await serverCtx.post('/api/rental/checkout', {
        username: 'farmer_01',
        password: 'Password123!',
        plan: '1m',
        durationMonths: 1,
        autoType: 'farm',
        server: 0
      }, {
        Authorization: `Bearer ${userToken}`
      });
      assert.ok([200, 201].includes(res.status));
      assert.equal(res.json.success, true);
      assert.ok(res.json.data.account && res.json.data.account.id);
      rentedAccountId = res.json.data.account.id;
    });

    it('ACC-INT-003: lists accounts belonging to current user', async () => {
      const res = await serverCtx.get('/api/accounts', {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
      assert.ok(Array.isArray(res.json.data.accounts));
      const found = res.json.data.accounts.find(a => a.id === rentedAccountId);
      assert.ok(found);
      assert.equal(found.username, 'farmer_01');
    });

    it('ACC-INT-004: user updates setup on their owned account', async () => {
      const res = await serverCtx.put(`/api/accounts/${rentedAccountId}/setup`, {
        targetCoins: 5000000,
        upDays: 30,
        autoType: 'farm'
      }, {
        Authorization: `Bearer ${userToken}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.success, true);
    });

    it('ACC-INT-005: other user cannot update setup on unowned account (HTTP 403)', async () => {
      const otherUser = new User({
        id: 'attacker-1',
        username: 'attacker',
        email: 'attacker@ci.local',
        role: 'USER',
        status: 'ACTIVE'
      });
      await serverCtx.mocks.userRepo.save(otherUser);
      const attackerToken = serverCtx.createAuthToken(otherUser);

      const res = await serverCtx.put(`/api/accounts/${rentedAccountId}/setup`, {
        targetCoins: 100
      }, {
        Authorization: `Bearer ${attackerToken}`
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.success, false);
    });
  });
});
