const jwt = require('jsonwebtoken');
const config = require('../../config');
const User = require('../../src/domain/entities/User');
const Account = require('../../src/domain/entities/Account');

/**
 * MockFactory
 * Provides in-memory repositories and sandbox service doubles for isolated CI execution.
 */
class MockFactory {
  static createMockSettingRepo(initialSettings = {}) {
    const store = new Map(Object.entries({
      port: 0,
      jwt_secret: 'ci-isolated-test-jwt-secret-very-secure-key-123456',
      password: '',
      payos_client_id: 'test-client-id',
      payos_api_key: 'test-api-key',
      payos_checksum_key: 'test-checksum-key-1234567890abcdef1234567890',
      min_hold_hours: 1,
      cancel_fee_percent: 10,
      monthly_slot_price: 50000,
      pricing_plans: JSON.stringify([
        { id: '1m', name: 'Gói 1 Tháng', durationMonths: 1, price: 50000, discountPercent: 0 },
        { id: '3m', name: 'Gói 3 Tháng', durationMonths: 3, price: 135000, discountPercent: 10 }
      ]),
      ...initialSettings
    }));

    return {
      store,
      async get(key) {
        return store.get(key) || null;
      },
      async set(key, value) {
        store.set(key, String(value));
        return true;
      },
      async getAll() {
        return Object.fromEntries(store.entries());
      },
      async setBatch(dict) {
        for (const [k, v] of Object.entries(dict)) {
          store.set(k, String(v));
        }
        return true;
      }
    };
  }

  static createMockUserRepo(initialUsers = []) {
    const users = new Map();
    for (const u of initialUsers) {
      users.set(u.id, u instanceof User ? u : new User(u));
    }

    return {
      users,
      async findById(id) {
        return users.get(id) || null;
      },
      async findByEmail(email) {
        const lower = String(email).toLowerCase();
        for (const u of users.values()) {
          if (u.email && u.email.toLowerCase() === lower) return u;
        }
        return null;
      },
      async findByUsername(username) {
        const lower = String(username).toLowerCase();
        for (const u of users.values()) {
          if (u.username && u.username.toLowerCase() === lower) return u;
        }
        return null;
      },
      async save(user) {
        const entity = user instanceof User ? user : new User(user);
        users.set(entity.id, entity);
        return entity;
      },
      async update(user) {
        const entity = user instanceof User ? user : new User(user);
        users.set(entity.id, entity);
        return entity;
      },
      async updateLastLogin(id) {
        const u = users.get(id);
        if (u) {
          u.lastLoginAt = new Date();
          return true;
        }
        return false;
      },
      async updateBalance(userId, amount, txConn = null) {
        const user = users.get(userId);
        if (!user) return false;
        user.balance = (user.balance || 0) + Number(amount);
        return true;
      }
    };
  }

  static createMockAccountRepo(initialAccounts = []) {
    const accounts = new Map();
    for (const a of initialAccounts) {
      accounts.set(a.id, a instanceof Account ? a : new Account(a));
    }

    return {
      accounts,
      async findAll() {
        return Array.from(accounts.values());
      },
      async findById(id) {
        return accounts.get(id) || null;
      },
      async findByUsername(username) {
        const clean = String(username).toLowerCase().trim();
        for (const a of accounts.values()) {
          if (a.username && a.username.toLowerCase().trim() === clean) return a;
        }
        return null;
      },
      async findByUserId(userId) {
        return Array.from(accounts.values()).filter(a => a.userId === userId);
      },
      async save(account) {
        const entity = account instanceof Account ? account : new Account(account);
        accounts.set(entity.id, entity);
        return entity;
      },
      async update(account) {
        const entity = account instanceof Account ? account : new Account(account);
        accounts.set(entity.id, entity);
        return entity;
      },
      async delete(id) {
        return accounts.delete(id);
      },
      async countRunning() {
        return Array.from(accounts.values()).filter(a => a.status === 'RUNNING').length;
      },
      async findAllRunning() {
        return Array.from(accounts.values()).filter(a => a.status === 'RUNNING');
      }
    };
  }

