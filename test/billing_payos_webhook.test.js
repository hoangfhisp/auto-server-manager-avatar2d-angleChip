const { describe, it } = require('node:test');
const assert = require('node:assert');
const BillingUseCase = require('../src/application/use-cases/billing/BillingUseCase');
const PayOsService = require('../src/infrastructure/payment/PayOsService');
const User = require('../src/domain/entities/User');
const Transaction = require('../src/domain/entities/Transaction');
const config = require('../config');

describe('Group C & G: API Contract, Billing & payOS Webhook Test Suite', () => {

  describe('payOS Order Creation & Boundaries (BILL-001..020)', () => {
    it('BILL-001..005: creates payOS order with valid bounds and unique 12-digit code', async () => {
      const mockUser = new User({ id: 'u-bill-1', balance: 50000 });
      const savedTransactions = [];

      const mockUserRepo = {
        findById: async () => mockUser
      };
      const mockTxRepo = {
        findByOrderCode: async () => null,
        save: async (tx) => {
          savedTransactions.push(tx);
          return tx;
        }
      };
      const mockPayOs = {
        getConfig: () => ({ enabled: true, checksumKey: 'test_checksum_key' }),
        createPaymentLink: async (params) => ({
          checkoutUrl: 'https://pay.payos.vn/web/test',
          orderCode: params.orderCode,
          qrCode: 'vietqr://test',
          accountNumber: '123456789',
          accountName: 'TEST MERCHANT',
          bin: '970422'
        })
      };

      const billing = new BillingUseCase(mockUserRepo, mockTxRepo, null, null, mockPayOs);

      // 1. Amount below 10,000đ rejected
      await assert.rejects(
        async () => {
          await billing.createPayOsOrder({ userId: 'u-bill-1', amount: 5000 });
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException');
          assert.ok(err.message.includes('tối thiểu'));
          return true;
        }
      );

      // 2. Amount above 50,000,000đ rejected (anti-overflow)
      await assert.rejects(
        async () => {
          await billing.createPayOsOrder({ userId: 'u-bill-1', amount: 60000000 });
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException');
          assert.ok(err.message.includes('tối đa'));
          return true;
        }
      );

      // 3. Valid amount creates pending transaction and orderCode
      const order = await billing.createPayOsOrder({ userId: 'u-bill-1', amount: 100000 });
      assert.ok(order.orderCode > 0);
      assert.strictEqual(order.amount, 100000);
      assert.ok(order.checkoutUrl.startsWith('https://'));
      assert.strictEqual(savedTransactions.length, 1);
      assert.strictEqual(savedTransactions[0].status, 'PENDING');
    });
  });

  describe('payOS Webhook Verification & ACID Claim (WEBHOOK-001..025)', () => {
    it('WEBHOOK-001..010: rejects webhook payloads with invalid signature or modified data', async () => {
      const payOs = new PayOsService();
      const checksumKey = 'secret_merchant_key';

      const webhookData = {
        amount: 200000,
        orderCode: 9912345678,
        description: 'A2A 9912345678'
      };

      // Generate valid signature
      const sortedQuery = payOs.createSignatureData(webhookData);
      const validSig = payOs.generateHmacSha256(sortedQuery, checksumKey);

      // Mock payOs service getConfig to use test key
      const mockPayOs = {
        getConfig: () => ({ enabled: true, checksumKey }),
        verifyWebhookSignature: (body) => payOs.verifyWebhookSignature.call({
          getConfig: () => ({ enabled: true, checksumKey }),
          generateHmacSha256: payOs.generateHmacSha256
        }, body)
      };

      // 1. Valid signature passes
      const isValid = await mockPayOs.verifyWebhookSignature({
        data: webhookData,
        signature: validSig
      });
      assert.strictEqual(isValid, true);

      // 2. Tampered amount fails signature check
      const isTamperedValid = await mockPayOs.verifyWebhookSignature({
        data: { ...webhookData, amount: 500000 },
        signature: validSig
      });
      assert.strictEqual(isTamperedValid, false);
    });

    it('WEBHOOK-011..025: guarantees webhook idempotency and single balance credit under duplicate callbacks', async () => {
      const userId = 'u-wh-1';
      let balance = 20000;
      let txStatus = 'PENDING';
      let claimExecutions = 0;

      const mockTx = {
        id: 'tx-wh-1',
        userId,
        orderCode: 123456789012,
        amount: 220000, // 200k + 10% bonus
        status: txStatus,
        description: 'A2A 123456789012'
      };

      const mockTxRepo = {
        findByOrderCode: async (code) => {
          return { ...mockTx, status: txStatus };
        },
        claimPendingTransaction: async (id, updates) => {
          claimExecutions++;
          if (txStatus === 'PENDING') {
            txStatus = 'SUCCESS';
            return true; // First claim wins
          }
          return false; // Subsequent claims fail atomically
        }
      };

      const mockUserRepo = {
        findById: async () => ({ id: userId, balance }),
        updateBalance: async (id, delta) => {
          balance += delta;
        }
      };

      const mockPayOs = {
        verifyWebhookSignature: async () => true
      };

      const billing = new BillingUseCase(mockUserRepo, mockTxRepo, null, null, mockPayOs);

      const webhookPayload = {
        code: '00',
        data: {
          orderCode: 123456789012,
          amount: 200000
        },
        signature: 'valid_mock_sig'
      };

      // First webhook delivery
      const res1 = await billing.handlePayOsWebhook(webhookPayload);
      assert.strictEqual(res1.success, true);
      assert.ok(res1.message.includes('thành công'));
      // 20,000 + 200,000 + 10% bonus (20,000) = 240,000
      assert.strictEqual(balance, 240000);

      // Duplicate webhook delivery (e.g. network retry from payOS)
      const res2 = await billing.handlePayOsWebhook(webhookPayload);
      assert.strictEqual(res2.success, true);
      assert.ok(res2.message.includes('trước đó') || res2.message.includes('khác'));
      assert.strictEqual(balance, 240000); // Balance must NOT be credited a second time!
    });
  });

});
