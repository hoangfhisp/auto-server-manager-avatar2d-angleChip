# RESTful API & Real-time Event Specification

> Complete technical reference for the HTTP REST endpoints, Server-Sent Events (SSE) streaming protocol, payOS webhook validation, and security middleware pipeline.

---

## 1. Response Standards

All HTTP endpoints return standardized JSON payloads for predictability across client applications.

### Success Envelope (`ApiResponse`)

```json
{
  "success": true,
  "message": "Operation completed successfully",
  "data": { ... },
  "pagination": null
}
```

### Validation Error Envelope (HTTP 400 - `ErrorResponse.validation`)

```json
{
  "success": false,
  "message": "Invalid request parameters",
  "errors": {
    "username": "Tên tài khoản không được để trống!",
    "serverId": "Máy chủ không hợp lệ (0: Hoàn Mỹ, 1: Diệu Kỳ)!"
  }
}
```

### Business Exception Envelope (HTTP 4xx / 5xx)

```json
{
  "success": false,
  "message": "Tài khoản bot đang chạy, không thể thực hiện thao tác!",
  "errors": null
}
```

---

## 2. Security Middleware Pipeline

Incoming HTTP requests pass through three security boundary guards:

1. **CORS Whitelisting (`corsMiddleware.js`)**: Dynamic origin verification matching `CORS_ALLOWED_ORIGINS` in `.env`.
2. **Timing-Attack Immune Auth (`authMiddleware.js`)**: Constant-time string comparison (`crypto.timingSafeEqual`) on session and API tokens.
3. **Payload Sanitization (`bodyParserMiddleware.js`)**: Anti-DoS request size limits (`MAX_PAYLOAD_SIZE_MB`) and prototype pollution sanitization.

---

## 3. Server-Sent Events (SSE) Protocol

Real-time terminal logs, in-game stat counters, and wallet balance notifications stream over a persistent HTTP connection.

### Connection Endpoint: `GET /api/events`

#### Required Request Headers
```http
Accept: text/event-stream
Cache-Control: no-cache
```

#### Response Handshake Headers
```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
Access-Control-Allow-Origin: <dynamically matched against CORS_ALLOWED_ORIGINS>
```

> [!IMPORTANT]
> The `X-Accel-Buffering: no` header is essential. It instructs upstream reverse proxies (Nginx, LiteSpeed, Cloudflare) not to buffer stream chunks, ensuring log lines arrive in the browser with sub-second latency.
> Origin validation ensures unauthorized third-party sites cannot stream confidential terminal logs or balance telemetry.

### Event Message Schemas

#### 1. Heartbeat Ping (`event: ping`)
Dispatched every 25 seconds to keep intermediary proxy connections alive:
```json
{
  "time": 1714152000000
}
```

#### 2. Process Log Line (`event: log`)
```json
{
  "accountId": "018f3a2c-1234-7000-8000-000000000001",
  "username": "avatar_player1",
  "message": "[avatar_player1] Đã câu được 1 Cá Lóc (+2,500 xu)",
  "type": "stdout",
  "timestamp": "2026-10-26T20:00:00.000Z"
}
```

#### 3. Account & Automation Runtime State (`event: bot-account-status` / `event: bot-auto-status` / `event: bot-status-changed`)
Broadcasts state machine transitions and sub-task activity:
```json
{
  "accountId": "018f3a2c-1234-7000-8000-000000000001",
  "username": "avatar_player1",
  "state": "online",
  "autoType": "farm",
  "autoStatus": "active"
}
```

