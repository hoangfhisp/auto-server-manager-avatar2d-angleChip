# System Design & Engine Execution Pipeline

> Comprehensive technical breakdown of the multi-process bot execution engine, binary RMS storage, dual-canvas graphic rendering, IPC protocol, and runtime supervision in Avatar Multi-Bot Manager.

---

## 1. High-Level Engine Architecture

The platform operates as a persistent daemon supervising dozens of isolated Java Virtual Machine (JVM) instances. Each instance executes the AngelChip MicroEmulator runtime loading an Avatar 2D game binary.

```mermaid
graph TD
    Client["Browser / Web Dashboard"] -->|"HTTP / REST API"| Controller["HttpServer Router"]
    Client -->|"Server-Sent Events (SSE)"| SSE["SseEventBus & CrossProcessBus"]
    
    Controller -->|"State Changes"| BotMgr["MultiBotManager"]
    BotMgr -->|"Spawn / Kill"| ProcReg["ProcessRegistry"]
    
    ProcReg -->|"Fork ChildProcess"| BotProc["SingleBotProcess"]
    
    subgraph HostRuntime ["Host Runtime (Linux / Windows / cPanel)"]
        BotProc -->|"Direct Byte Writing"| RMS["RmsWriter (.rs RecordStores)"]
        BotProc -->|"Process Stdin / Stdout"| IPC["BotIpcProtocol"]
        BotProc -->|"AWT Headless"| JVM["JVM 17 (AngelChip Jar + Game Jar)"]
    end
    
    subgraph NetworkRouting ["Network & Proxy Pipeline"]
        JVM -->|"SOCKS5 / HTTP Tunnel"| Proxy["Dedicated Proxy Socket"]
        Proxy -->|"Socket Traffic"| GameServer["Teamobi Avatar Server (HM / DK)"]
    end
    
    IPC -->|"Parsed Telemetry"| BotProc
    BotProc -->|"Real-time Logs & Stats"| SSE
```

---

## 2. Java Process Isolation & Lifecycle (`SingleBotProcess`)

Each game account is executed inside its own dedicated child process. This guarantees that a crash, memory leak, or thread hang in one game instance has zero impact on other running accounts or the web control panel.

### Execution Command Breakdown

When launching a bot account, `SingleBotProcess` constructs the command line arguments:

```bash
# Password is intentionally excluded from CLI properties to prevent ps aux exposure
# It is securely passed via process environment: env.AVATAR_PASS
java \
  -Djava.awt.headless=true \
  -Dmicroemulator.display=headless \
  -Dmicroemulator.recordstore=filesystem \
  -Dmicroemulator.rms.path=.microemulator/suite-avatar_<username>_<fileId> \
  -DsocksProxyHost=<proxy_host> \
  -DsocksProxyPort=<proxy_port> \
  -DsocksProxyVersion=5 \
  -Davatar.user=<username> \
  -Davatar.server=<server_id> \
  -Xms12m \
  -Xmx48m \
  -XX:+UseSerialGC \
  -jar jars/emulator/AngelChipEmulator_V2Proxy.jar \
  avatar_main \
  jars/games/<game_jar>
```

> [!NOTE]
> **Hardened Lifecycle & Security Guarantees:**
> * **Process Isolation State Machine:** `SingleBotProcess` tracks atomic lifecycle states: `IDLE` $\rightarrow$ `STARTING` $\rightarrow$ `RUNNING` $\rightarrow$ `STOPPING` $\rightarrow$ `STOPPED`.
> * **Stop/Start Race Immunity:** Process termination holds dedicated instance references, ensuring stale `close` callbacks from dying JVMs cannot invalidate newly spawned child processes.
> * **Protected Credentials:** Password credentials are never exposed in Linux process listings (`ps aux`), operating via runtime `env.AVATAR_PASS` fallback in `AvatarHeadlessLauncher.java`.

### Process Supervision State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle: Account registered
    Idle --> Starting: User trigger / autoStart
    Starting --> InitializingRms: Build .rs binary configs
    InitializingRms --> SpawningJvm: Fork child process
    SpawningJvm --> Authenticating: Connect to proxy & game
    Authenticating --> Online: Login validated & coins parsed
    Authenticating --> AuthError: Invalid credentials (Stop)
    Authenticating --> ProxyError: Proxy auth failure (Notify)
    Online --> RunningAuto: Script loop active (Farm/Fish/UpXu)
    RunningAuto --> Disconnected: Socket drop / Server restart
    Disconnected --> Reconnecting: Watchdog exponential backoff
    Reconnecting --> SpawningJvm: Retry attempt <= Max
    Reconnecting --> Idle: Max retries exceeded
    Online --> TargetReached: Coin / Heart goal reached (Stop)
    RunningAuto --> Idle: Manual stop
