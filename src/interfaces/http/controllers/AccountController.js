const ApiResponse = require('../../../application/dtos/common/ApiResponse');
const ErrorResponse = require('../../../application/dtos/common/ErrorResponse');
const SaveAccountRequestDto = require('../../../application/dtos/account/SaveAccountRequestDto');
const SwitchServerRequestDto = require('../../../application/dtos/account/SwitchServerRequestDto');
const UpdateAccountSetupRequestDto = require('../../../application/dtos/account/UpdateAccountSetupRequestDto');
const { BadRequestException, UnauthorizedException, ForbiddenException } = require('../../../domain/errors');
const { sendErrorResponse } = require('../helpers/errorHandler');

/**
 * AccountController (Interface Layer)
 * Handles HTTP requests related to Avatar accounts with DTOs and clean architecture.
 * Automatically wraps responses with standard ApiResponse and maps Custom Exceptions.
 */
class AccountController {
  constructor(accountService, settingRepo, fileRepo, sseEventBus = null) {
    this.accountService = accountService;
    this.settingRepo = settingRepo;
    this.fileRepo = fileRepo;
    this.sseEventBus = sseEventBus;
  }

  _sendError(res, sendJson, err) {
    return sendErrorResponse(res, sendJson, err);
  }

  broadcastChange() {
    if (this.sseEventBus) {
      try {
        this.sseEventBus.broadcast('bot-status-changed', { timestamp: Date.now() });
      } catch (e) {}
    }
  }