#### 4. Real-time Balance Update (`event: balance-updated`)
Triggered automatically when a payOS payment is confirmed or balance changes:
```json
{
  "userId": "018f3a2c-9999-7000-8000-000000000002",
  "newBalance": 150000
}
```
```

---

## 4. REST Endpoint Catalog

### Authentication (`/api/auth`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | Register new user account (creates PENDING user) |
| `POST` | `/api/auth/activate` | Public | Activate registered account via OTP |
| `POST` | `/api/auth/login` | Public | Authenticate user & return Access Token (JWT) + Refresh Token |
| `POST` | `/api/auth/refresh` | Public | Rotate refresh token and issue new token pair |
| `POST` | `/api/auth/logout` | User | Invalidate session refresh token |
| `POST` | `/api/auth/forgot-password` | Public | Generate password reset OTP |
| `POST` | `/api/auth/verify-reset-otp`| Public | Verify reset OTP token |
| `POST` | `/api/auth/reset-password` | Public | Set new password with verified reset token |
| `GET` | `/api/auth/me` | User | Retrieve current user profile & balance |

### Bot Process Management (`/api/bot` & `/api/accounts`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/accounts/:id/start` | User (Owner/Admin) | Spawn isolated Java process for specified account |
| `POST` | `/api/accounts/:id/stop` | User (Owner/Admin) | Stop running Java process tree for specified account |
| `POST` | `/api/accounts/:id/auto` | User (Owner/Admin) | Trigger in-game routine (`farm`, `fish`, `diamond`, `sell_ore`, `event`) |
| `GET` | `/api/accounts/:id/logs` | User (Owner/Admin) | O(1) in-memory lookup returning 300 latest clean log entries |
| `POST` | `/api/start` | Admin | Batch launch all idle accounts in active profile |
| `POST` | `/api/stop` | Admin | Batch stop all active accounts in active profile |
| `POST` | `/api/restart` | Admin | Gracefully restart all running bot instances |
| `GET` | `/api/status` | User | Aggregate CPU, memory, bot counts, and file metrics |
| `GET` | `/api/logs` | Admin | Fetch system-wide activity log buffer |
| `POST` | `/api/clear-logs` | Admin | Clear terminal log ring buffer |

### Account & Slot Management (`/api/accounts`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/accounts` | User (Filtered) / Admin | List accounts (users only see their owned slots; password masked `******`) |
| `POST` | `/api/accounts` | Admin / System | Create a new game account profile |
| `PUT` | `/api/accounts/:id` | User (Owner/Admin) | Update account credentials or mod settings (system fields locked for users) |
| `PUT` | `/api/accounts/:id/setup` | User (Owner/Admin) | Update target coin goals, duration days, or feature parameters |
| `DELETE` | `/api/accounts/:id` | User (Owner/Admin) | Delete account profile and clear session logs |
| `POST` | `/api/accounts/:id/reset` | User (Owner/Admin) | Reset accumulated coin and heart counters in mod RMS |
| `POST` | `/api/accounts/:id/switch-server` | Admin | Migrate bot between Hoàn Mỹ (0) and Diệu Kỳ (1) |

### Multi-Tenant Rental Engine (`/api/rental`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/rental/plans` | Public | Get active plans, duration discounts, and quotas |
| `POST` | `/api/rental/checkout` | User | Rent a new bot slot (allocates file, proxy, server) |
| `POST` | `/api/rental/renew/:id` | User | Renew existing slot for specified account |
| `POST` | `/api/rental/renew` | User | Renew existing slot (ID in payload) |
| `POST` | `/api/rental/cancel/:id` | User | Cancel rented slot with pro-rata wallet refund minus cancel fee |

#### Example: Rent Slot Request (`POST /api/rental/checkout`)
```json
{
  "plan": "UPXU",
  "durationMonths": 3,
  "username": "pro_farmer_01",
  "password": "secret_password",
  "serverId": 0,
  "voucherCode": "SALE20"
}
```

### Billing & Automated payOS Payments (`/api/billing`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/billing/balance` | User | Get current wallet balance & topup policy |
| `GET` | `/api/billing/policy` | Public | Get top-up bonus tiers, presets, and payment info |
| `GET` | `/api/billing/transactions` | User | Retrieve personal wallet transaction ledger (paginated) |
| `POST` | `/api/billing/payos-order` | User | Create payOS VietQR link with unique 12-digit orderCode |
| `GET` | `/api/billing/payos-order/:orderCode/verify` | User | Client return verification of payOS payment |
| `POST` | `/api/billing/payos-order/:orderCode/cancel` | User | Cancel pending payOS order and mark CANCELLED |
| `POST` | `/api/billing/payos-webhook` | Public (Signed) | payOS automated 24/7 bank transfer IPN callback |
| `POST` | `/api/billing/check-voucher` | User | Preview voucher discount for plan & duration |
| `POST` | `/api/billing/topup` | Admin | Admin-only manual balance adjustment |
| `POST` | `/api/billing/admin/adjust-balance` | Admin | Admin balance debit/credit with audit reason |
| `PUT` | `/api/billing/admin/topup-settings` | Admin | Update topup presets and bonus tier percentages |