```

---

## 3. MicroEmulator RMS Binary Format (`RmsWriter`)

Avatar 2D saves player credentials, mod configuration, starting currency, and farming timers into Java ME RecordStore (`.rs`) files located on the file system. `RmsWriter` directly generates and updates these binary files before launching the Java process, bypassing manual in-game configuration.

### FileSystemRecordStore Binary Layout

Every `.rs` file follows the strict binary format of MicroEmulator's `FileSystemRecordStore`:

| Offset (Bytes) | Field Name | Data Type | Endianness | Description |
| :--- | :--- | :--- | :--- | :--- |
| `0x00 .. 0x01` | `nameLength` (`N`) | `UInt16` | Big-Endian | Length in bytes of the RecordStore identifier string |
| `0x02 .. (0x02 + N - 1)` | `recordStoreName` | `UTF-8 String` | -- | ASCII / UTF-8 name of the record store |
| `(0x02 + N) .. +3` | `version` | `Int32` | Big-Endian | RecordStore version identifier (always `1`) |
| `+4 .. +11` | `lastModified` | `Int64` | Big-Endian | Milliseconds epoch timestamp of last write |
| `+12 .. +15` | `nextRecordId` | `Int32` | Big-Endian | ID assigned to the next record (always `2`) |
| `+16 .. +19` | `numRecords` | `Int32` | Big-Endian | Total records stored in file (always `1`) |
| `+20 .. +23` | `recordSize` (`S`) | `Int32` | Big-Endian | Length in bytes of the record 1 payload |
| `+24 .. +(24 + S - 1)` | `recordPayload` | `Binary Data` | Big-Endian | Mod-specific payload bytes |

*Total Header Size:* `2 + N + 24` bytes.

### Mod-Specific Payload Offsets

#### Up Thue Data (`chip_<username>Data.rs` & `chip_Data.rs` - 28 Bytes Payload)

Used by the bot mod to calculate coins earned and session duration:

| Byte Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x00 .. 0x03` | `xuBanDau` | `Int32BE` | Starting coin balance recorded at session start |
| `0x04 .. 0x0B` | `startedTs` | `Int64BE` | Timestamp when farming began (epoch ms) |
| `0x0C .. 0x0F` | `upDays` | `Int32BE` | Configured duration in days |
| `0x10 .. 0x13` | `targetCoins` | `Int32BE` | Target coin quota (stops bot when reached) |
| `0x14 .. 0x1B` | `lastUpdateTs` | `Int64BE` | Timestamp of the most recent sync |

#### Up Thue Stats Reset (`chip_<username>Coin.rs` - 8 Bytes Payload)

| Byte Offset | Field | Type | Description |
| :--- | :--- | :--- | :--- |
| `0x00 .. 0x03` | `earnedCoins` | `Int32BE` | Total coins collected in session (reset to `0`) |
| `0x04 .. 0x07` | `collectedHearts` | `Int32BE` | Total hearts collected (reset to `0`) |

#### Directory Hierarchy & Safety Locks

```text
.microemulator/
├── suite-avatar_<username>_<fileId>/
│   ├── chip_<username>Data.rs
│   ├── chip_<username>Coin.rs
│   ├── chip_Data.rs
│   ├── chip_Coin.rs
│   ├── farm_<username>.rs
│   └── kc_<username>.rs
```

> [!IMPORTANT]
> **Anti-Collision Guard:** When deleting an account or releasing a rental slot, `RmsWriter.cleanAccountRmsDirs` scans all active database slots. If another active slot shares the same in-game username, the RMS suite is preserved to prevent catastrophic data loss.

---

## 4. Dual-Canvas Graphic Rendering Engine

For accounts running on headless environments where visual verification is required, the system employs a dual-canvas graphic rendering architecture.

```mermaid
graph LR
    subgraph Emulator ["Headless MicroEmulator"]
        CanvasBuffer["Off-screen Video Buffer (BufferedImage)"]
        FrameExtractor["AWT Graphic Hook (15 FPS Cap)"]
        CanvasBuffer --> FrameExtractor
    end

    subgraph StreamingPipeline ["Streaming Pipeline"]
        FrameExtractor --> Compression["Delta Frame Compression (PNG/WebP)"]
        Compression --> Channel["SSE Binary Event Channel"]
    end

    subgraph Browser ["Web Dashboard UI"]
        Channel --> BackgroundCanvas["Canvas 1: Background & Static Tiles"]
        Channel --> ForegroundCanvas["Canvas 2: Entities & Sprite Animations"]
        BackgroundCanvas --- Compositor["Hardware Compositor"]
        ForegroundCanvas --- Compositor
    end
```

### Key Optimizations

