const { describe, it } = require('node:test');
const assert = require('node:assert');
const ResourceAllocationEngine = require('../src/application/services/ResourceAllocationEngine');
const CancelSlotUseCase = require('../src/application/use-cases/rental/CancelSlotUseCase');
const Account = require('../src/domain/entities/Account');
const User = require('../src/domain/entities/User');
const Proxy = require('../src/domain/entities/Proxy');
const BotFile = require('../src/domain/entities/BotFile');
const AsyncMutex = require('../src/shared/utils/AsyncMutex');

describe('Group E & F: Rental Engine, Allocation & Concurrency Test Suite', () => {

  describe('ResourceAllocationEngine Bin-Packing & Balancer (ALLOC-001..025)', () => {
    it('ALLOC-001..005: correctly balances game servers HM (0) and DK (1) on the same proxy', async () => {
      const mockProxies = [
        new Proxy({
          id: 'px-1',
          host: '10.0.0.1',
          port: 1080,
          type: 'socks5',
          status: 'ACTIVE',
          maxSlots: 6,
          expiresAt: new Date(Date.now() + 10 * 86400 * 1000)
        })
      ];

      // 3 accounts already running on Hoàn Mỹ (0)
      const mockAccounts = [
        new Account({ id: 'acc-1', username: 'u1', proxyId: 'px-1', serverId: 0 }),
        new Account({ id: 'acc-2', username: 'u2', proxyId: 'px-1', serverId: 0 }),
        new Account({ id: 'acc-3', username: 'u3', proxyId: 'px-1', serverId: 0 })
      ];

      const mockFiles = [
        new BotFile({ id: 'file-1', name: 'Profile 1', modType: 'UPXU', isDefault: true, maxAccounts: 20 })
      ];

      const engine = new ResourceAllocationEngine(
        { findAll: async () => mockFiles },
        { findAll: async () => mockProxies, save: async () => {} },
        { findAll: async () => mockAccounts, findByUsername: async () => null, save: async () => {} },
        null, // settingRepo
        null, // proxyApiClient
        new AsyncMutex('test-alloc-mutex')
      );

      // Allocating for server 0 should fail or require new proxy because max per server is 3
      // Allocating for server 1 should succeed on px-1 because server 1 has 0 bots on px-1
      const allocServer1 = await engine.allocateResources('UPXU', 1, 1);
      assert.strictEqual(allocServer1.proxyId, 'px-1');
      assert.strictEqual(allocServer1.serverId, 1);
    });

    it('ALLOC-006..010: prioritizes higher load proxies (Best-Fit Decreasing) up to 6 capacity', async () => {
      const mockProxies = [
        new Proxy({ id: 'px-empty', host: '10.0.0.1', port: 1080, status: 'ACTIVE', maxSlots: 6, expiresAt: new Date(Date.now() + 10 * 86400 * 1000) }),
        new Proxy({ id: 'px-packed', host: '10.0.0.2', port: 1080, status: 'ACTIVE', maxSlots: 6, expiresAt: new Date(Date.now() + 10 * 86400 * 1000) })
      ];

      // px-packed already has 2 bots (1 on HM, 1 on DK)
      const mockAccounts = [
        new Account({ id: 'acc-p1', username: 'up1', proxyId: 'px-packed', serverId: 0 }),
        new Account({ id: 'acc-p2', username: 'up2', proxyId: 'px-packed', serverId: 1 })
      ];

      const mockFiles = [
        new BotFile({ id: 'file-1', name: 'Profile 1', modType: 'UPXU', isDefault: true, maxAccounts: 20 })
      ];

      const engine = new ResourceAllocationEngine(
        { findAll: async () => mockFiles },
        { findAll: async () => mockProxies, save: async () => {} },
        { findAll: async () => mockAccounts, findByUsername: async () => null, save: async () => {} },
        null,
        null,
        new AsyncMutex('test-alloc-mutex-2')
      );

      // Allocation should pack onto px-packed (2 bots) rather than px-empty (0 bots) to minimize proxy usage
      const result = await engine.allocateResources('UPXU', 1, 0);
      assert.strictEqual(result.proxyId, 'px-packed');
    });

    it('ALLOC-011..015: calculateContractExpiration honors Date object and duration months', () => {
      const engine = new ResourceAllocationEngine();

      // 1. Direct Date object preserved
      const fixedDate = new Date('2027-01-01T00:00:00.000Z');
      assert.strictEqual(engine.calculateContractExpiration(fixedDate), fixedDate);

      // 2. Duration 3 months
      const now = Date.now();
      const threeMonths = engine.calculateContractExpiration(3);
      const expectedMin = now + (3 * 30 - 1) * 86400 * 1000;
      const expectedMax = now + (3 * 30 + 1) * 86400 * 1000;
      assert.ok(threeMonths.getTime() >= expectedMin && threeMonths.getTime() <= expectedMax);
    });
  });

  describe('Slot Cancellation & Pro-Rata Refund Math (RENT-031..045)', () => {
    it('RENT-031..035: calculates pro-rata refund minus cancellation fee accurately', async () => {
      const userId = 'u-refund-1';
      let userBalance = 10000;

      // 15 days remaining out of 30 days contract with effective price 50,000đ/month
      const now = Date.now();
      const fifteenDaysAhead = new Date(now + 15 * 86400 * 1000);
      const twoHoursAgo = new Date(now - 2 * 3600 * 1000); // Exceeds 1-hour min hold

      const mockAccount = new Account({
        id: 'acc-cancel-1',
        userId,
        username: 'farmer_01',
        rentalPlan: 'UPXU',
        effectivePriceMonth: 50000,
        rentalExpiresAt: fifteenDaysAhead,
        createdAt: twoHoursAgo
      });

      const accountRepo = {
        findById: async (id) => (id === mockAccount.id ? mockAccount : null),
        save: async (acc) => acc
      };

      const userRepo = {
        findById: async (id) => new User({ id, balance: userBalance }),
        updateBalance: async (id, delta) => {
          userBalance += delta;
        }
      };

      const transactionRepo = {
        save: async () => true
      };

      const settingRepo = {
        get: async (key) => {
          if (key === 'rental_cancel_fee_percent') return 10; // 10% fee
          if (key === 'rental_min_hold_hours') return 1;
          return null;
        }
      };

      const cancelUseCase = new CancelSlotUseCase({
        accountRepo,
        userRepo,
        transactionRepo,
        settingRepo,
        multiBotManager: null,
        sseEventBus: null,
        mutex: new AsyncMutex('test-cancel-mutex')
      });

      const result = await cancelUseCase.execute(mockAccount.id, userId, 'USER');

      // Gross refund for ~15 days (50% of 50,000) = ~25,000đ
      // Cancel fee (10% of 25,000) = ~2,500đ
      // Net refund = ~22,500đ
      assert.strictEqual(result.success, true);
      assert.ok(result.refundAmount >= 22000 && result.refundAmount <= 23000);
      assert.strictEqual(mockAccount.proxyId, null);
      assert.ok(mockAccount.isDeleted());
    });

    it('RENT-036..040: enforces anti-spam minHoldHours before allowing cancellation', async () => {
      const now = Date.now();
      const justCreated = new Date(now - 15 * 60 * 1000); // 15 mins ago (less than 1 hour hold)
      const thirtyDaysAhead = new Date(now + 30 * 86400 * 1000);

      const mockAccount = new Account({
        id: 'acc-spam-1',
        userId: 'u-spam',
        username: 'spammer_01',
        rentalPlan: 'UPXU',
        effectivePriceMonth: 50000,
        rentalExpiresAt: thirtyDaysAhead,
        createdAt: justCreated
      });

      const cancelUseCase = new CancelSlotUseCase({
        accountRepo: {
          findById: async () => mockAccount,
          save: async () => true,
          findAll: async () => []
        },
        userRepo: {
          findById: async () => new User({ id: 'u-spam' }),
          updateBalance: async () => true
        },
        transactionRepo: { save: async () => true },
        settingRepo: {
          get: async (key) => (key === 'rental_min_hold_hours' ? 1 : null)
        }
      });

      // Regular user must be blocked with BadRequestException
      await assert.rejects(
        async () => {
          await cancelUseCase.execute(mockAccount.id, 'u-spam', 'USER');
        },
        (err) => {
          assert.strictEqual(err.name, 'BadRequestException');
          assert.ok(err.message.includes('tối thiểu 1 giờ'));
          return true;
        }
      );

      // Admin user can bypass anti-spam hold
      const adminResult = await cancelUseCase.execute(mockAccount.id, 'u-admin', 'ADMIN');
      assert.strictEqual(adminResult.success, true);
    });
  });

});