### Proxy Pool Management (`/api/proxies`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/proxies` | Admin | List all proxies with health metrics and bot loads |
| `POST` | `/api/proxies` | Admin | Add static SOCKS5 / HTTP proxy to pool |
| `POST` | `/api/proxies/test-all` | Admin | Trigger asynchronous health check on all proxies |
| `POST` | `/api/proxies/:id/test` | Admin | Test latency and connectivity for single proxy |
| `DELETE` | `/api/proxies/:id` | Admin | Remove proxy from pool (requires 0 active accounts) |
| `GET` | `/api/proxies/stats` | Admin | Pool capacity metrics (HM / DK usage ratios) |

### Bot File Profiles (`/api/files`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/files` | Admin | List registered bot JAR file profiles |
| `POST` | `/api/files` | Admin | Create bot file profile |
| `PUT` | `/api/files/:id` | Admin | Update bot file profile properties |
| `DELETE` | `/api/files/:id` | Admin | Remove bot file profile |
| `POST` | `/api/files/:id/select` | Admin | Select active profile |

### Admin Resource Allocation Control (`/api/admin/rental-allocations`)

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/admin/rental-allocations` | Admin | View real-time bot distribution across proxies & files |
| `POST` | `/api/admin/rental-allocations/rules` | Admin | Update pricing tiers, discounts, and proxy strategy |

---

## 5. payOS Webhook Security & Idempotency Guarantee

The webhook endpoint (`POST /api/billing/payos-webhook`) receives bank payment confirmations 24/7. To guarantee absolute security against forged requests and duplicate wallet credits:

### HMAC-SHA256 Signature Verification

1. Extract all payload fields inside `data`.
2. Sort keys alphabetically (`amount`, `cancelUrl`, `description`, `orderCode`, `returnUrl`).
3. Construct query string format: `amount=50000&cancelUrl=...&orderCode=123456`.
4. Generate HMAC-SHA256 digest using `PAYOS_CHECKSUM_KEY`.
5. Compare against incoming `signature` using constant-time string comparison (`crypto.timingSafeEqual`). If signatures do not match, reject immediately with HTTP 400.

### Database Idempotency & ACID Atomic Claim

```mermaid
sequenceDiagram
    autonumber
    participant payOS as payOS Gateway
    participant Server as HttpServer (/api/billing/payos-webhook)
    participant DB as MySQL Database
    
    payOS->>Server: POST Webhook (orderCode: 881234, amount: 50000, signature: ...)
    Server->>Server: Validate HMAC-SHA256 Signature (timing-safe)
    
    Server->>DB: BEGIN TRANSACTION (TransactionManager)
    Server->>DB: UPDATE transactions SET status='SUCCESS', balance_after=... WHERE id=txId AND status='PENDING'
    
    alt Affected Rows == 0 (Already Claimed or Processed)
        Server-->>DB: ROLLBACK TRANSACTION
        Server-->>payOS: HTTP 200 {"success": true, "message": "Đơn hàng đã được xử lý trước đó"}
    else Affected Rows == 1 (Atomic Claim Won)
        Server->>DB: UPDATE users SET balance = balance + creditAmount WHERE id = userId
        Server-->>DB: COMMIT TRANSACTION
        Server->>Server: Emit SSE balance-updated to Client
        Server-->>payOS: HTTP 200 {"success": true, "message": "Đã cộng tiền tự động thành công!"}
    end
```

Even if network retries cause payOS to deliver the same webhook multiple times or if a user triggers verify simultaneously, the database unique constraint on `order_code` combined with atomic state claim `UPDATE ... WHERE status = 'PENDING'` guarantees single-credit idempotency.