  async getAccounts(req, res, sendJson) {
    try {
      const activeFileId = (await this.fileRepo.getActiveFileId()) || 'file_1';
      const activeAccountId = await this.settingRepo.get('activeAccountId');
      const allAccounts = await this.accountService.getAccounts();

      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin && (!req.user || !req.user.sub)) {
        throw new UnauthorizedException('Vui lòng đăng nhập để xem danh sách tài khoản!');
      }

      const accounts = !isActualAdmin
        ? allAccounts.filter(a => a.userId === req.user.sub)
        : allAccounts;

      const currentFileAccs = accounts.filter(a => a.fileId === activeFileId);
      const hmCount = currentFileAccs.filter(a => a.serverId === 0).length;
      const dkCount = currentFileAccs.filter(a => a.serverId === 1).length;

      const runningHmCount = currentFileAccs.filter(a => a.serverId === 0 && a.isRunning).length;
      const runningDkCount = currentFileAccs.filter(a => a.serverId === 1 && a.isRunning).length;
      const runningTotal = currentFileAccs.filter(a => a.isRunning).length;

      // User-specific total online stats across all their rented files
      const userRunningHm = accounts.filter(a => (a.serverId === 0 || !a.serverId) && a.isRunning).length;
      const userRunningDk = accounts.filter(a => a.serverId === 1 && a.isRunning).length;
      const userRunningTotal = accounts.filter(a => a.isRunning).length;

      const payload = {
        activeAccountId,
        activeFileId,
        accounts,
        servers: [
          { id: 0, name: 'Hoàn Mỹ' },
          { id: 1, name: 'Diệu Kỳ' }
        ],
        fileStats: {
          fileId: activeFileId,
          totalAccounts: currentFileAccs.length,
          hmCount,
          dkCount,
          runningHmCount,
          runningDkCount,
          runningTotal,
          userRunningHm,
          userRunningDk,
          userRunningTotal,
          maxTotal: 6,
          maxPerServer: 3
        }
      };

      const resp = ApiResponse.success(payload, 'Lấy danh sách tài khoản thành công!');
      Object.assign(resp, payload); // Ensure backward compatibility with legacy frontend
      return sendJson(res, 200, resp);
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async saveAccount(req, res, sendJson, parseJsonBody) {
    try {
      const body = await parseJsonBody(req);
      if (req.params && req.params.id && !body.id) {
        body.id = req.params.id;
      }

      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        if (!req.user || !req.user.sub) {
          throw new UnauthorizedException('Vui lòng đăng nhập để thực hiện thao tác!');
        }
        if (!body.id) {
          throw new BadRequestException('Vui lòng sử dụng tính năng Thuê Nick Bot để thêm tài khoản mới!');
        }
        const existing = await this.accountService.accountRepo.findById(body.id);
        if (!existing || existing.userId !== req.user.sub) {
          throw new ForbiddenException('Bạn không có quyền chỉnh sửa tài khoản này!');
        }

        // Anti-tampering: Lock down system-assigned fields
        body.fileId = existing.fileId;
        body.proxyId = existing.proxyId;
        body.serverId = existing.serverId;
        body.ipSlot = existing.ipSlot;
        body.userId = existing.userId;
        body.rentalExpiresAt = existing.rentalExpiresAt;
        body.rentalPlan = existing.rentalPlan;
        body.isEmergencySlot = existing.isEmergencySlot;

        // Anti-tampering: Package feature permissions check
        if (existing.rentalPlan) {
          let allowedFeatures = ['farm', 'upThue'];
          if (this.settingRepo) {
            try {
              const rules = await this.settingRepo.get('rental_allocation_rules');
              const plan = rules?.plans?.[existing.rentalPlan];
              if (plan && Array.isArray(plan.features)) allowedFeatures = plan.features;
            } catch (e) {}
          } else if (existing.rentalPlan === 'FULL') {
            allowedFeatures = ['farm', 'fish', 'diamond', 'sellOre', 'upThue'];
          } else if (existing.rentalPlan === 'FISH') {
            allowedFeatures = ['fish', 'upThue'];
          }

          if (body.diamondSettings && !allowedFeatures.includes('diamond')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto KC!`);
          }
          if (body.fishSettings && !allowedFeatures.includes('fish')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Câu Cá!`);
          }
          if (body.sellOreSettings && !allowedFeatures.includes('sellOre')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Bán Đá!`);
          }
          if (body.farmSettings && !allowedFeatures.includes('farm')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Farm!`);
          }
          if ((body.targetCoins !== undefined || body.upDays !== undefined) && !allowedFeatures.includes('upThue')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Cài đặt Úp Thuê!`);
          }
        }
      }

      const dto = new SaveAccountRequestDto(body);
      dto.validate(); // Chặn ngay tầng đầu tiên (Validation layer)

      const saved = await this.accountService.saveAccount(dto);
      this.broadcastChange();
      const resp = ApiResponse.success(saved, 'Đã lưu tài khoản thành công!');
      resp.account = saved;
      return sendJson(res, 200, resp);
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async deleteAccount(req, res, sendJson, parseJsonBody) {
    try {
      let accountId = req.params?.id || null;
      if (!accountId) {
        try {
          const body = await parseJsonBody(req);
          accountId = body?.id || null;
        } catch (e) {}
      }
      if (!accountId) {
        const urlObj = new URL(req.url, 'http://localhost');
        accountId = urlObj.searchParams.get('id');
      }
      if (!accountId) {
        throw new BadRequestException('Thiếu ID tài khoản!', 'MISSING_ACCOUNT_ID');
      }

      const existing = await this.accountService.accountRepo.findById(accountId);
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        if (!req.user || !req.user.sub) {
          throw new UnauthorizedException('Vui lòng đăng nhập!');
        }
        if (!existing || existing.userId !== req.user.sub) {
          throw new ForbiddenException('Bạn không có quyền xóa tài khoản này!');
        }
      }

      await this.accountService.deleteAccount(accountId);
      if (this.sseEventBus) {
        this.sseEventBus.clearAccountLogs(accountId, existing?.username);
      }
      this.broadcastChange();
      return sendJson(res, 200, ApiResponse.success(null, 'Đã xóa tài khoản.'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async switchServer(req, res, sendJson, parseJsonBody) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền đổi Server của tài khoản bot!');
      }

      const body = await parseJsonBody(req);
      if (req.params && req.params.id && !body.id) {
        body.id = req.params.id;
      }
      const dto = new SwitchServerRequestDto(body);
      dto.validate(); // Chặn ngay tầng đầu tiên

      const updated = await this.accountService.switchServer(dto.id, dto.newServerId);
      this.broadcastChange();
      const resp = ApiResponse.success(updated, `Đã chuyển tài khoản [${updated.username}] sang Server [${updated.serverName}]!`);
      resp.account = updated;
      return sendJson(res, 200, resp);
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async updateSetup(req, res, sendJson, parseJsonBody) {
    try {
      const body = await parseJsonBody(req);
      const accountId = req.params?.id || body?.id;
      if (!accountId) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }

      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        if (!req.user || !req.user.sub) {
          throw new UnauthorizedException('Vui lòng đăng nhập!');
        }
        const existing = await this.accountService.accountRepo.findById(accountId);
        if (!existing || existing.userId !== req.user.sub) {
          throw new ForbiddenException('Bạn không có quyền chỉnh sửa cài đặt tài khoản này!');
        }
        if (existing.isRentalExpired()) {
          throw new BadRequestException('Tài khoản bot này đã hết hạn thuê! Vui lòng gia hạn để chỉnh sửa cài đặt.');
        }

        // Anti-tampering: Package feature permissions check
        if (existing.rentalPlan) {
          let allowedFeatures = ['farm', 'upThue'];
          if (this.settingRepo) {
            try {
              const rules = await this.settingRepo.get('rental_allocation_rules');
              const plan = rules?.plans?.[existing.rentalPlan];
              if (plan && Array.isArray(plan.features)) allowedFeatures = plan.features;
            } catch (e) {}
          } else if (existing.rentalPlan === 'FULL') {
            allowedFeatures = ['farm', 'fish', 'diamond', 'sellOre', 'upThue'];
          } else if (existing.rentalPlan === 'FISH') {
            allowedFeatures = ['fish', 'upThue'];
          }

          if (body.diamondSettings && !allowedFeatures.includes('diamond')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto KC!`);
          }
          if (body.fishSettings && !allowedFeatures.includes('fish')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Câu Cá!`);
          }
          if (body.sellOreSettings && !allowedFeatures.includes('sellOre')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Bán Đá!`);
          }
          if (body.farmSettings && !allowedFeatures.includes('farm')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Auto Farm!`);
          }
          if ((body.targetCoins !== undefined || body.upDays !== undefined) && !allowedFeatures.includes('upThue')) {
            throw new ForbiddenException(`Gói [${existing.rentalPlan}] không hỗ trợ tính năng Cài đặt Úp Thuê!`);
          }
        }
      }

      const dto = new UpdateAccountSetupRequestDto(body);
      dto.validate(); // Chặn lỗi ngay tầng đầu tiên

      const updated = await this.accountService.updateSetup(accountId, {
        targetCoins: dto.targetCoins,
        upDays: dto.upDays,
        farmSettings: dto.farmSettings,
        diamondSettings: dto.diamondSettings,
        fishSettings: dto.fishSettings,
        sellOreSettings: dto.sellOreSettings
      });
      this.broadcastChange();
      const resp = ApiResponse.success(updated, `Đã cập nhật cài đặt cho [${updated.username}]!`);
      resp.account = updated;
      return sendJson(res, 200, resp);
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async resetData(req, res, sendJson, parseJsonBody) {
    try {
      let body = {};
      try {
        body = await parseJsonBody(req);
      } catch (e) {}

      const accountId = req.params?.id || body?.id;
      if (!accountId) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }

      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        if (!req.user || !req.user.sub) {
          throw new UnauthorizedException('Vui lòng đăng nhập!');
        }
        const existing = await this.accountService.accountRepo.findById(accountId);
        if (!existing || existing.userId !== req.user.sub) {
          throw new ForbiddenException('Bạn không có quyền reset tài khoản này!');
        }
        if (existing.isRentalExpired()) {
          throw new BadRequestException('Tài khoản bot này đã hết hạn thuê! Vui lòng gia hạn để thực hiện thao tác.');
        }
      }

      const result = await this.accountService.resetData(accountId);
      this.broadcastChange();
      return sendJson(res, 200, ApiResponse.success(result, 'Đã reset dữ liệu tài khoản!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async randomTestRms(req, res, sendJson, parseJsonBody) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thao tác trực tiếp với RMS game!');
      }
      const body = await parseJsonBody(req);
      if (!body || !body.id) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }
      const result = await this.accountService.randomTestRms(body.id, body.rounds || 1);
      return sendJson(res, 200, ApiResponse.success(result, 'Kiểm thử RMS thành công!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async restoreOriginalRms(req, res, sendJson, parseJsonBody) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thao tác trực tiếp với RMS game!');
      }
      const body = await parseJsonBody(req);
      if (!body || !body.id) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }
      const result = await this.accountService.restoreOriginalRms(body.id);
      return sendJson(res, 200, ApiResponse.success(result, 'Đã khôi phục RMS gốc thành công!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async inspectRms(req, res, sendJson) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thao tác trực tiếp với RMS game!');
      }
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }
      const result = await this.accountService.inspectRms(id);
      return sendJson(res, 200, ApiResponse.success(result, 'Kiểm tra RMS thành công!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async auditRms(req, res, sendJson) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thao tác trực tiếp với RMS game!');
      }
      const url = new URL(req.url, 'http://localhost');
      const id = url.searchParams.get('id');
      if (!id) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }
      const result = await this.accountService.auditRms(id);
      return sendJson(res, 200, ApiResponse.success(result, 'Audit RMS hoàn tất!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async fixRms(req, res, sendJson, parseJsonBody) {
    try {
      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        throw new ForbiddenException('Chỉ quản trị viên mới có quyền thao tác trực tiếp với RMS game!');
      }
      const body = await parseJsonBody(req);
      if (!body || !body.id) {
        throw new BadRequestException('Thiếu ID tài khoản!');
      }
      const result = await this.accountService.fixAndSyncRms(body.id);
      this.broadcastChange();
      return sendJson(res, 200, ApiResponse.success(result, 'Sửa RMS và đồng bộ hoàn tất!'));
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }

  async getAccountLogs(req, res, sendJson) {
    try {
      const accountId = req.params?.id;
      if (!accountId) {
        throw new BadRequestException('Thiếu ID tài khoản cần xem nhật ký!');
      }

      const account = await (this.accountService.accountRepo ? this.accountService.accountRepo.findById(accountId) : this.accountService.getAccount(accountId));
      if (!account) {
        throw new BadRequestException('Không tìm thấy tài khoản bot!');
      }

      const isActualAdmin = Boolean(req.user && String(req.user.role || '').toUpperCase() === 'ADMIN');
      if (!isActualAdmin) {
        if (!req.user || !req.user.sub) {
          throw new UnauthorizedException('Vui lòng đăng nhập để xem nhật ký!');
        }
        if (account.userId !== req.user.sub) {
          throw new ForbiddenException('Bạn không có quyền xem nhật ký của tài khoản này!');
        }
      }

      const allLogs = this.sseEventBus?.getAccountLogs
        ? this.sseEventBus.getAccountLogs(accountId, account.username)
        : (this.sseEventBus?.getLogs ? this.sseEventBus.getLogs() : []);

      // Tối ưu hóa O(1) in-memory lookup: Lấy tối đa 300 dòng log sạch mới nhất trực tiếp từ bộ nhớ
      const accountLogs = [];
      const cleanUsername = account.username ? String(account.username).toLowerCase() : null;

      for (let i = allLogs.length - 1; i >= 0 && accountLogs.length < 300; i--) {
        const log = allLogs[i];
        if (!log) continue;
        const matchesAccount = log.accountId === accountId ||
          (cleanUsername && log.username && String(log.username).toLowerCase() === cleanUsername) ||
          (cleanUsername && log.text && log.text.toLowerCase().includes(cleanUsername));
        if (matchesAccount) {
          accountLogs.unshift(log);
        }
      }

      return sendJson(res, 200, {
        success: true,
        account: {
          id: account.id,
          username: account.username
        },
        logs: accountLogs
      });
    } catch (err) {
      return this._sendError(res, sendJson, err);
    }
  }
}

module.exports = AccountController;