1. **Dual-Layer Separation**: Static tilemaps (farm terrain, market stalls) are cached on the Background Canvas and only redrawn upon map transition. Only dynamic sprites (characters, fish, countdown labels) are drawn onto the Foreground Canvas.
2. **Delta Throttling**: If no state changed between ticks, frames are dropped to conserve server CPU and client network bandwidth.
3. **Bandwidth Guard**: On mobile viewports or when the tab is backgrounded, frame extraction frequency drops from 15 FPS to 1 FPS automatically.

---

## 5. Process IPC Protocol (`BotIpcProtocol`) & Watchdog

Because Java ME games run as closed processes, Node.js supervises them by writing commands to `stdin` and parsing structured log strings from `stdout`/`stderr`.

### Outbound Commands (`Node.js` -> `Java stdin`)

| Command Signature | Payload | Description |
| :--- | :--- | :--- |
| `START_AUTO <type>` | `farm`, `kc`, `fish`, `sell_ore` | Starts specific automated gameplay routine |
| `STOP_AUTO` | None or `<type>` | Pauses or halts current auto script |
| `SETUP <targetCoins> <upDays>` | Numeric parameters | Updates target coins and uptime in-game |
| `FARM_SETTINGS <json>` | Soil, seed, and harvest flags | Configures crop rotation and animal care |
| `DIAMOND_SETTINGS <json>` | Area, tool, mining speed | Configures underground mining parameters |
| `FISH_SETTINGS <json>` | Rod ID, bait type, location | Configures fishing spot and bait loop |
| `RESET_DATA` | None | Resets accumulated coin and heart counters |

### Inbound Telemetry Packets (`Java stdout` -> `Node.js`)

`BotIpcProtocol.parseLine` detects and consumes specific packet signatures:

1. **`[ACCOUNT_STATUS]: { "state": "online" | "disconnected" | "maintenance", "isTargetReached": boolean }`**  
   Updates the top-level status badge and evaluates if the quota has been completed.
2. **`[AUTO_STATUS]: { "isRunning": boolean, "autoType": "farm" | "fish" | "diamond", "subTask": string }`**  
   Updates in-game mod activity (e.g., returning from diamond mine to water crops).
3. **`[PLAYER_STATS]: { "coins": number, "gold": number, "farmingCountdown": string, "kcx": string }`**  
   Synchronizes live statistics into the dashboard card without database writes.
4. **`[EVENT_STATUS]: { "item": string, "drop": number, "current": number, "max": number, "source": "farm" | "fish" }`**  
   Emits real-time event item collection progress extracted directly from game mod RAM without poll latency.

### Game Mod RAM Event Gift Extraction & Harvest Anti-Ghosting

Avatar event items (Bột Bí Ngô, Đường trắng, v.v.) are tracked natively by the game server and cached inside the mod's `SkGift` static class in RAM (`lastX` for current progress, `lastY` for daily quota limit, e.g., `42/120`).

```mermaid
sequenceDiagram
    autonumber
    participant Server as Avatar Game Server
    participant Mod as Mod RAM (SkGift.lastX/lastY)
    participant Engine as Java Headless Launcher
    participant Web as Dashboard & AccountLogsModal
    
    Server->>Mod: Sync Event Progress (42/120)
    Note over Engine: Bot transitions Fish -> Farm
    Engine->>Engine: Guard check: lastAutoTask == 'farm'? (NO -> Skip check)
    Engine->>Server: Arrive at Farm & Water Crops
    Server-->>Engine: Popup: "Đã chăm sóc xong!"
    Engine->>Mod: Read SkGift.lastX (e.g. 48/120)
    Engine->>Engine: Compare with baseline (48 - 42 = +6 drop)
    Engine->>Web: Telemetry: [EVENT_STATUS] {"drop": 6, "current": 48, "max": 120}
    Engine->>Web: Log: "🎁 [SỰ KIỆN FARM]: Đã nhận vật phẩm sự kiện (Hôm nay: 48/120)"
```

* **Silent Baseline Initialization**: When entering farm mode, if the previous total is uninitialized (`prev < 0`), the launcher silently anchors the baseline without printing false drop logs.
* **Task-Switch Isolation Guard**: Harvest verification is strictly constrained to genuine farm routines (`isCurrentlyFarming == true` and `lastAutoTask.autoType == 'farm'`), completely preventing fishing gift counters from triggering false farm harvest logs during scheduled crop checks.
* **Dynamic Auto Startup Identifiers**: Every auto routine emits a distinct identifier: `🌾` (Farm), `🎣` (Fish), `💎` (Diamond/KC), `🪨` (Sell Ore/Bán đá), `👶` (Baby), `🎉` (Event), ensuring crisp vector badge rendering on the web console.

