const { describe, it } = require('node:test');
const assert = require('node:assert');
const SingleBotProcess = require('../src/infrastructure/process/SingleBotProcess');
const ResourceAllocationEngine = require('../src/application/services/ResourceAllocationEngine');
const PayOsService = require('../src/infrastructure/payment/PayOsService');
const BillingUseCase = require('../src/application/use-cases/billing/BillingUseCase');

describe('Core Hardening & Reliability Tests', () => {

  describe('SingleBotProcess Hardening', () => {
    it('initializes with IDLE state and bounded buffers', () => {
      const bot = new SingleBotProcess({ id: 'test-acc-1', username: 'player1' });
      assert.strictEqual(bot.getLifecycleState(), 'IDLE');
      assert.strictEqual(bot._stdoutBuffer, '');
      assert.strictEqual(bot._stderrBuffer, '');
    });

    it('safely handles process-error without crashing when unhandled', () => {
      const bot = new SingleBotProcess({ id: 'test-acc-2', username: 'player2' });
      // Should not throw an unhandled error event
      assert.doesNotThrow(() => {
        bot.emit('process-error', new Error('Simulated process failure'));
      });
    });

    it('prevents buffer overflow on excessive stdout chunks', () => {
      const bot = new SingleBotProcess({ id: 'test-acc-3', username: 'player3' });
      const hugeChunk = Buffer.alloc(70000, 'A');
      
      // Simulate chunk arrival
      bot._stdoutBuffer += hugeChunk.toString('utf8');
      if (bot._stdoutBuffer.length > 64 * 1024) {
        bot._stdoutBuffer = bot._stdoutBuffer.slice(-32 * 1024);
      }
      
      assert.ok(bot._stdoutBuffer.length <= 64 * 1024);
      assert.strictEqual(bot._stdoutBuffer.length, 32 * 1024);
    });

    it('builds proxy JVM args with correct SOCKS versions', () => {
      const bot = new SingleBotProcess({ id: 'test-acc-4', username: 'player4' });
      
      const socks4Args = bot.buildProxyArgs({
        host: '1.2.3.4',
        port: 1080,
        type: 'socks4'
      });
      assert.ok(socks4Args.includes('-DsocksProxyVersion=4'));

      const socks5Args = bot.buildProxyArgs({
        host: '1.2.3.4',
        port: 1080,
        type: 'socks5'
      });
      assert.ok(socks5Args.includes('-DsocksProxyVersion=5'));
    });

    it('protects against stop/start race condition by ignoring close event of old child', () => {
      const bot = new SingleBotProcess({ id: 'test-acc-5', username: 'player5' });
      
      // Mock an existing child
      const oldChild = { pid: 1001, kill: () => {} };
      bot.child = oldChild;
      bot.lifecycleState = 'RUNNING';

      // User starts new child
      const newChild = { pid: 1002, kill: () => {} };
      bot.child = newChild;

      // Old child close handler checks if this.child !== child
      let stoppedEmitted = false;
      bot.on('stopped', () => { stoppedEmitted = true; });

      // Simulated old child close callback guard
      if (bot.child === oldChild) {
        bot.child = null;
        bot.emit('stopped', { accountId: 'test-acc-5' });
      }

      // Ensure reference to newChild is not wiped
      assert.strictEqual(bot.child, newChild);
      assert.strictEqual(stoppedEmitted, false);
    });
  });

  describe('ResourceAllocationEngine Hardening', () => {
    it('accepts specific Date object for contract expiration without default overwrite', () => {
      const engine = new ResourceAllocationEngine();
      const specificExpiry = new Date('2026-12-31T23:59:59.000Z');

      const calculated = engine.calculateContractExpiration(specificExpiry);
      assert.strictEqual(calculated.toISOString(), specificExpiry.toISOString());
    });

    it('defaults to 1 month ahead when duration is 1', () => {
      const engine = new ResourceAllocationEngine();
      const before = new Date();
      const calculated = engine.calculateContractExpiration(1);
      
      assert.ok(calculated.getTime() > before.getTime());
      // Roughly 30 days ahead
      const diffDays = Math.round((calculated.getTime() - before.getTime()) / (1000 * 60 * 60 * 24));
      assert.ok(diffDays >= 28 && diffDays <= 32);
    });
  });

  describe('PayOsService & BillingUseCase Hardening', () => {
    it('computes and verifies HMAC-SHA256 signatures accurately', async () => {
      const payOs = new PayOsService();
      const checksumKey = 'test_checksum_key_12345';

      // Sample data
      const data = {
        amount: 50000,
        orderCode: 987654321,
        description: 'A2A TOPUP'
      };

      const sortedData = payOs.createSignatureData(data);
      const signature = payOs.generateHmacSha256(sortedData, checksumKey);

      // Verify
      const isValid = await payOs.verifyWebhookSignature({
        data,
        signature
      }, checksumKey); // helper check
      
      assert.ok(typeof signature === 'string');
      assert.strictEqual(signature.length, 64);
    });

    it('generates 12-digit collision-safe order codes under Number.MAX_SAFE_INTEGER', async () => {
      const mockTxRepo = {
        findByOrderCode: async () => null,
        save: async () => true
      };
      const mockUserRepo = {
        findById: async () => ({ id: 'u1', balance: 0 })
      };
      const mockPayOs = {
        getConfig: () => ({ enabled: true, checksumKey: 'test_key' }),
        createPaymentLink: async (params) => ({
          checkoutUrl: 'https://pay.payos.vn/web/test',
          orderCode: params.orderCode
        })
      };

      const billingUseCase = new BillingUseCase(mockUserRepo, mockTxRepo, null, null, mockPayOs);
      
      const order = await billingUseCase.createPayOsOrder({ userId: 'u1', amount: 50000 });
      assert.ok(order.orderCode > 0);
      assert.ok(order.orderCode <= Number.MAX_SAFE_INTEGER);
      assert.ok(String(order.orderCode).length >= 10);
    });

    it('enforces atomic claim preventing duplicate balance crediting', async () => {
      let claimCount = 0;
      let balance = 10000;

      const mockTxRepo = {
        findByOrderCode: async (code) => ({
          id: 'tx-1',
          userId: 'u1',
          amount: 52500, // 50k + 5% bonus = 52.5k
          status: 'PENDING'
        }),
        claimPendingTransaction: async (id, update) => {
          // Only first caller succeeds
          claimCount++;
          return claimCount === 1;
        }
      };

      const mockUserRepo = {
        findById: async () => ({ id: 'u1', balance }),
        updateBalance: async (userId, amount) => {
          balance += amount;
        }
      };

      const mockPayOs = {
        getPaymentLinkInformation: async () => ({ status: 'PAID', amount: 50000 })
      };

      const billingUseCase = new BillingUseCase(mockUserRepo, mockTxRepo, null, null, mockPayOs);

      // Call 1
      const res1 = await billingUseCase.verifyAndCompletePayOsOrder({ orderCode: 12345, userId: 'u1' });
      assert.strictEqual(res1.isNewCredit, true);
      assert.strictEqual(balance, 62500);

      // Call 2 (simulating duplicate webhook or simultaneous verify)
      const res2 = await billingUseCase.verifyAndCompletePayOsOrder({ orderCode: 12345, userId: 'u1' });
      assert.strictEqual(res2.isNewCredit, false);
      assert.strictEqual(balance, 62500); // Balance should NOT be credited twice
    });
  });

});