  static createMockFileRepo(initialFiles = []) {
    const files = new Map();
    const defaults = initialFiles.length > 0 ? initialFiles : [
      { id: 'file_1', name: 'File Profile 1', maxAccounts: 6, jarPath: 'Avatar250.jar', isDefault: 1 }
    ];
    for (const f of defaults) {
      files.set(f.id, { ...f });
    }

    return {
      files,
      async findAll() {
        return Array.from(files.values());
      },
      async findById(id) {
        return files.get(id) || null;
      },
      async save(file) {
        files.set(file.id, { ...file });
        return file;
      },
      async update(file) {
        files.set(file.id, { ...file });
        return file;
      },
      async delete(id) {
        return files.delete(id);
      },
      async getActiveFileId() {
        return 'file_1';
      }
    };
  }

  static createMockProxyRepo(initialProxies = []) {
    const proxies = new Map();
    const defaults = initialProxies.length > 0 ? initialProxies : [
      { id: 'proxy_1', host: '127.0.0.1', port: 1080, type: 'socks5', status: 'ACTIVE', maxAccounts: 6 }
    ];
    for (const p of defaults) {
      proxies.set(p.id, { ...p });
    }

    return {
      proxies,
      async findAll() {
        return Array.from(proxies.values());
      },
      async findById(id) {
        return proxies.get(id) || null;
      },
      async save(proxy) {
        proxies.set(proxy.id, { ...proxy });
        return proxy;
      },
      async update(proxy) {
        proxies.set(proxy.id, { ...proxy });
        return proxy;
      },
      async delete(id) {
        return proxies.delete(id);
      }
    };
  }

  static createMockRefreshTokenRepo() {
    const tokens = new Map();

    return {
      tokens,
      async findByToken(token) {
        return tokens.get(token) || null;
      },
      async save(refreshToken) {
        tokens.set(refreshToken.token, { ...refreshToken });
        return refreshToken;
      },
      async revokeByToken(token) {
        const t = tokens.get(token);
        if (t) {
          t.isRevoked = true;
          return true;
        }
        return false;
      },
      async revokeAllForUser(userId) {
        for (const t of tokens.values()) {
          if (t.userId === userId) t.isRevoked = true;
        }
        return true;
      }
    };
  }

  static createMockTransactionRepo() {
    const txs = new Map();

    return {
      txs,
      async findById(id) {
        return txs.get(id) || null;
      },
      async findByOrderCode(orderCode) {
        const strCode = String(orderCode);
        for (const t of txs.values()) {
          if (String(t.orderCode) === strCode) return t;
        }
        return null;
      },
      async findByUserId(userId, opts = {}) {
        let userTxs = Array.from(txs.values()).filter(t => t.userId === userId);
        if (opts.types && Array.isArray(opts.types) && opts.types.length > 0) {
          userTxs = userTxs.filter(t => opts.types.includes(t.type));
        }
        return userTxs.map(t => {
          if (typeof t.toPublicJson === 'function') return t;
          return {
            ...t,
            toPublicJson: () => ({ ...t })
          };
        });
      },
      async countByUserId(userId, types = null) {
        let userTxs = Array.from(txs.values()).filter(t => t.userId === userId);
        if (types && Array.isArray(types) && types.length > 0) {
          userTxs = userTxs.filter(t => types.includes(t.type));
        }
        return userTxs.length;
      },
      async save(tx, txConn = null) {
        txs.set(tx.id, { ...tx });
        return tx;
      },
      async update(tx, txConn = null) {
        txs.set(tx.id, { ...tx });
        return tx;
      },
      async claimPendingOrder(orderCode, txConn = null) {
        const strCode = String(orderCode);
        for (const t of txs.values()) {
          if (String(t.orderCode) === strCode && t.status === 'PENDING') {
            t.status = 'PAID';
            return true;
          }
        }
        return false;
      }
    };
  }