### Watchdog Exponential Backoff Algorithm

When an unexpected socket drop occurs (`MẤT KẾT NỐI`, `SocketTimeoutException`, `ConnectException`), the Watchdog handles recovery using an exponential backoff schedule with jitter:

$$\text{Delay}(n) = \min\left(\text{MaxDelay}, \text{BaseDelay} \times 2^{n}\right) \pm \text{Jitter}$$

* **Base Delay**: 5,000 ms (5 seconds).
* **Max Delay**: 120,000 ms (2 minutes).
* **Jitter**: $\pm 1,500$ ms randomized to avoid synchronized reconnection storms (thundering herd problem) against the game server.
* **Max Retries**: 5 consecutive failures before moving the account to `idle` with an alert notification.

---

## 6. Real-time Event Streaming (`SseEventBus` & `CrossProcessBus`)

Logs and metrics are delivered to the browser using Server-Sent Events (SSE). To ensure compatibility with multi-worker environments (such as Phusion Passenger on cPanel or PM2 cluster mode), events are synchronized across worker processes.

```mermaid
graph TD
    Worker1["Node.js Worker 1 (Hosts Bot 1-10)"] -->|"IPC Publish"| SharedDisk["Cross-Process Event Log (RAM / Disk Buffer)"]
    Worker2["Node.js Worker 2 (Hosts Web Dashboard)"] -->|"IPC Ingest"| SharedDisk
    
    Worker2 -->|"Broadcast Local"| SSE["SseEventBus"]
    SSE -->|"text/event-stream"| Client["Connected Admin / User Browsers"]
```

* **Heartbeat**: A `ping` event is emitted every 25 seconds to keep intermediary proxy connections alive.
* **No Buffering**: Headers include `X-Accel-Buffering: no` and `Cache-Control: no-cache` to force reverse proxies (Nginx, LiteSpeed) to flush chunks immediately.

### Enterprise Structured Logging Architecture (`RotatingFileAppender`)

To prevent I/O disk bottlenecks and VPS storage exhaustion while maintaining continuous auditability:

1. **Non-blocking Asynchronous Batch Flush**: Logs are written to an in-memory queue and flushed every 800ms in batched streams, completely decoupling disk write latency from the Node.js event loop.
2. **Dual-Category Stream Separation**:
   * General activity: `logs/app-YYYY-MM-DD.log` (Info, warnings, life-cycle transitions).
   * Critical exceptions: `logs/error-YYYY-MM-DD.log` (Full error stack, deep cause metadata `err.cause`, SQL state, socket error codes).
3. **Automated 7-Day Retention Cleanup**: Daily rotation triggers automatic pruning of log archives older than 7 days, maintaining disk usage under 50MB across long-term deployments.
4. **O(1) In-Memory Account Log Ring Buffer**: `CrossProcessBus.accountLogsMap` retains up to 1,000 latest clean entries per account in RAM, enabling instant opening of `AccountLogsModal` in under 0.5ms with zero disk reads.

---

## 7. Multi-Tenant Session Isolation & Frontend State Management

To guarantee zero data contamination between Admin and User sessions across logout and login transitions:

```mermaid
flowchart TD
    Logout["User / Admin Triggers Logout"] --> ResetState["Reset React State: accounts=[], files=[], proxies=[], logs=[]"]
    ResetState --> CloseSSE["Close Persistent SSE Stream"]
    CloseSSE --> ClearTokens["Purge JWT Access & Refresh Tokens"]
    ClearTokens --> AuthPage["Render AuthPage"]
    
    AuthPage --> Login["New User Logs In"]
    Login --> FreshState["Wipe Stale In-Memory Buffers"]
    FreshState --> SyncAPI["Unconditional fetchAccounts() & fetchStatus()"]
    SyncAPI --> RoleCheck{"Role == 'ADMIN'?"}
    RoleCheck -->|Yes| AdminData["Fetch files, proxies, jars, server logs"]
    RoleCheck -->|No| UserData["Strict Filter: a.userId == currentUser.id"]
```

1. **Deterministic State Flush**: On `loginUser`, `logoutUser`, and `handleUnauthorized`, all state vectors (`accounts`, `files`, `proxies`, `logs`, `status`) are purged synchronously, eliminating ghost accounts.
2. **Client-Side Defense-in-Depth**: `UserDashboardPage` applies strict client-side ownership verification (`a.userId === currentUser.id`), preventing any temporary race condition from exposing admin or peer accounts on the user interface.
3. **Backend Enforcement Barrier**: Every state-mutating endpoint (`start`, `stop`, `auto`, `setup`, `delete`, `reset`) validates `account.userId === req.user.sub` on the server side, returning `HTTP 403 Forbidden` if a non-owner attempts execution.
