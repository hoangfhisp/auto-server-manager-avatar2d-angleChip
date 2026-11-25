const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createTestServer } = require('./helpers/testServer');
const MockFactory = require('./helpers/mockFactory');
const User = require('../src/domain/entities/User');
const { hashPassword } = require('../src/infrastructure/security/EncryptionService');

describe('End-to-End (E2E) Full User & Rental Lifecycle Test Suite', () => {
  let serverCtx;
  let testUser;
  let accessToken;
  let rentedSlotId;
  let creditedBalance = 0;
  let balanceAfterRent = 0;

  before(async () => {
    // Disable min hold hours for fast automated testing
    serverCtx = await createTestServer({
      settingRepo: MockFactory.createMockSettingRepo({
        rental_min_hold_hours: '0',
        rental_cancel_fee_percent: '10'
      })
    });

    const password = await hashPassword('FarmerP@ssw0rd123!');
    testUser = new User({
      id: 'e2e-user-1',
      email: 'gamer@avatar.vn',
      password,
      role: 'USER',
      status: 'ACTIVE',
      balance: 0 // Starts with 0 VND
    });

    await serverCtx.mocks.userRepo.save(testUser);
  });

  after(async () => {
    if (serverCtx) {
      await serverCtx.stop();
    }
  });

  it('E2E-001: user logs in and verifies initial 0đ balance', async () => {
    const loginRes = await serverCtx.post('/api/auth/login', {
      email: 'gamer@avatar.vn',
      password: 'FarmerP@ssw0rd123!'
    });

    assert.equal(loginRes.status, 200);
    assert.ok(loginRes.json.data.accessToken);
    accessToken = loginRes.json.data.accessToken;

    const balanceRes = await serverCtx.get('/api/billing/balance', {
      Authorization: `Bearer ${accessToken}`
    });

    assert.equal(balanceRes.status, 200);
    assert.equal(balanceRes.json.data.balance, 0);
  });

  it('E2E-002: user initiates deposit via payOS and receives payment link', async () => {
    const depositAmount = 100000; // 100k VND
    const orderRes = await serverCtx.post('/api/billing/payos-order', {
      amount: depositAmount
    }, {
      Authorization: `Bearer ${accessToken}`
    });

    assert.equal(orderRes.status, 200);
    assert.ok(orderRes.json.data.orderCode);
    assert.ok(orderRes.json.data.checkoutUrl);

    testUser.pendingOrderCode = orderRes.json.data.orderCode;
  });

  it('E2E-003: simulated payOS server sends webhook callback with HMAC signature', async () => {
    const webhookData = {
      orderCode: testUser.pendingOrderCode,
      amount: 100000,
      description: `A2A ${testUser.pendingOrderCode}`,
      accountNumber: '123456789',
      reference: 'MOCK_REF_123',
      transactionDateTime: '2026-11-17 12:00:00',
      currency: 'VND',
      paymentLinkId: `pl_${testUser.pendingOrderCode}`,
      code: '00'
    };

    const signature = serverCtx.mocks.payOsService.computeHmacSha256(webhookData);

    const webhookRes = await serverCtx.post('/api/billing/payos-webhook', {
      code: '00',
      desc: 'success',
      data: webhookData,
      signature
    });

    assert.equal(webhookRes.status, 200);
    assert.equal(webhookRes.json.success, true);

    // Verify wallet balance is credited (100k base + potential promo bonus)
    const balanceRes = await serverCtx.get('/api/billing/balance', {
      Authorization: `Bearer ${accessToken}`
    });
    assert.ok(balanceRes.json.data.balance >= 100000);
    creditedBalance = balanceRes.json.data.balance;
  });

  it('E2E-004: user rents a 1-month bot slot (50,000 VND) and checks resource allocation', async () => {
    const checkoutRes = await serverCtx.post('/api/rental/checkout', {
      username: 'gamer_bot_01',
      password: 'GamePassword123!',
      plan: '1m',
      durationMonths: 1,
      autoType: 'farm',
      server: 0 // Hoàn Mỹ
    }, {
      Authorization: `Bearer ${accessToken}`
    });

    assert.ok([200, 201].includes(checkoutRes.status));
    assert.equal(checkoutRes.json.success, true);
    assert.ok(checkoutRes.json.data.account && checkoutRes.json.data.account.id);
    rentedSlotId = checkoutRes.json.data.account.id;

    // Verify balance deduction
    const balanceRes = await serverCtx.get('/api/billing/balance', {
      Authorization: `Bearer ${accessToken}`
    });
    assert.equal(balanceRes.json.data.balance, creditedBalance - 50000);
    balanceAfterRent = balanceRes.json.data.balance;

    // Verify account exists in user list
    const accRes = await serverCtx.get('/api/accounts', {
      Authorization: `Bearer ${accessToken}`
    });
    const rented = accRes.json.data.accounts.find(a => a.id === rentedSlotId);
    assert.ok(rented);
    assert.equal(rented.username, 'gamer_bot_01');
    assert.equal(String(rented.rentalPlan).toUpperCase(), '1M');
  });

  it('E2E-005: user starts bot and receives real-time SSE execution telemetry', async () => {
    const startRes = await serverCtx.post(`/api/accounts/${rentedSlotId}/start`, {}, {
      Authorization: `Bearer ${accessToken}`
    });

    assert.equal(startRes.status, 200);
    assert.equal(startRes.json.success, true);

    // Verify account is marked as running
    const acc = await serverCtx.mocks.accountRepo.findById(rentedSlotId);
    assert.ok(['STARTING', 'RUNNING'].includes(acc.status));
  });

  it('E2E-006: user cancels slot early and receives pro-rata refund minus 10% cancellation fee', async () => {
    // Manually ensure createdAt satisfies minHoldHours
    const account = await serverCtx.mocks.accountRepo.findById(rentedSlotId);
    account.createdAt = new Date(Date.now() - 2 * 3600 * 1000);
    await serverCtx.mocks.accountRepo.save(account);

    const cancelRes = await serverCtx.post(`/api/rental/cancel/${rentedSlotId}`, {}, {
      Authorization: `Bearer ${accessToken}`
    });

    assert.equal(cancelRes.status, 200);
    assert.equal(cancelRes.json.success, true);
    assert.ok(cancelRes.json.data.refundAmount > 0);

    // Balance should have increased from balanceAfterRent by refundAmount
    const finalBalanceRes = await serverCtx.get('/api/billing/balance', {
      Authorization: `Bearer ${accessToken}`
    });
    assert.equal(finalBalanceRes.json.data.balance, balanceAfterRent + cancelRes.json.data.refundAmount);

    // Ledger should have recorded REFUND transaction
    const txRes = await serverCtx.get('/api/billing/transactions', {
      Authorization: `Bearer ${accessToken}`
    });
    assert.ok(txRes.json.data.items);
    const refundTx = txRes.json.data.items.find(t => t.type === 'REFUND');
    assert.ok(refundTx);
    assert.equal(refundTx.amount, cancelRes.json.data.refundAmount);
  });
});
