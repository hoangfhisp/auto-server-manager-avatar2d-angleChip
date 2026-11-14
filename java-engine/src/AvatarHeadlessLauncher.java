import javax.microedition.midlet.MIDlet;
import org.microemu.MIDletBridge;

/**
 * AvatarHeadlessLauncher
 * 
 * Chương trình khởi chạy và giám sát tự động Headless MicroEmulator cho Avatar.
 * Toàn bộ logic giao tiếp và thích ứng với các bản mod (Mod Up Xu, Mod Fish)
 * được ủy quyền xử lý qua lớp trung gian AvatarModAdapter.
 */
public class AvatarHeadlessLauncher {

    private static volatile boolean hasPermanentError = false;
    private static volatile long lastLoginAttemptTime = 0;
    private static volatile String activeJarPath = "";

    public static boolean checkAndRestoreGameJar(String jarPath) {
        if (jarPath == null || jarPath.trim().isEmpty()) jarPath = activeJarPath;
        if (jarPath == null || jarPath.trim().isEmpty()) jarPath = "avatar_upxu_build34.jar";

        try {
            java.io.File targetFile = new java.io.File(jarPath);
            if (targetFile.exists() && targetFile.length() > 200000L) {
                System.out.println("✅ [KIỂM TRA FILE JAR]: File game [" + targetFile.getName() + "] tồn tại nguyên vẹn (" + (targetFile.length() / 1024) + " KB).");
                return true;
            }

            System.err.println("⚠️ [CẢNH BÁO MẤT/LỖI FILE]: File game [" + jarPath + "] không tồn tại hoặc bị hỏng. Đang tự động nạp lại từ bản gốc...");
            java.io.File parentDir = targetFile.getParentFile() != null ? targetFile.getParentFile() : new java.io.File(".");
            String[] fallbackJars = new String[] { "avatar_upxu_build34.jar", "avatar_fish_build40.jar" };

            for (String fb : fallbackJars) {
                java.io.File fbFile = new java.io.File(parentDir, fb);
                if (!fbFile.exists()) fbFile = new java.io.File(fb);

                if (fbFile.exists() && fbFile.length() > 200000L && !fbFile.getAbsolutePath().equalsIgnoreCase(targetFile.getAbsolutePath())) {
                    java.nio.file.Files.copy(fbFile.toPath(), targetFile.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                    System.out.println("✅ [NẠP LẠI THÀNH CÔNG]: Đã tự động khôi phục và nạp lại file [" + targetFile.getName() + "] từ [" + fbFile.getName() + "]!");
                    return true;
                }
            }
        } catch (Throwable t) {
            System.err.println("❌ [LỖI NẠP FILE JAR]: " + t.getMessage());
        }
        return false;
    }

    public static void setupProxyAuthenticator() {
        try {
            final String socksHost = System.getProperty("socksProxyHost");
            final String socksPort = System.getProperty("socksProxyPort");
            final String httpHost = System.getProperty("http.proxyHost");
            final String httpPort = System.getProperty("http.proxyPort");

            final String avatarHost = System.getProperty("avatar.proxyHost");
            final String avatarPort = System.getProperty("avatar.proxyPort");
            final String avatarType = System.getProperty("avatar.proxyType");

            final String socksUser = System.getProperty("java.net.socks.username");
            final String socksPass = System.getProperty("java.net.socks.password");
            final String httpUser = System.getProperty("http.proxyUser");
            final String httpPass = System.getProperty("http.proxyPassword");

            final String avatarUser = System.getProperty("avatar.proxyUser");
            final String avatarPass = System.getProperty("avatar.proxyPass");

            final String finalUser = (avatarUser != null && !avatarUser.isEmpty()) ? avatarUser : 
                                    ((socksUser != null && !socksUser.isEmpty()) ? socksUser : httpUser);
            final String finalPass = (avatarPass != null && !avatarPass.isEmpty()) ? avatarPass : 
                                    ((socksPass != null && !socksPass.isEmpty()) ? socksPass : httpPass);

            String proxyHost = (avatarHost != null && !avatarHost.isEmpty()) ? avatarHost :
                               ((socksHost != null && !socksHost.isEmpty()) ? socksHost : httpHost);
            String proxyPort = (avatarPort != null && !avatarPort.isEmpty()) ? avatarPort :
                               ((socksPort != null && !socksPort.isEmpty()) ? socksPort : httpPort);

            if (proxyHost != null && !proxyHost.isEmpty()) {
                int pPort = 1080;
                try { pPort = Integer.parseInt(proxyPort); } catch (Exception ignored) {}
                String typeStr = (avatarType != null && !avatarType.isEmpty()) ? avatarType.toUpperCase() : "SOCKS";
                String nonProxyHosts = "angelchip.net|*.angelchip.net";

                // 1. Áp dụng các thuộc tính JVM chuẩn của AngelChip Emulator
                System.setProperty("java.net.useSystemProxies", "true");
                System.setProperty("http.nonProxyHosts", nonProxyHosts);
                System.setProperty("https.nonProxyHosts", nonProxyHosts);
                System.setProperty("socksProxyHost", proxyHost);
                System.setProperty("socksProxyPort", String.valueOf(pPort));

                // 2. Ghi trực tiếp cấu hình vào Config của bản giả lập MicroEmulator (angelchip_config2.xml)
                try {
                    org.microemu.app.Config.setProxy(true, proxyHost, pPort, finalUser != null ? finalUser : "", finalPass != null ? finalPass : "", nonProxyHosts);
                } catch (Throwable t) {
                }

                // 3. Khởi tạo Authenticator
                if (finalUser != null && !finalUser.isEmpty()) {
                    System.setProperty("java.net.socks.username", finalUser);
                    System.setProperty("java.net.socks.password", finalPass != null ? finalPass : "");

                    boolean akSuccess = false;
                    try {
                        Class<?> akCls = Class.forName("ak");
                        java.lang.reflect.Constructor<?> ctor = akCls.getConstructor(String[].class);
                        String[] proxyArr = new String[] { proxyHost, String.valueOf(pPort), finalUser, finalPass != null ? finalPass : "", nonProxyHosts, "true" };
                        java.net.Authenticator.setDefault((java.net.Authenticator) ctor.newInstance((Object) proxyArr));
                        akSuccess = true;
                    } catch (Throwable t) {
                        // Fallback
                    }

                    if (!akSuccess) {
                        java.net.Authenticator.setDefault(new java.net.Authenticator() {
                            @Override
                            protected java.net.PasswordAuthentication getPasswordAuthentication() {
                                return new java.net.PasswordAuthentication(finalUser, (finalPass != null ? finalPass : "").toCharArray());
                            }
                        });
                    }
                }
            }
        } catch (Throwable t) {
            System.err.println("⚠️ [PROXY AUTH ERR]: " + t.getMessage());
        }
    }

    private static String getGoalPrefix(AvatarModAdapter.PlayerStats s) {
        if (s != null && "days".equals(s.targetReachedReason)) {
            return "⌛ [HẾT HẠN NGÀY UP]";
        }
        return "🏆 [HOÀN THÀNH MỤC TIÊU]";
    }

    private static String formatGoalMessage(AvatarModAdapter.PlayerStats s) {
        if (s == null) return "Đã hoàn thành mục tiêu up theo cài đặt!";
        if ("days".equals(s.targetReachedReason)) {
            return "Đã hết thời hạn ngày up (" + s.upDays + " ngày)! (Đã cày: " + s.earnedCoins + (s.targetCoins > 0 ? (" / " + s.targetCoins) : "") + " xu)";
        }
        if (s.targetCoins > 0 && s.earnedCoins >= s.targetCoins) {
            return "Đã đạt mục tiêu up xu (" + s.earnedCoins + " / " + s.targetCoins + " xu)!";
        }
        return "Đã hoàn thành mục tiêu up xu theo cài đặt!";
    }

    private static final java.util.Set<String> farmItemBaselineEstablished = new java.util.HashSet<String>();
    private static final java.util.Set<String> fishItemBaselineEstablished = new java.util.HashSet<String>();

    private static int lastReportedFarmTotal = -1;
    private static int lastReportedFarmMaxTotal = 120;
    private static int candidateFarmCurrent = 0;
    private static int candidateFarmMax = 0;

    /**
     * Âm thầm đồng bộ mốc ban đầu của Nông Trại khi nick đang online và không farm.
     * Cập nhật tiến độ lên Web UI qua [EVENT_STATUS], tuyệt đối không in log chat nhận quà giả mạo!
     */
    private static synchronized void syncFarmBaselineSilently() {
        try {
            AvatarModAdapter.ModFarmGiftStatus st = AvatarModAdapter.getModFarmGiftStatus();
            if (st != null && st.current > 0) {
                if (lastReportedFarmTotal < 0) {
                    lastReportedFarmTotal = st.current;
                    lastReportedFarmMaxTotal = st.max > 0 ? st.max : 120;
                    System.out.println("[EVENT_STATUS]: {\"item\":\"farm\",\"drop\":0,\"current\":" + st.current + ",\"max\":" + lastReportedFarmMaxTotal + ",\"source\":\"farm\"}");
                }
            }
        } catch (Throwable ignored) {}
    }

    /**
     * Xuất tổng kết số lượng quà Nông Trại nhận được DUY NHẤT 1 LẦN sau khi hoàn thành lượt chăm Farm!
     * Định dạng chuẩn gọn gàng: "🎁 [SỰ KIỆN FARM]: Đã nhận vật phẩm sự kiện (Hôm nay: sl/max)"
     */
    private static synchronized void checkAndLogFarmHarvest() {
        try {
            int curCount = 0;
            int maxCount = 120;

            AvatarModAdapter.ModFarmGiftStatus st = AvatarModAdapter.getModFarmGiftStatus();
            if (st != null && st.current > 0) {
                curCount = st.current;
                maxCount = st.max > 0 ? st.max : 120;
            }

            if (curCount <= 0 && candidateFarmCurrent > 0) {
                curCount = candidateFarmCurrent;
                maxCount = candidateFarmMax > 0 ? candidateFarmMax : 120;
            }

            if (curCount <= 0) return;

            int prev = lastReportedFarmTotal;
            boolean isNewDay = false;
            boolean shouldLog = false;

            if (prev < 0) {
                // Thiết lập mốc ban đầu (Baseline) trước khi thu hoạch: không in log ảo!
                lastReportedFarmTotal = curCount;
                lastReportedFarmMaxTotal = maxCount;
                shouldLog = false;
            } else if (curCount < prev) {
                // Sang ngày mới:
                isNewDay = true;
                shouldLog = true;
                lastReportedFarmTotal = curCount;
                lastReportedFarmMaxTotal = maxCount;
            } else if (curCount > prev) {
                // Thu hoạch quà tăng thêm thật sự:
                shouldLog = true;
                lastReportedFarmTotal = curCount;
                lastReportedFarmMaxTotal = maxCount;
            }

            if (shouldLog) {
                String progressStr = (maxCount > 0) ? (" (Hôm nay: " + curCount + "/" + maxCount + ")") : (" (Tổng: " + curCount + ")");
                System.out.println("🎁 [SỰ KIỆN FARM]: Đã nhận vật phẩm sự kiện" + progressStr);
                int dropVal = (prev > 0 && curCount > prev) ? (curCount - prev) : curCount;
                System.out.println("[EVENT_STATUS]: {\"item\":\"farm\",\"drop\":" + dropVal + ",\"current\":" + curCount + ",\"max\":" + maxCount + ",\"source\":\"farm\"" + (isNewDay ? ",\"isNewDay\":true" : "") + "}");
            }
        } catch (Throwable ignored) {}
    }

    public static void main(String[] args) {
        try {
            System.setOut(new java.io.PrintStream(System.out, true, "UTF-8"));
            System.setErr(new java.io.PrintStream(System.err, true, "UTF-8"));
        } catch (Exception ignored) {}

        // Thiết lập Authenticator cho Proxy trước khi khởi động bất kỳ kết nối mạng nào
        setupProxyAuthenticator();

        if (args != null && args.length > 0) {
            activeJarPath = args[args.length - 1];
        }

        // Tự động kiểm tra file game ngay khi khởi động
        checkAndRestoreGameJar(activeJarPath);



        String customUser = System.getProperty("avatar.user");
        String customPass = System.getProperty("avatar.pass");
        String customServer = System.getProperty("avatar.server");
        String[] defaultServers = new String[] { "Hoàn Mỹ", "Diệu Kỳ", "Huyền Diệu", "Thần Tiên", "Mộng Mơ", "Song Tử", "Bạch Dương" };
        String resolvedServerName = System.getProperty("avatar.serverName");

        int serverId = 0;
        if (customServer != null && !customServer.isEmpty()) {
            try {
                int sId = Integer.parseInt(customServer);
                serverId = sId;
                if (sId >= 0 && sId < defaultServers.length) {
                    resolvedServerName = defaultServers[sId];
                }
            } catch (Exception ignored) {}
        }

        final int finalServerId = serverId;
        final String finalServerName = (resolvedServerName != null && !resolvedServerName.isEmpty()) ? resolvedServerName : "Hoàn Mỹ";

        final String initialAutoStartType = System.getProperty("avatar.autoStartType");
        final String[] persistentAutoHolder = new String[] { (initialAutoStartType != null && !initialAutoStartType.isEmpty()) ? initialAutoStartType : null };

        // 1. Thread nhận lệnh điều khiển thời gian thực từ Node.js (SETUP, RESET_DATA, START_AUTO, STOP_AUTO, ...)
        Thread stdinThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    java.io.BufferedReader reader = new java.io.BufferedReader(new java.io.InputStreamReader(System.in, "UTF-8"));
                    String cmdLine;
                    while ((cmdLine = reader.readLine()) != null) {
                        cmdLine = cmdLine.trim();
                        if (cmdLine.startsWith("SETUP ")) {
                            String[] parts = cmdLine.split("\\s+");
                            int targetCoins = parts.length > 1 ? Integer.parseInt(parts[1]) : 0;
                            int upDays = parts.length > 2 ? Integer.parseInt(parts[2]) : 0;
                            AvatarModAdapter.applyUpThueSetup(targetCoins, upDays);
                        } else if (cmdLine.startsWith("FARM_SETTINGS ")) {
                            String jsonStr = cmdLine.substring(14).trim();
                            AvatarModAdapter.applyFarmSetup(jsonStr);
                        } else if (cmdLine.startsWith("DIAMOND_SETTINGS ")) {
                            String jsonStr = cmdLine.substring(17).trim();
                            AvatarModAdapter.applyDiamondSetup(jsonStr);
                        } else if (cmdLine.startsWith("FISH_SETTINGS ")) {
                            String jsonStr = cmdLine.substring(14).trim();
                            AvatarModAdapter.applyFishSetup(jsonStr);
                        } else if (cmdLine.startsWith("SELL_ORE_SETTINGS ") || cmdLine.startsWith("STONE_SETTINGS ")) {
                            String jsonStr = cmdLine.substring(cmdLine.indexOf(' ') + 1).trim();
                            AvatarModAdapter.applySellOreSetup(jsonStr);
                        } else if (cmdLine.startsWith("START_AUTO")) {
                            String[] parts = cmdLine.split("\\s+");
                            String autoType = parts.length > 1 ? parts[1] : "farm";
                            // Ghi nhớ auto chính để tự động bật lại sau khi reconnect/khởi động lại
                            if (autoType != null && !autoType.trim().isEmpty()) {
                                persistentAutoHolder[0] = autoType.trim();
                            }
                            AvatarModAdapter.startAuto(autoType);
                        } else if (cmdLine.startsWith("STOP_AUTO")) {
                            String[] parts = cmdLine.split("\\s+");
                            String targetType = parts.length > 1 ? parts[1] : null;
                            if (targetType == null || targetType.equalsIgnoreCase(persistentAutoHolder[0])) {
                                persistentAutoHolder[0] = null;
                            }
                            AvatarModAdapter.stopAuto(targetType);
                        } else if (cmdLine.equals("RESET_DATA") || cmdLine.equals("RESET")) {
                            AvatarModAdapter.resetUpThueData();
                        }
                    }
                } catch (Throwable ignored) {}
            }
        });
        stdinThread.setDaemon(true);
        stdinThread.start();

        // 2. Thread giám sát và tự động đăng nhập / tự động kết nối lại 24/7
        Thread supervisorThread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    System.out.println("[QUY TRÌNH] 1. Đang khởi động giả lập Avatar (chờ 8 giây)...");
                    Thread.sleep(8000);

                    // Nạp cấu hình Farm, Diamond, Fish, SellOre vào game & RMS ngay khi giả lập tải xong
                    String initFarmB64 = System.getProperty("avatar.farmSettingsB64");
                    if (initFarmB64 != null && !initFarmB64.isEmpty()) {
                        try {
                            byte[] decoded = java.util.Base64.getDecoder().decode(initFarmB64);
                            AvatarModAdapter.applyFarmSetup(new String(decoded, "UTF-8"));
                        } catch (Throwable ignored) {}
                    }

                    String initDiamondB64 = System.getProperty("avatar.diamondSettingsB64");
                    if (initDiamondB64 != null && !initDiamondB64.isEmpty()) {
                        try {
                            byte[] decoded = java.util.Base64.getDecoder().decode(initDiamondB64);
                            AvatarModAdapter.applyDiamondSetup(new String(decoded, "UTF-8"));
                        } catch (Throwable ignored) {}
                    }

                    String initFishB64 = System.getProperty("avatar.fishSettingsB64");
                    if (initFishB64 != null && !initFishB64.isEmpty()) {
                        try {
                            byte[] decoded = java.util.Base64.getDecoder().decode(initFishB64);
                            AvatarModAdapter.applyFishSetup(new String(decoded, "UTF-8"));
                        } catch (Throwable ignored) {}
                    }

                    String initSellOreB64 = System.getProperty("avatar.sellOreSettingsB64");
                    if (initSellOreB64 != null && !initSellOreB64.isEmpty()) {
                        try {
                            byte[] decoded = java.util.Base64.getDecoder().decode(initSellOreB64);
                            AvatarModAdapter.applySellOreSetup(new String(decoded, "UTF-8"));
                        } catch (Throwable ignored) {}
                    }

                    System.out.println("[QUY TRÌNH] 2. Bắt đầu kết nối & đăng nhập tài khoản...");
                    lastLoginAttemptTime = System.currentTimeMillis();
                    AvatarModAdapter.login(customUser, customPass, finalServerId, finalServerName);

                    boolean initialSetupApplied = false;
                    boolean isCurrentlyOnline = false;
                    AvatarModAdapter.AutoTaskInfo lastAutoTask = null;

                    // Bộ theo dõi sự kiện game thông minh chống trùng lặp (Deduplicated Event Tracker tách riêng Farm & Fish)
                    String lastReportedPopupText = null;
                    String lastHandledEventPopupText = null;

                    // 1. Tiến độ sự kiện Câu Cá (Fish): hạn mức và số lượng riêng biệt
                    final java.util.Map<String, Integer> lastReportedFishCounts = new java.util.LinkedHashMap<String, Integer>();
                    final java.util.Map<String, Integer> lastReportedFishMax = new java.util.LinkedHashMap<String, Integer>();

                    // Tải mốc ban đầu từ RAM khi vừa đăng nhập (để Web UI biết tiến độ, TUYỆT ĐỐI KHÔNG in log chat nhận quà)
                    syncFarmBaselineSilently();

                    boolean wasFarming = false;

                    // Vòng lặp giám sát liên tục 24/7
                    while (true) {
                        // Thăm dò Dialog nhanh & Snapshot sự kiện mỗi 250ms trong 10 chu kỳ = 2.5s
                        for (int subTick = 0; subTick < 10; subTick++) {
                            Thread.sleep(250);

                            // Xác định loại Auto đang hoạt động tại thời điểm này
                            AvatarModAdapter.AutoTaskInfo curTask = AvatarModAdapter.getActiveAutoTask();
                            boolean isCurrentlyFishing = curTask != null && "fish".equalsIgnoreCase(curTask.autoType);
                            boolean isCurrentlyFarming = curTask != null && "farm".equalsIgnoreCase(curTask.autoType);

                            // Khi bot vừa kết thúc lượt Auto Farm -> xuất tổng kết 1 LẦN DUY NHẤT toàn bộ quà nhận được
                            if (wasFarming && !isCurrentlyFarming) {
                                checkAndLogFarmHarvest();
                            }
                            wasFarming = isCurrentlyFarming;

                            // 1. ĐỌC TRỰC TIẾP TỪ BỘ NHỚ RAM MOD (SkGift)
                            // 1.1. Dành cho Câu Cá: SkGift quét mảng NPC (gN/gName/gX/gY)
                            java.util.List<AvatarModAdapter.ModEventGiftItem> skSnapshot = AvatarModAdapter.getModEventGiftSnapshot();
                            boolean hasModGiftEngine = (skSnapshot != null);

                            if (hasModGiftEngine && isCurrentlyFishing) {
                                for (AvatarModAdapter.ModEventGiftItem it : skSnapshot) {
                                    if (!lastReportedFishCounts.containsKey(it.itemName)) {
                                        lastReportedFishCounts.put(it.itemName, it.currentCount);
                                        lastReportedFishMax.put(it.itemName, it.maxCount);
                                    } else {
                                        int prev = lastReportedFishCounts.get(it.itemName);
                                        if (it.currentCount > prev) {
                                            int added = it.currentCount - prev;
                                            lastReportedFishCounts.put(it.itemName, it.currentCount);
                                            lastReportedFishMax.put(it.itemName, it.maxCount);

                                            String pStr = (it.maxCount > 0) ? (" (Hôm nay: " + it.currentCount + "/" + it.maxCount + ")") : (" (Tổng: " + it.currentCount + ")");
                                            System.out.println("🎁 [SỰ KIỆN FISH]: Nhận +" + added + " " + it.itemName + pStr);
                                            System.out.println("[EVENT_STATUS]: {\"item\":\"" + AvatarModAdapter.escapeJson(it.itemName) + "\",\"drop\":" + added + ",\"current\":" + it.currentCount + ",\"max\":" + it.maxCount + ",\"source\":\"fish\"}");
                                        }
                                    }
                                }
                            }

                            // 1.2. Dành cho Nông Trại: Nếu không đang farm, âm thầm đồng bộ mốc ban đầu (Baseline) khi có vật phẩm trong RAM
                            if (!isCurrentlyFarming) {
                                syncFarmBaselineSilently();
                            }

                            // 2. Xử lý Dialog Game, Chữ bay màn hình & Tab Chat Admin:
                            // - Tự động đóng popup sự kiện ngay lập tức để game hoạt động trơn tru
                            // - Fallback nhận diện quà Câu Cá nếu bản mod không có SkGift
                            String currentDialog = AvatarModAdapter.checkActiveGameDialog();
                            String candidateDialog = (currentDialog != null && !currentDialog.trim().isEmpty())
                                    ? currentDialog
                                    : AvatarModAdapter.checkLatestGameDialog();

                            // Quét qua hàng đợi chữ bay trên màn hình (bx.if) nếu mod chuyển popup thành chữ bay
                            if (candidateDialog == null || candidateDialog.trim().isEmpty()) {
                                candidateDialog = AvatarModAdapter.checkFlyingBannerMessage();
                            }

                            // Nếu không có popup dialog (như khi bật Auto Farm), kiểm tra tin nhắn sự kiện từ Tab Chat Admin / Server
                            if (candidateDialog == null || candidateDialog.trim().isEmpty()) {
                                candidateDialog = AvatarModAdapter.checkAdminChatMessage();
                            }

                            if (candidateDialog != null && !candidateDialog.trim().isEmpty()) {
                                AvatarModAdapter.EventProgressInfo ev = AvatarModAdapter.parseEventText(candidateDialog);
                                if (ev != null) {
                                    // Tự động đóng popup sự kiện ngay lập tức để game hoạt động trơn tru
                                    AvatarModAdapter.dismissCurrentDialog();

                                    // Chống đếm lặp cùng 1 popup khi dialog singleton giữ chuỗi trong RAM
                                    if (!candidateDialog.equals(lastHandledEventPopupText)) {
                                        lastHandledEventPopupText = candidateDialog;

                                        // Bỏ hoàn toàn khối 2 của fish. Quà fish chỉ đọc từ SkGift ở Khối 1!
                                        if (isCurrentlyFarming || (ev.source != null && ev.source.toLowerCase().contains("farm"))) {
                                            if (ev.currentCount > 0) {
                                                candidateFarmCurrent = ev.currentCount;
                                            }
                                            if (ev.maxCount > 0) {
                                                candidateFarmMax = ev.maxCount;
                                            }
                                        }
                                    }
                                } else if (!candidateDialog.equals(lastReportedPopupText)) {
                                    String lowerDlg = candidateDialog.toLowerCase();
                                    // Bỏ qua các popup loading/chờ nội bộ không cần spam log
                                    if (!lowerDlg.contains("đang lấy dữ liệu") && !lowerDlg.contains("xin chờ") && !lowerDlg.contains("chờ xíu")) {
                                        lastReportedPopupText = candidateDialog;
                                        System.out.println("💬 [POPUP GAME]: " + candidateDialog);
                                        if (isCurrentlyFarming && (lowerDlg.contains("chăm sóc xong") || lowerDlg.contains("đã chăm sóc"))) {
                                            checkAndLogFarmHarvest();
                                        }
                                    }
                                }
                            }
                        }

                        if (hasPermanentError) {
                            Thread.sleep(5000);
                            continue;
                        }

                        // 2.0. Kiểm tra hoàn thành mục tiêu trực tiếp từ số liệu Mod trong RAM (CHỈ KHI ĐANG ONLINE TRONG GAME)
                        if (isCurrentlyOnline && AvatarModAdapter.isTargetReached()) {
                            isCurrentlyOnline = false;
                            AvatarModAdapter.PlayerStats s = AvatarModAdapter.extractPlayerStats();
                            String prefix = getGoalPrefix(s);
                            String goalMsg = formatGoalMessage(s);
                            System.out.println(prefix + ": " + goalMsg + (s != null ? (" (Số dư: " + s.coins + " xu)") : ""));
                            System.out.println("[ACCOUNT_STATUS]: {\"state\":\"target_reached\",\"message\":\"" + goalMsg + "\",\"isTargetReached\":true,\"isCompleted\":true}");
                            AvatarModAdapter.dismissCurrentDialog();
                            AvatarModAdapter.stopModAuto();
                            Thread.sleep(2000);
                            System.exit(0);
                            return;
                        }

                        // 2.1. Kiểm tra thông báo từ Server / Mod (Popup Dialog)
                        String currentDialog = AvatarModAdapter.checkActiveGameDialog();

                        if (currentDialog != null && !currentDialog.trim().isEmpty()) {
                            String lower = currentDialog.toLowerCase();

                            // 0. Kiểm tra hoàn thành mục tiêu Up Xu / Hết hạn ngày Up từ Popup Mod
                            if (lower.contains("đạt yêu cầu") || lower.contains("up xup theo") || lower.contains("up xu theo") || lower.contains("hoàn thành mục tiêu")) {
                                isCurrentlyOnline = false;
                                AvatarModAdapter.PlayerStats s = AvatarModAdapter.extractPlayerStats();
                                String goalMsg = (s != null && s.targetCoins > 0)
                                        ? ("Đã đạt mục tiêu up xu (" + s.earnedCoins + " / " + s.targetCoins + " xu)!")
                                        : currentDialog;
                                System.out.println("🏆 [HOÀN THÀNH MỤC TIÊU TỪ MOD]: " + goalMsg);
                                System.out.println("[ACCOUNT_STATUS]: {\"state\":\"target_reached\",\"message\":\"" + goalMsg + "\",\"isTargetReached\":true,\"isCompleted\":true}");
                                AvatarModAdapter.dismissCurrentDialog();
                                AvatarModAdapter.stopModAuto();
                                Thread.sleep(2000);
                                System.exit(0);
                                return;
                            }

                            // 1. Kiểm tra lỗi xác thực tài khoản (Sai pass, tài khoản không đúng)
                            if (lower.contains("sai") || lower.contains("mật khẩu") || lower.contains("không đúng") || 
                                lower.contains("không tồn tại") || lower.contains("không chính xác")) {
                                isCurrentlyOnline = false;
                                System.err.println("❌ [LỖI XÁC THỰC TỪ SERVER]: " + currentDialog);
                                System.out.println("[ACCOUNT_STATUS]: {\"state\":\"auth_error\",\"message\":\"" + currentDialog + "\",\"isError\":true}");
                                hasPermanentError = true;
                                continue;
                            }

                            // 2. Tài khoản bị khóa
                            if (lower.contains("khóa") || lower.contains("khoá")) {
                                isCurrentlyOnline = false;
                                System.err.println("❌ [TÀI KHOẢN BỊ KHÓA]: " + currentDialog);
                                System.out.println("[ACCOUNT_STATUS]: {\"state\":\"account_locked\",\"message\":\"" + currentDialog + "\",\"isError\":true}");
                                hasPermanentError = true;
                                continue;
                            }

                            // 2.5. Phát hiện hộp thoại xác nhận "Bạn có muốn thoát? (Có, Không)"
                            if (lower.contains("muốn thoát") || lower.contains("bạn có muốn thoát")) {
                                System.out.println("💬 [TỪ CHỐI THOÁT GAME]: Hộp thoại xác nhận \"" + currentDialog + "\" -> Đã tự động đóng/chọn Không để tiếp tục treo game!");
                                AvatarModAdapter.dismissCurrentDialog();
                                continue;
                            }

                            // 3. Popup lỗi có nút Thoát lúc khởi động -> Bấm Thoát, kiểm tra xem file có mất/hỏng không
                            // CHỈ bắt khi thực sự có nút Thoát trong ngoặc đơn (Thoát) hoặc (Exit), và không phải câu hỏi "muốn thoát"
                            if (!isCurrentlyOnline && !lower.contains("muốn thoát") && (currentDialog.contains("(Thoát)") || currentDialog.contains("(Exit)") || lower.contains("ứng dụng sai")) && !lower.contains("đối thủ") && !lower.contains("bỏ cuộc") && !lower.contains("để sau")) {
                                System.err.println("⚠️ [PHÁT HIỆN POPUP CÓ NÚT THOÁT]: \"" + currentDialog + "\" -> Bấm Thoát & Kiểm tra file game...");
                                AvatarModAdapter.dismissCurrentDialog();
                                checkAndRestoreGameJar(activeJarPath);
                                Thread.sleep(1500);
                                System.exit(1);
                                return;
                            }

                            // 4. Các thông báo nạp game bình thường (đang lấy dữ liệu nông trại, đang tải, xin chờ...) -> Bỏ qua, chờ game nạp xong
                            if (lower.contains("đang lấy dữ liệu") || lower.contains("đang kết nối") || lower.contains("đang tải") || lower.contains("xin chờ")) {
                                // Cho game nạp tự nhiên, không ngắt vòng lặp
                            } else if (isCurrentlyOnline) {
                                // 5. NẾU ĐANG ONLINE TRONG GAME: Chỉ ngắt kết nối khi Popup là Mất kết nối / Nơi khác đăng nhập
                                if (lower.contains("mất kết nối") || lower.contains("kết nối thất bại") || 
                                    lower.contains("nơi khác") || lower.contains("khác đăng nhập") || 
                                    lower.contains("đang online") || lower.contains("máy khác") || 
                                    lower.contains("người đăng nhập") || lower.contains("phiên làm việc") ||
                                    lower.contains("quá nhanh") || lower.contains("bảo trì")) {
                                    isCurrentlyOnline = false;
                                    System.out.println("[ACCOUNT_STATUS]: {\"state\":\"disconnected\",\"message\":\"" + currentDialog + " (Thử lại sau 20s)...\"}");
                                    AvatarModAdapter.dismissCurrentDialog();
                                    Thread.sleep(20000);
                                    lastLoginAttemptTime = System.currentTimeMillis();
                                    System.out.println("🔄 [TỰ ĐỘNG ĐĂNG NHẬP LẠI]: Đang kết nối lại máy chủ...");
                                    AvatarModAdapter.login(customUser, customPass, finalServerId, finalServerName);
                                    continue;
                                }
                                // Popup thông thường trong game (nông trại, đối thoại NPC...) -> Tự đóng để tiếp tục
                                AvatarModAdapter.dismissCurrentDialog();
                            } else {
                                // 6. NẾU ĐANG NGOÀI MÀN HÌNH ĐĂNG NHẬP (!isCurrentlyOnline):
                                // Toàn bộ các popup (Nơi khác, Quá nhanh, Mất kết nối, Bảo trì...) -> Đóng popup, chờ 20s rồi tự động đăng nhập lại
                                isCurrentlyOnline = false;
                                System.out.println("[ACCOUNT_STATUS]: {\"state\":\"disconnected\",\"message\":\"" + currentDialog + " (Thử lại sau 20s)...\"}");
                                AvatarModAdapter.dismissCurrentDialog();
                                Thread.sleep(20000);
                                lastLoginAttemptTime = System.currentTimeMillis();
                                System.out.println("🔄 [TỰ ĐỘNG ĐĂNG NHẬP LẠI]: Đang kết nối lại máy chủ...");
                                AvatarModAdapter.login(customUser, customPass, finalServerId, finalServerName);
                                continue;
                            }
                        }

                        // 2.2. Kiểm tra trạng thái người chơi & kết nối mạng socket
                        MIDlet activeMidlet = MIDletBridge.getCurrentMIDlet();
                        Object ef = AvatarModAdapter.getActivePlayerInstance(activeMidlet != null ? activeMidlet.getClass().getClassLoader() : null);
                        boolean connected = AvatarModAdapter.isNetworkConnected();
                        long now = System.currentTimeMillis();

                        // 2.2.0. Phát hiện nhân vật bị ĐĂNG XUẤT hoặc ĐÓNG SOCKET MẤT KẾT NỐI
                        if (isCurrentlyOnline && (ef == null || !connected)) {
                            isCurrentlyOnline = false;
                            System.out.println("⚠️ [ĐÓNG SOCKET / MẤT KẾT NỐI]: Socket đã đóng hoặc mất kết nối máy chủ!");
                            System.out.println("[ACCOUNT_STATUS]: {\"state\":\"disconnected\",\"message\":\"Mất kết nối / Đóng socket, đang đăng nhập lại sau 20s...\"}");
                            AvatarModAdapter.dismissCurrentDialog();
                            Thread.sleep(20000);
                            lastLoginAttemptTime = System.currentTimeMillis();
                            System.out.println("🔄 [TỰ ĐỘNG ĐĂNG NHẬP LẠI]: Đang kết nối lại máy chủ...");
                            AvatarModAdapter.login(customUser, customPass, finalServerId, finalServerName);
                            continue;
                        }

                        // 2.2.1. Đang ở ngoài màn hình game (chưa online):
                        // - Nếu socket đã đóng (!connected): Chờ đủ 20 giây rồi tự động kết nối lại
                        // - Nếu socket đang kết nối (đang tải dữ liệu map/item): Cho phép chờ tối đa 35 giây để game nạp xong, không ngắt giữa chừng
                        boolean isSocketDead = !connected && (now - lastLoginAttemptTime > 20000L);
                        boolean isStuckLoading = connected && (ef == null) && (now - lastLoginAttemptTime > 35000L);

                        if (!isCurrentlyOnline && (isSocketDead || isStuckLoading)) {
                            isCurrentlyOnline = false;
                            System.out.println("⚠️ [CHƯA VÀO ĐƯỢC GAME]: Tự động kết nối lại sau 20 giây...");
                            System.out.println("[ACCOUNT_STATUS]: {\"state\":\"disconnected\",\"message\":\"Đang kết nối lại máy chủ sau 20s...\"}");
                            AvatarModAdapter.dismissCurrentDialog();
                            Thread.sleep(20000);
                            lastLoginAttemptTime = System.currentTimeMillis();
                            System.out.println("🔄 [TỰ ĐỘNG ĐĂNG NHẬP LẠI]: Đang kết nối lại máy chủ...");
                            AvatarModAdapter.login(customUser, customPass, finalServerId, finalServerName);
                            continue;
                        }

                        // 2.3. Áp dụng cấu hình ban đầu sau khi đăng nhập thành công
                        if (connected && ef != null) {
                            if (!initialSetupApplied) {
                                initialSetupApplied = true;
                                String resetOnStart = System.getProperty("avatar.resetOnStart");
                                if ("true".equalsIgnoreCase(resetOnStart)) {
                                    AvatarModAdapter.resetUpThueData();
                                }

                                String initTarget = System.getProperty("avatar.targetCoins");
                                String initDays = System.getProperty("avatar.upDays");
                                if ((initTarget != null && !initTarget.isEmpty()) || (initDays != null && !initDays.isEmpty())) {
                                    int tCoins = 0;
                                    int uDays = 0;
                                    try { if (initTarget != null) tCoins = Integer.parseInt(initTarget); } catch (Exception ignored) {}
                                    try { if (initDays != null) uDays = Integer.parseInt(initDays); } catch (Exception ignored) {}
                                    AvatarModAdapter.applyUpThueSetup(tCoins, uDays);
                                }

                                initFarmB64 = System.getProperty("avatar.farmSettingsB64");
                                if (initFarmB64 != null && !initFarmB64.isEmpty()) {
                                    try {
                                        byte[] decoded = java.util.Base64.getDecoder().decode(initFarmB64);
                                        AvatarModAdapter.applyFarmSetup(new String(decoded, "UTF-8"));
                                    } catch (Throwable ignored) {}
                                }

                                initDiamondB64 = System.getProperty("avatar.diamondSettingsB64");
                                if (initDiamondB64 != null && !initDiamondB64.isEmpty()) {
                                    try {
                                        byte[] decoded = java.util.Base64.getDecoder().decode(initDiamondB64);
                                        AvatarModAdapter.applyDiamondSetup(new String(decoded, "UTF-8"));
                                    } catch (Throwable ignored) {}
                                }
                            }

                            if (!isCurrentlyOnline) {
                                isCurrentlyOnline = true;
                                System.out.println("[ACCOUNT_STATUS]: {\"state\":\"online\",\"message\":\"Đang Treo Online\",\"isError\":false,\"isMaintenance\":false}");

                                // Tự động khôi phục Auto đã chạy trước đó sau khi đăng nhập / kết nối lại thành công (CHỈ KHI CHƯA HOÀN THÀNH MỤC TIÊU)
                                // Tối ưu: Thực thi tuần tự trên supervisorThread thay vì tạo thêm native thread mới
                                if (persistentAutoHolder[0] != null && !persistentAutoHolder[0].trim().isEmpty() && !AvatarModAdapter.isTargetReached()) {
                                    final String toRestore = persistentAutoHolder[0];
                                    try {
                                        Thread.sleep(3500); // Chờ 3.5 giây cho map và dữ liệu nhân vật nạp ổn định
                                        if (!AvatarModAdapter.isTargetReached() && persistentAutoHolder[0] != null) {
                                            System.out.println("🔄 [TỰ ĐỘNG KHÔI PHỤC AUTO]: Đang kích hoạt lại " + toRestore + " sau khi kết nối lại thành công...");
                                            AvatarModAdapter.startAuto(toRestore);
                                        } else {
                                            persistentAutoHolder[0] = null;
                                        }
                                    } catch (Throwable ignored) {}
                                }
                            }
                        }

                        // 2.4. Trích xuất thông tin tài khoản (Số xu, Số lượng, Xu cần up, Tim, Đếm ngược cày...)
                        AvatarModAdapter.PlayerStats stats = AvatarModAdapter.extractPlayerStats();
                        System.out.println("[PLAYER_STATS]: " + stats.toJson(lastLoginAttemptTime));

                        // 2.4.1. Kiểm tra trực tiếp biến số liệu nội bộ của Mod xem đã hoàn tất mục tiêu chưa
                        if (stats.isTargetReached) {
                            isCurrentlyOnline = false;
                            String prefix = getGoalPrefix(stats);
                            String goalMsg = formatGoalMessage(stats);
                            System.out.println(prefix + " [TỪ SỐ LIỆU MOD]: " + goalMsg + " (Số dư: " + stats.coins + " xu)");
                            System.out.println("[ACCOUNT_STATUS]: {\"state\":\"target_reached\",\"message\":\"" + goalMsg + "\",\"isTargetReached\":true,\"isCompleted\":true}");
                            AvatarModAdapter.stopModAuto();
                            Thread.sleep(2000);
                            System.exit(0);
                            return;
                        }

                        // 2.5. Giám sát trạng thái tiến trình Auto (Auto Farm, Auto Diamond, Auto Fish, Auto Bán Đá, Auto Baby, Auto Tài Xỉu...)
                        try {
                            AvatarModAdapter.AutoTaskInfo curAutoTask = AvatarModAdapter.getActiveAutoTask();

                            if (lastAutoTask != null && curAutoTask == null) {
                                // 1. TẤT CẢ AUTO KHI HOÀN THÀNH / DỪNG TOÀN BỘ -> XÓA AUTO GHI NHỚ ĐỂ KHÔNG TỰ BẬT LẠI
                                if ("farm".equalsIgnoreCase(lastAutoTask.autoType)) {
                                    checkAndLogFarmHarvest();
                                }
                                persistentAutoHolder[0] = null;
                                System.out.println("✅ [AUTO HOÀN THÀNH]: " + lastAutoTask.friendlyName + " đã hoàn tất toàn bộ công việc!");
                                System.out.println("[AUTO_STATUS]: {\"isRunning\":false,\"status\":\"finished\",\"finished\":true,\"autoType\":\"" + lastAutoTask.autoType + "\",\"message\":\"Đã hoàn tất " + lastAutoTask.friendlyName + "!\"}");
                            } else if (lastAutoTask == null && curAutoTask != null) {
                                // 2. TẤT CẢ AUTO KHI BẮT ĐẦU CHẠY BAN ĐẦU
                                String autoIcon = "⚡";
                                String at = (curAutoTask.autoType != null) ? curAutoTask.autoType.toLowerCase() : "";
                                String fn = (curAutoTask.friendlyName != null) ? curAutoTask.friendlyName.toLowerCase() : "";
                                if (at.contains("farm") || fn.contains("farm") || fn.contains("nông")) {
                                    autoIcon = "🌾";
                                } else if (at.contains("fish") || at.contains("cau_ca") || at.contains("cc") || fn.contains("cá") || fn.contains("câu")) {
                                    autoIcon = "🎣";
                                } else if (at.contains("diamond") || at.contains("kc") || fn.contains("khoáng") || fn.contains("kim cương")) {
                                    autoIcon = "💎";
                                } else if (at.contains("sell_ore") || at.contains("banda") || at.contains("stone") || at.contains("bd") || fn.contains("bán đá") || fn.contains("đá")) {
                                    autoIcon = "🪨";
                                } else if (at.contains("baby") || fn.contains("em bé")) {
                                    autoIcon = "👶";
                                } else if (at.contains("event") || at.contains("sk") || fn.contains("sự kiện")) {
                                    autoIcon = "🎉";
                                }
                                System.out.println(autoIcon + " [BẮT ĐẦU CHẠY]: " + curAutoTask.friendlyName);
                                if ("farm".equalsIgnoreCase(curAutoTask.autoType)) {
                                    syncFarmBaselineSilently();
                                }
                                System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"" + curAutoTask.autoType + "\",\"parentAutoType\":" + (curAutoTask.parentAutoType != null ? "\"" + curAutoTask.parentAutoType + "\"" : "null") + ",\"subTask\":" + curAutoTask.isSubTask + ",\"message\":\"Đang chạy " + curAutoTask.friendlyName + "...\"}");
                            } else if (lastAutoTask != null && curAutoTask != null && (!lastAutoTask.className.equals(curAutoTask.className) || !lastAutoTask.autoType.equals(curAutoTask.autoType))) {
                                // 3. CHUYỂN ĐỔI GIỮA CÁC AUTO / SUB-TASK TRONG QUÁ TRÌNH CHẠY
                                // Chỉ kiểm tra thu hoạch Farm nếu vừa kết thúc Auto Farm
                                if ("farm".equalsIgnoreCase(lastAutoTask.autoType)) {
                                    checkAndLogFarmHarvest();
                                }
                                if ("farm".equalsIgnoreCase(curAutoTask.autoType)) {
                                    syncFarmBaselineSilently();
                                    System.out.println("🌾 [TẠM VỀ FARM]: Đang tạm chuyển sang " + curAutoTask.friendlyName + " (từ " + lastAutoTask.friendlyName + ")...");
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"farm\",\"parentAutoType\":\"" + lastAutoTask.autoType + "\",\"subTask\":true,\"message\":\"Đang về chăm farm (từ " + lastAutoTask.friendlyName + ")...\"}");
                                } else if ("sell_ore".equalsIgnoreCase(curAutoTask.autoType) || "banda".equalsIgnoreCase(curAutoTask.autoType)) {
                                    System.out.println("🪨 [TẠM VỀ BÁN ĐÁ]: Rương đầy, đang tạm chuyển sang " + curAutoTask.friendlyName + " (từ " + lastAutoTask.friendlyName + ")...");
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"sell_ore\",\"parentAutoType\":\"" + lastAutoTask.autoType + "\",\"subTask\":true,\"message\":\"Đang bán đá (từ " + lastAutoTask.friendlyName + ")...\"}");
                                } else if ("baby".equalsIgnoreCase(curAutoTask.autoType)) {
                                    System.out.println("👶 [TẠM VỀ CHĂM EM BÉ]: Đang tạm chuyển sang " + curAutoTask.friendlyName + " (từ " + lastAutoTask.friendlyName + ")...");
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"baby\",\"parentAutoType\":\"" + lastAutoTask.autoType + "\",\"subTask\":true,\"message\":\"Đang chăm em bé (từ " + lastAutoTask.friendlyName + ")...\"}");
                                } else if ("diamond".equalsIgnoreCase(curAutoTask.autoType)) {
                                    if ("farm".equalsIgnoreCase(lastAutoTask.autoType)) {
                                        System.out.println("💎 [HOÀN TẤT FARM]: Đã chăm sóc nông trại xong, tiếp tục " + curAutoTask.friendlyName + "!");
                                    } else if ("sell_ore".equalsIgnoreCase(lastAutoTask.autoType) || "banda".equalsIgnoreCase(lastAutoTask.autoType)) {
                                        System.out.println("💎 [HOÀN TẤT BÁN ĐÁ]: Đã bán đá xong, tiếp tục " + curAutoTask.friendlyName + "!");
                                    } else if ("baby".equalsIgnoreCase(lastAutoTask.autoType)) {
                                        System.out.println("💎 [HOÀN TẤT CHĂM EM BÉ]: Đã chăm em bé xong, tiếp tục " + curAutoTask.friendlyName + "!");
                                    } else {
                                        System.out.println("💎 [TIẾP TỤC]: Chuyển sang " + curAutoTask.friendlyName + "!");
                                    }
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"diamond\",\"parentAutoType\":null,\"subTask\":false,\"message\":\"Đang chạy " + curAutoTask.friendlyName + "...\"}");
                                } else if ("fish".equalsIgnoreCase(curAutoTask.autoType)) {
                                    if ("farm".equalsIgnoreCase(lastAutoTask.autoType)) {
                                        System.out.println("🎣 [HOÀN TẤT FARM]: Đã chăm sóc nông trại xong, tiếp tục " + curAutoTask.friendlyName + "!");
                                    } else if ("sell_ore".equalsIgnoreCase(lastAutoTask.autoType) || "banda".equalsIgnoreCase(lastAutoTask.autoType)) {
                                        System.out.println("🎣 [HOÀN TẤT BÁN ĐÁ]: Đã bán đá xong, tiếp tục " + curAutoTask.friendlyName + "!");
                                    } else {
                                        System.out.println("🎣 [TIẾP TỤC]: Chuyển sang " + curAutoTask.friendlyName + "!");
                                    }
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"fish\",\"parentAutoType\":null,\"subTask\":false,\"message\":\"Đang chạy " + curAutoTask.friendlyName + "...\"}");
                                } else {
                                    System.out.println("⚡ [CHUYỂN AUTO]: " + lastAutoTask.friendlyName + " -> " + curAutoTask.friendlyName);
                                    System.out.println("[AUTO_STATUS]: {\"isRunning\":true,\"status\":\"running\",\"autoType\":\"" + curAutoTask.autoType + "\",\"parentAutoType\":\"" + lastAutoTask.autoType + "\",\"subTask\":" + curAutoTask.isSubTask + ",\"message\":\"Đang chạy " + curAutoTask.friendlyName + "...\"}");
                                }
                            }
                            lastAutoTask = curAutoTask;
                        } catch (Throwable ignored) {}
                    }
                } catch (Exception e) {
                    System.err.println("[GIÁM SÁT LỖI]: " + e.getMessage());
                }
            }
        });
        supervisorThread.setDaemon(true);
        supervisorThread.start();

        // Khởi chạy MicroEmulator Headless
        org.microemu.app.Headless.main(args);
    }
}
