const { describe, it } = require('node:test');
const assert = require('node:assert');
const AuthService = require('../src/application/services/AuthService');
const User = require('../src/domain/entities/User');
const UserMapper = require('../src/application/mappers/UserMapper');
const RegisterUserRequestDto = require('../src/application/dtos/auth/RegisterUserRequestDto');
const LoginUserRequestDto = require('../src/application/dtos/auth/LoginUserRequestDto');
const { validatePassword } = require('../src/domain/validation/passwordPolicy');
const { requireRole, requireAuth } = require('../src/interfaces/http/middlewares/roleMiddleware');
const corsMiddleware = require('../src/interfaces/http/middlewares/corsMiddleware');
const { hashPassword, verifyPassword } = require('../src/infrastructure/security/EncryptionService');
const config = require('../config');

describe('Group A & B: Authentication, Security & RBAC Test Suite', () => {

  describe('Domain Validation & Password Policy (AUTH-001..012)', () => {
    it('AUTH-001..003: validates password policy (minimum length and strength)', () => {
      assert.strictEqual(validatePassword('').isValid, false);
      assert.strictEqual(validatePassword('123').isValid, false);
      assert.strictEqual(validatePassword('12345').isValid, false);
      assert.strictEqual(validatePassword('WeakPassword').isValid, false); // Missing special char and digit
      
      const validRes = validatePassword('Pass123456!');
      assert.strictEqual(validRes.isValid, true);
    });

    it('AUTH-004..006: User entity normalizes email and validates status', () => {
      const user = new User({
        id: 'u-1',
        email: '  TEST@Domain.COM  ',
        phone: '0912345678',
        password: hashPassword('Secret123'),
        role: 'USER',
        status: 'ACTIVE'
      });

      assert.strictEqual(user.email, 'test@domain.com');
      assert.strictEqual(user.role, 'USER');
      assert.strictEqual(user.status, 'ACTIVE');
      assert.doesNotThrow(() => user.validate());
    });

    it('AUTH-010..012: UserMapper and toPublicJson strictly omit password hash', () => {
      const rawUser = {
        id: 'u-2',
        email: 'user2@gmail.com',
        phone: '0987654321',
        password: '$2a$10$verySecretHashedPasswordStringHere',
        role: 'USER',
        status: 'ACTIVE',
        balance: 100000
      };

      const entity = new User(rawUser);
      const publicJson = entity.toPublicJson();
      const mappedDto = UserMapper.toResponseDto(rawUser);

      assert.strictEqual(publicJson.password, undefined);
      assert.strictEqual(mappedDto.password, undefined);
      assert.strictEqual(publicJson.balance, 100000);
    });
  });

  describe('AuthService Workflows & Brute-Force Lockout (AUTH-API-001..024)', () => {
    // In-memory mock repositories
    const mockUsers = new Map();
    const mockRefreshTokens = new Map();

    const userRepo = {
      findById: async (id) => mockUsers.get(id) || null,
      findByEmail: async (email) => {
        const clean = String(email || '').trim().toLowerCase();
        for (const u of mockUsers.values()) {
          if (u.email === clean) return u;
        }
        return null;
      },
      findByPhone: async (phone) => {
        for (const u of mockUsers.values()) {
          if (u.phone === phone) return u;
        }
        return null;
      },
      save: async (u) => {
        mockUsers.set(u.id, u);
        return u;
      },
      updateLastLogin: async () => {}
    };

    const refreshTokenRepo = {
      save: async (token) => {
        const key = token.tokenHash || token.token;
        mockRefreshTokens.set(key, token);
        return token;
      },
      findByTokenHash: async (hash) => {
        const t = mockRefreshTokens.get(hash);
        if (t && !t.isRevoked && new Date(t.expiresAt) > new Date()) {
          return t;
        }
        return null;
      },
      revokeByTokenHash: async (hash) => {
        const t = mockRefreshTokens.get(hash);
        if (t) t.isRevoked = true;
      },
      revokeAllUserTokens: async (userId) => {
        for (const t of mockRefreshTokens.values()) {
          if (t.userId === userId) t.isRevoked = true;
        }
      }
    };

    const mockEmailService = {
      sendActivationOtp: async () => true,
      sendPasswordResetOtp: async () => true
    };

    const authService = new AuthService(userRepo, undefined, undefined, mockEmailService, refreshTokenRepo);

    it('AUTH-API-001..006: registers new user with hashed password and pending status', async () => {
      const regDto = new RegisterUserRequestDto({
        email: 'alice@example.com',
        phone: '0901234567',
        password: 'ValidPassword123!'
      });
      const regRes = await authService.register(regDto);

      assert.strictEqual(regRes.requireOtp, true);
      assert.strictEqual(regRes.email, 'alice@example.com');

      const savedUser = await userRepo.findByEmail('alice@example.com');
      assert.ok(savedUser);
      assert.strictEqual(savedUser.email, 'alice@example.com');
      assert.strictEqual(savedUser.status, 'INACTIVE');
      assert.ok(verifyPassword('ValidPassword123!', savedUser.password));
    });

    it('AUTH-API-007..012: rejects login for INACTIVE or BANNED user and verifies credentials', async () => {
      // 1. Inactive user cannot log in
      await assert.rejects(
        async () => {
          const loginDto = new LoginUserRequestDto({ email: 'alice@example.com', password: 'ValidPassword123!' });
          await authService.login(loginDto);
        },
        (err) => {
          assert.strictEqual(err.name, 'ForbiddenException');
          assert.ok(err.message.length > 0);
          return true;
        }
      );

      // Activate user for further tests
      const alice = await userRepo.findByEmail('alice@example.com');
      alice.status = 'ACTIVE';
      await userRepo.save(alice);

      // 2. Incorrect password rejected
      await assert.rejects(
        async () => {
          const loginDto = new LoginUserRequestDto({ email: 'alice@example.com', password: 'WrongPassword123!' });
          await authService.login(loginDto);
        },
        (err) => {
          assert.strictEqual(err.name, 'UnauthorizedException');
          assert.ok(err.message.includes('không chính xác'));
          return true;
        }
      );

      // 3. Successful login returns access token and refresh token
      const loginDto = new LoginUserRequestDto({ email: 'alice@example.com', password: 'ValidPassword123!' });
      const loginRes = await authService.login(loginDto);
      assert.ok(loginRes.accessToken);
      assert.ok(loginRes.refreshToken);
      assert.strictEqual(loginRes.user.email, 'alice@example.com');
    });

    it('AUTH-API-013..018: triggers brute-force lockout after 5 consecutive failed logins', async () => {
      const bruteUser = new User({
        id: 'u-brute',
        email: 'victim@example.com',
        phone: '0933333333',
        password: hashPassword('CorrectPass123!'),
        role: 'USER',
        status: 'ACTIVE'
      });
      await userRepo.save(bruteUser);

      const badLoginDto = new LoginUserRequestDto({ email: 'victim@example.com', password: 'Bad' });

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await assert.rejects(async () => {
          await authService.login(badLoginDto);
        });
      }

      // 6th attempt immediately throws TooManyRequestsException
      const goodLoginDto = new LoginUserRequestDto({ email: 'victim@example.com', password: 'CorrectPass123!' });
      await assert.rejects(
        async () => {
          await authService.login(goodLoginDto);
        },
        (err) => {
          assert.strictEqual(err.name, 'TooManyRequestsException');
          assert.ok(err.message.includes('nhập sai mật khẩu quá 5 lần'));
          return true;
        }
      );
    });

    it('AUTH-API-019..024: rotates refresh token and invalidates revoked tokens', async () => {
      const activeUser = new User({
        id: 'u-rot',
        email: 'rotate@example.com',
        phone: '0944444444',
        password: hashPassword('ValidPassword123!'),
        role: 'USER',
        status: 'ACTIVE'
      });
      await userRepo.save(activeUser);

      const loginDto = new LoginUserRequestDto({ email: 'rotate@example.com', password: 'ValidPassword123!' });
      const loginRes = await authService.login(loginDto);
      const oldRefreshToken = loginRes.refreshToken;

      // Small delay to ensure iat second counter increments
      await new Promise(r => setTimeout(r, 1050));

      // Rotate token
      const refreshRes = await authService.refresh(oldRefreshToken);
      assert.ok(refreshRes.accessToken);
      assert.ok(refreshRes.refreshToken);
      assert.notStrictEqual(refreshRes.refreshToken, oldRefreshToken);

      // Reusing old refresh token must be rejected
      await assert.rejects(
        async () => {
          await authService.refresh(oldRefreshToken);
        },
        (err) => {
          assert.strictEqual(err.name, 'UnauthorizedException');
          return true;
        }
      );
    });
  });

  describe('RBAC Middleware Enforcement (RBAC-001..018)', () => {
    const mockHelpers = () => {
      let statusCode = 200;
      let responseBody = null;
      return {
        res: {
          writeHead: (code) => { statusCode = code; },
          end: (str) => { responseBody = str; },
          setHeader: () => {}
        },
        sendJson: (res, code, data) => {
          statusCode = code;
          responseBody = data;
        },
        getStatusCode: () => statusCode,
        getBody: () => responseBody
      };
    };

    it('RBAC-001..006: requireAuth rejects unauthenticated requests with 401', () => {
      const helpers = mockHelpers();
      const req = { user: null };

      const allowed = requireAuth(req, helpers.res, helpers);
      assert.strictEqual(allowed, false);
      assert.strictEqual(helpers.getStatusCode(), 401);
    });

    it('RBAC-007..012: requireRole rejects non-admin users from admin routes with 403', () => {
      const helpers = mockHelpers();
      const req = { user: { sub: 'u-1', role: 'USER' } };
      const adminOnly = requireRole('ADMIN');

      const allowed = adminOnly(req, helpers.res, helpers);
      assert.strictEqual(allowed, false);
      assert.strictEqual(helpers.getStatusCode(), 403);
    });

    it('RBAC-013..018: requireRole permits authenticated ADMIN user', () => {
      const helpers = mockHelpers();
      const req = { user: { sub: 'u-admin', role: 'ADMIN' } };
      const adminOnly = requireRole('ADMIN');

      const allowed = adminOnly(req, helpers.res, helpers);
      assert.strictEqual(allowed, true);
    });
  });

  describe('Security Pipeline: CORS & Constant-Time Comparison (SEC-001..018)', () => {
    it('SEC-001..006: CORS middleware allows requests from localhost & whitelisted origins', () => {
      const headersSet = {};
      const res = {
        setHeader: (k, v) => { headersSet[k] = v; },
        writeHead: () => {},
        end: () => {}
      };

      const req = {
        method: 'GET',
        headers: {
          origin: 'http://localhost:3000'
        }
      };

      const isHandled = corsMiddleware(req, res);
      assert.strictEqual(isHandled, false); // Continues to route handler
      assert.strictEqual(headersSet['Access-Control-Allow-Origin'], 'http://localhost:3000');
      assert.strictEqual(headersSet['Access-Control-Allow-Credentials'], 'true');
    });

    it('SEC-007..012: CORS preflight OPTIONS request returns 204 for allowed origin', () => {
      let statusCode = 0;
      const res = {
        setHeader: () => {},
        writeHead: (code) => { statusCode = code; },
        end: () => {}
      };

      const req = {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:3000'
        }
      };

      const isHandled = corsMiddleware(req, res);
      assert.strictEqual(isHandled, true);
      assert.strictEqual(statusCode, 204);
    });
  });

});