  static createMockVoucherRepo() {
    const vouchers = new Map();

    return {
      vouchers,
      async findByCode(code) {
        return vouchers.get(String(code).toUpperCase()) || null;
      },
      async save(voucher) {
        vouchers.set(String(voucher.code).toUpperCase(), { ...voucher });
        return voucher;
      },
      async incrementUsage(code) {
        const v = vouchers.get(String(code).toUpperCase());
        if (v) {
          v.usedCount = (v.usedCount || 0) + 1;
          return true;
        }
        return false;
      }
    };
  }

  static createMockTransactionManager() {
    return {
      async withTransaction(work) {
        const fakeConn = { id: 'mock-tx-conn' };
        return await work(fakeConn);
      }
    };
  }

  static createMockPayOsService(checksumKey = 'test-checksum-key-1234567890abcdef1234567890') {
    const crypto = require('crypto');
    return {
      async createPaymentLink({ orderCode, amount, description, cancelUrl, returnUrl }) {
        return {
          bin: '970422',
          accountNumber: '123456789',
          accountName: 'AVATAR MANAGER TEST',
          amount,
          description,
          orderCode,
          paymentLinkId: `pl_${orderCode}`,
          status: 'PENDING',
          checkoutUrl: `https://mock.payos.vn/checkout/${orderCode}`,
          qrCode: `mock-qr-${orderCode}`
        };
      },
      computeHmacSha256(data) {
        const sortedKeys = Object.keys(data).sort();
        const signString = sortedKeys.map(k => `${k}=${data[k]}`).join('&');
        return crypto.createHmac('sha256', checksumKey).update(signString).digest('hex');
      },
      async verifyWebhookSignature(webhookBody) {
        if (!webhookBody || !webhookBody.data) return false;
        const signature = webhookBody.signature;
        if (!signature) return false;
        const expected = this.computeHmacSha256(webhookBody.data);
        return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
      },
      verifyWebhookData(webhookBody) {
        if (!webhookBody || !webhookBody.data) return false;
        const signature = webhookBody.signature;
        if (!signature) return false;
        const expected = this.computeHmacSha256(webhookBody.data);
        return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
      }
    };
  }

  static createMockEmailService() {
    return {
      async sendActivationOtp(email, otp) {
        return { success: true, messageId: 'mock-activation-msg' };
      },
      async sendPasswordResetOtp(email, otp) {
        return { success: true, messageId: 'mock-reset-msg' };
      }
    };
  }

  static createMockMultiBotManager(accountRepo, sseEventBus = null) {
    const runningBots = new Set();
    return {
      async startAccount(accountId) {
        runningBots.add(accountId);
        const acc = await accountRepo.findById(accountId);
        if (acc) {
          acc.status = 'RUNNING';
          await accountRepo.save(acc);
        }
        if (sseEventBus) {
          sseEventBus.broadcast('bot-status-changed', { accountId, status: 'RUNNING' });
        }
        return { success: true, message: 'Khởi động bot thành công!' };
      },
      async stopAccount(accountId) {
        runningBots.delete(accountId);
        const acc = await accountRepo.findById(accountId);
        if (acc) {
          acc.status = 'STOPPED';
          await accountRepo.save(acc);
        }
        if (sseEventBus) {
          sseEventBus.broadcast('bot-status-changed', { accountId, status: 'STOPPED' });
        }
        return { success: true, message: 'Đã dừng bot an toàn!' };
      },
      isAccountRunning(accountId) {
        return runningBots.has(accountId);
      },
      getAllStatuses() {
        const instances = {};
        for (const id of runningBots) {
          instances[id] = { running: true, state: 'RUNNING' };
        }
        return {
          runningCount: runningBots.size,
          runningAccountIds: Array.from(runningBots),
          instances
        };
      },
      applySetupToBot(account, payload) {
        return true;
      },
      resumePreviousRunningBots() {},
      setProxyVnApiClient() {},
      setAllocationEngine() {},
      async destroy() {
        runningBots.clear();
      }
    };
  }
}

module.exports = MockFactory;
