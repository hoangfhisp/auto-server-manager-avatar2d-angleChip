/**
 * AccountLogsModal Component (Presentation Layer / Modals)
 * Porsche & Apple Minimalist Liquid Glass Bot Logs Viewer
 * Completely strips away emulator technical Java stacktraces.
 * Uses standard ModalBase container matching all dashboard forms.
 */
window.AccountLogsModal = function AccountLogsModal({ account, onClose, isAdmin = undefined }) {
  const [logs, setLogs] = React.useState([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [filter, setFilter] = React.useState('all'); // 'all', 'event', 'auto', 'system'
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [showEmulatorLogs, setShowEmulatorLogs] = React.useState(false);
  const [eventState, setEventState] = React.useState(account.eventState || null);
  const logContainerRef = React.useRef(null);

  const currentUser = window.authService?.getCurrentUser ? window.authService.getCurrentUser() : null;
  const isActualAdmin = isAdmin !== undefined
    ? Boolean(isAdmin)
    : (currentUser && String(currentUser.role || '').toUpperCase() === 'ADMIN');

  const isEmulatorLog = (rawText) => {
    if (!rawText) return true;
    const text = String(rawText);
    if (/^\t|\s{2,}(at |org\.|com\.|javax?\.|sun\.|[a-zA-Z0-9_$]+\.[a-zA-Z0-9_$]+)/.test(text)) return true;
    if (/\(null:-1\)/i.test(text) || /:\s*-1\)/i.test(text)) return true;
    if (/Picked up JAVA_TOOL_OPTIONS/i.test(text)) return true;
    if (/org\.microemu|microemu/i.test(text)) return true;
    if (/headless arguments/i.test(text)) return true;
    if (/openJar|loadJar|loadClass/i.test(text)) return true;
    if (/at java\.|at javax\.|at com\.|at org\./i.test(text)) return true;
    if (/Exception in thread|java\.lang\./i.test(text)) return true;
    if (/RecordStoreImpl|Font:|Graphics|MIDlet|UnsatisfiedLinkError|\[B@|\[C@|DeviceDisplay/i.test(text)) return true;
    if (/\[TXR\]|TxRunner|\[CG\]|CoGiao|Bridge\.hidden|\[POP\]\s*hidden popup/i.test(text)) return true;
    if (/(\[.*?\]\s*)?(index|readMapItem|doGetHandler|addElement):\s*\d*/i.test(text)) return true;
    if (/^[=\-─_]{8,}/.test(text) || /(\[.*?\]\s*)[=\-─_]{8,}/.test(text)) return true;
    if (/AVATAR HEADLESS AUTO-LOGIN/i.test(text)) return true;
    if (/TÀI KHOẢN \(WEB\):|SERVER\s*\(WEB\):|MẬT KHẨU \(WEB\):/i.test(text)) return true;
    if (/\[PROXY SETUP\]|\[GIẢ LẬP ANGELCHIP\]|PROXY\s*\(NET\):/i.test(text)) return true;
    if (/\[CÀI ĐẶT AUTO/i.test(text)) return true;
    if (/DEBUG/i.test(text)) return true;
    return false;
  };

  const fetchLogs = React.useCallback(async () => {
    if (!account || !account.id) return;
    try {
      let res = null;
      if (window.accountService && window.accountService.getAccountLogs) {
        res = await window.accountService.getAccountLogs(account.id);
      } else if (window.ApiClient && window.ApiClient.getAccountLogs) {
        res = await window.ApiClient.getAccountLogs(account.id);
      }
      if (res && res.success) {
        setLogs(res.logs || []);
      }
    } catch (err) {
      console.error('Lỗi tải nhật ký bot:', err);
    } finally {
      setIsLoading(false);
    }
  }, [account]);

  // 1. Initial fetch from API once
  React.useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // 2. Realtime SSE listener for new live logs
  React.useEffect(() => {
    if (!account || !account.id) return;

    let es = null;
    try {
      es = new EventSource('/api/events');
      es.addEventListener('log', (e) => {
        try {
          const newLog = JSON.parse(e.data);
          if (!newLog) return;
          const matchesAccount = 
            (newLog.accountId && String(newLog.accountId) === String(account.id)) ||
            (account.username && (newLog.username === account.username || newLog.text?.includes(`[${account.username}]`)));
          
          if (matchesAccount) {
            setLogs(prev => {
              const last = prev[prev.length - 1];
              if (last && last.timestamp === newLog.timestamp && last.text === newLog.text) {
                return prev;
              }
              return [...prev.slice(-999), newLog];
            });
          }
        } catch (err) {}
      });

      es.addEventListener('bot-event-status', (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data && String(data.accountId) === String(account.id) && data.eventState) {
            setEventState(data.eventState);
          }
        } catch (err) {}
      });
    } catch (err) {
      console.warn('SSE EventSource failed to connect:', err);
    }

    return () => {
      if (es) es.close();
    };
  }, [account]);

  // 3. Auto scroll to bottom when enabled
  React.useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Close on ESC
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!account) return null;

  const formatNumber = (val) => {
    if (window.formatters && typeof window.formatters.formatNumber === 'function') {
      return window.formatters.formatNumber(val);
    }
    return String(val !== undefined && val !== null ? val : 0);
  };

  // Identify event logs and compute current event statistics separated for Farm and Fish
  const eventLogs = logs.filter(l => {
    const rawText = l.text || '';
    const text = rawText.toLowerCase();
    return l.type === 'event' || text.includes('sự kiện') || text.includes('🎁') || text.includes('vật phẩm');
  });

  const eventData = React.useMemo(() => {
    const result = {
      farm: { total: 0, max: 120, hasData: false },
      fish: { total: 0, max: 100, hasData: false }
    };

    if (eventState) {
      if (eventState.farm) {
        result.farm.total = Number(eventState.farm.total ?? eventState.farm.current) || 0;
        result.farm.max = Number(eventState.farm.max) || 120;
        if (result.farm.total > 0 || Object.keys(eventState.farm.items || {}).length > 0) {
          result.farm.hasData = true;
        }
      }
      if (eventState.fish) {
        result.fish.total = Number(eventState.fish.total ?? eventState.fish.current) || 0;
        result.fish.max = Number(eventState.fish.max) || 100;
        if (result.fish.total > 0 || Object.keys(eventState.fish.items || {}).length > 0) {
          result.fish.hasData = true;
        }
      }
      // Fallback cho eventState dạng phẳng cũ
      if (!result.farm.hasData && !result.fish.hasData && eventState.current !== undefined) {
        const src = eventState.source === 'fish' ? 'fish' : 'farm';
        result[src].total = Number(eventState.current) || 0;
        result[src].max = Number(eventState.max) || (src === 'fish' ? 100 : 120);
        if (result[src].total > 0) {
          result[src].hasData = true;
        }
      }
    }

    // Fallback: Quét ngược từ nhật ký nếu eventState chưa có dữ liệu trong RAM
    if (!result.farm.hasData && !result.fish.hasData && logs && logs.length > 0) {
      for (let i = logs.length - 1; i >= 0; i--) {
        const txt = logs[i].text || '';
        if (!txt.includes('🎁') && !txt.includes('SỰ KIỆN')) continue;

        const isFish = txt.includes('FISH') || txt.toLowerCase().includes('câu cá');
        const target = isFish ? result.fish : result.farm;

        if (!target.hasData) {
          const match = txt.match(/(?:Đã nhận|Nhận)(?:[^\(]*?)\((?:Hôm nay|Tổng):\s*(\d+)\/(\d+)\)/i);
          if (match) {
            target.total = parseInt(match[1], 10) || 0;
            const max = parseInt(match[2], 10);
            if (max > 0) target.max = max;
            target.hasData = true;
          }
        }
      }
    }

    return result;
  }, [logs, eventState]);

  const filteredLogs = logs.filter(l => {
    const rawText = l.text || '';
    const isEmu = isEmulatorLog(rawText);
    if (!showEmulatorLogs && isEmu) return false;

    if (filter === 'all') return true;
    const text = rawText.toLowerCase();
    if (filter === 'event') {
      return l.type === 'event' || text.includes('sự kiện') || text.includes('🎁') || text.includes('vật phẩm');
    }
    if (filter === 'auto') {
      return l.type === 'auto' || text.includes('auto') || text.includes('farm') || text.includes('câu cá') || text.includes('bán đá') || text.includes('kc');
    }
    if (filter === 'system') {
      return l.type === 'system' || text.includes('kết nối') || text.includes('đăng nhập') || text.includes('máy chủ') || text.includes('bắt đầu') || text.includes('dừng');
    }
    return true;
  });

  const getTagInfo = (text = '') => {
    if (isEmulatorLog(text)) {
      return { tag: 'GIẢ LẬP', className: 'account-logs-tag-bot', textClass: 'account-logs-text-default' };
    }
    const lower = text.toLowerCase();
    if (lower.includes('sự kiện') || lower.includes('[sự kiện') || lower.includes('🎁') || lower.includes('[event') || lower.includes('vật phẩm')) {
      return { tag: 'SỰ KIỆN', className: 'account-logs-tag-event', textClass: 'account-logs-text-event', isEvent: true };
    }
    if (lower.includes('bán đá') || lower.includes('đập đá') || lower.includes('quặng') || lower.includes('kim cương') || lower.includes('kc') || lower.includes('💎') || lower.includes('🪨')) {
      return { tag: 'ĐÁ/KC', className: 'account-logs-tag-ore', textClass: 'account-logs-text-ore' };
    }
    if (lower.includes('câu cá') || lower.includes('mua vé') || lower.includes('giật cần') || lower.includes('bán cá') || lower.includes('cá cắn') || lower.includes('🎣')) {
      return { tag: 'CÂU CÁ', className: 'account-logs-tag-fish', textClass: 'account-logs-text-fish' };
    }
    if (lower.includes('em bé') || lower.includes('chăm em bé') || lower.includes('chăm baby') || lower.includes('👶')) {
      return { tag: 'BABY', className: 'account-logs-tag-ore', textClass: 'account-logs-text-ore' };
    }
    if (lower.includes('auto farm') || lower.includes('chăm farm') || lower.includes('chăm sóc') || lower.includes('thu hoạch') || lower.includes('gieo hạt') || lower.includes('nông trại') || lower.includes('🌾')) {
      return { tag: 'FARM', className: 'account-logs-tag-farm', textClass: 'account-logs-text-farm' };
    }
    if (lower.includes('lỗi') || lower.includes('mất kết nối') || lower.includes('thất bại') || lower.includes('bị chặn') || lower.includes('❌') || lower.includes('⚠️')) {
      return { tag: 'LỖI', className: 'account-logs-tag-error', textClass: 'account-logs-text-error' };
    }
    if (lower.includes('kết nối') || lower.includes('đăng nhập') || lower.includes('máy chủ') || lower.includes('hoàn mỹ') || lower.includes('diệu kỳ') || lower.includes('mạng') || lower.includes('quy trình') || lower.includes('🚀')) {
      return { tag: 'KẾT NỐI', className: 'account-logs-tag-network', textClass: 'account-logs-text-network' };
    }
    return { tag: 'BOT', className: 'account-logs-tag-bot', textClass: 'account-logs-text-default' };
  };

  const parseLogEntry = (log) => {
    let rawText = String(log.text || '').trim();
    let username = log.username || account.username || '';
    let cleanText = rawText;

    const bracketMatch = cleanText.match(/^\[([a-zA-Z0-9_.-]{3,25})\]\s*(.*)$/);
    if (bracketMatch) {
      username = bracketMatch[1];
      cleanText = bracketMatch[2];
    } else {
      const prefixMatch = cleanText.match(/^([a-zA-Z0-9_.-]{3,20})(?=[\[💬🌾🎣💎🎁⏹🔄🚀✅❌⚠️\s])\s*(.*)$/);
      if (prefixMatch && (!username || prefixMatch[1] === username || !/[A-Z]{4,}/.test(prefixMatch[1]))) {
        username = prefixMatch[1];
        cleanText = prefixMatch[2];
      }
    }

    if (cleanText.startsWith('QUY TRÌNH->')) {
      cleanText = cleanText.replace(/^QUY TRÌNH->\s*/, '[QUY TRÌNH] ');
    }

    const tagInfo = getTagInfo(cleanText || rawText);

    return { username, text: cleanText, tagInfo };
  };

  const renderLogText = (rawText = '') => {
    if (!rawText) return '';
    const emojiRegex = /(🎁|🌾|👶|✅|💬|🔄|⏹️|⏹|🚀|❌|⚠️|🎣|💎|🪨)/g;
    const parts = rawText.split(emojiRegex);
    if (parts.length <= 1) return rawText;

    return (
      <span>
        {parts.map((part, i) => {
          if (part === '🎁') return <window.Icon key={i} name="gift" size={13} color="#e599ff" className="account-logs-inline-gift" />;
          if (part === '🌾') return <window.Icon key={i} name="wheat" size={13} color="var(--apple-green)" className="account-logs-inline-gift" />;
          if (part === '👶') return <window.Icon key={i} name="baby" size={13} color="var(--apple-orange)" className="account-logs-inline-gift" />;
          if (part === '✅') return <window.Icon key={i} name="checkCircle" size={13} color="var(--apple-green)" className="account-logs-inline-gift" />;
          if (part === '💬') return <window.Icon key={i} name="message" size={13} color="var(--apple-gold)" className="account-logs-inline-gift" />;
          if (part === '🔄') return <window.Icon key={i} name="refresh" size={13} color="var(--apple-orange)" className="account-logs-inline-gift" />;
          if (part === '⏹️' || part === '⏹') return <window.Icon key={i} name="stop" size={13} color="var(--apple-red)" className="account-logs-inline-gift" />;
          if (part === '🚀') return <window.Icon key={i} name="zap" size={13} color="var(--apple-blue)" className="account-logs-inline-gift" />;
          if (part === '❌') return <window.Icon key={i} name="xCircle" size={13} color="var(--apple-red)" className="account-logs-inline-gift" />;
          if (part === '⚠️') return <window.Icon key={i} name="alertTriangle" size={13} color="var(--apple-orange)" className="account-logs-inline-gift" />;
          if (part === '🎣') return <window.Icon key={i} name="fish" size={13} color="var(--apple-teal)" className="account-logs-inline-gift" />;
          if (part === '💎') return <window.Icon key={i} name="diamond" size={13} color="var(--apple-purple)" className="account-logs-inline-gift" />;
          if (part === '🪨') return <window.Icon key={i} name="rock" size={13} color="var(--apple-orange)" className="account-logs-inline-gift" />;
          return part;
        })}
      </span>
    );
  };

  return (
    <window.ModalBase
      title="Nhật Ký Hoạt Động Bot"
      subtitle={`Tài khoản: ${account.username}${account.serverName ? ` • Máy chủ ${account.serverName}` : ''}`}
      icon="terminal"
      iconColor="var(--apple-blue)"
      size="lg"
      onClose={onClose}
      footer={
        <div className="account-logs-modal-footer">
          <span className="account-logs-modal-footer-hint">
            Nhật ký tự động ưu tiên sự kiện bot & hệ thống. Log giả lập được tắt mặc định.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            Đóng
          </button>
        </div>
      }
    >
      {/* 1. Toolbar & Filter */}
      <div className="account-logs-toolbar">
        <div className="account-logs-filter-group">
          <button
            type="button"
            className={`account-logs-filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            <window.Icon name="list" size={13} />
            <span>Tất Cả ({filteredLogs.length})</span>
          </button>
          <button
            type="button"
            className={`account-logs-filter-btn account-logs-filter-btn-event ${filter === 'event' ? 'active' : ''}`}
            onClick={() => setFilter('event')}
          >
            <window.Icon name="gift" size={13} />
            <span>SỰ KIỆN</span>
            {eventLogs.length > 0 && (
              <span className={`account-logs-event-count-badge ${filter === 'event' ? 'account-logs-event-count-badge-active' : ''}`}>
                {eventLogs.length}
              </span>
            )}
          </button>
          <button
            type="button"
            className={`account-logs-filter-btn ${filter === 'auto' ? 'active' : ''}`}
            onClick={() => setFilter('auto')}
          >
            <window.Icon name="cpu" size={13} />
            <span>Hành Động Auto</span>
          </button>
          <button
            type="button"
            className={`account-logs-filter-btn ${filter === 'system' ? 'active' : ''}`}
            onClick={() => setFilter('system')}
          >
            <window.Icon name="wifi" size={13} />
            <span>Hệ Thống & Kết Nối</span>
          </button>
        </div>

        <div className="account-logs-options-group">
          {isActualAdmin && (
            <label className="account-logs-auto-refresh-label" title="Bật/Tắt hiển thị mã nguồn và stacktrace chi tiết của giả lập MicroEmulator">
              <input
                type="checkbox"
                checked={showEmulatorLogs}
                onChange={(e) => setShowEmulatorLogs(e.target.checked)}
              />
              <span>Log giả lập</span>
            </label>
          )}
          <label className="account-logs-auto-refresh-label" title="Tự động cuộn xuống dòng nhật ký mới nhất theo thời gian thực">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Tự động cuộn</span>
          </label>
        </div>
      </div>

      {/* 2. Event Progress Highlight Banner (Farm & Fish overall progress: current / max) */}
      {(eventData.farm.hasData || eventData.fish.hasData) && (
        <div className="account-logs-event-card">
          {/* Nông Trại Section */}
          {eventData.farm.hasData && (
            <div className="account-logs-event-section">
              <div className="account-logs-event-header">
                <div className="account-logs-event-title-group">
                  <span className="account-logs-event-icon-badge badge-farm">
                    <window.Icon name="sprout" size={15} color="var(--apple-green)" />
                  </span>
                  <div>
                    <span className="account-logs-event-title">Sự Kiện Nông Trại</span>
                    <span className="account-logs-event-subtitle">(Thu hoạch nông trại)</span>
                  </div>
                </div>
                <div className="account-logs-event-meta-badge badge-farm">
                  <span>Đã gom:</span>
                  <span>{formatNumber(eventData.farm.total)} / {formatNumber(eventData.farm.max)}</span>
                  <span>({Math.min(100, Math.round((eventData.farm.total / (eventData.farm.max || 120)) * 100))}%)</span>
                </div>
              </div>

              {/* Thanh tiến độ Nông Trại */}
              <div className="account-logs-progress-track">
                <div
                  className="account-logs-progress-fill fill-farm"
                  style={{ width: `${Math.min(100, Math.round((eventData.farm.total / (eventData.farm.max || 120)) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {/* Câu Cá Section */}
          {eventData.fish.hasData && (
            <div className="account-logs-event-section">
              <div className="account-logs-event-header">
                <div className="account-logs-event-title-group">
                  <span className="account-logs-event-icon-badge badge-fish">
                    <window.Icon name="fish" size={15} color="var(--apple-teal)" />
                  </span>
                  <div>
                    <span className="account-logs-event-title">Sự Kiện Câu Cá</span>
                    <span className="account-logs-event-subtitle">(Hồ câu)</span>
                  </div>
                </div>
                <div className="account-logs-event-meta-badge badge-fish">
                  <span>Đã câu:</span>
                  <span>{formatNumber(eventData.fish.total)} / {formatNumber(eventData.fish.max)}</span>
                  <span>({Math.min(100, Math.round((eventData.fish.total / (eventData.fish.max || 100)) * 100))}%)</span>
                </div>
              </div>

              {/* Thanh tiến độ Câu Cá */}
              <div className="account-logs-progress-track">
                <div
                  className="account-logs-progress-fill fill-fish"
                  style={{ width: `${Math.min(100, Math.round((eventData.fish.total / (eventData.fish.max || 100)) * 100))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Log Viewer Body */}
      <div
        ref={logContainerRef}
        className="account-logs-body"
      >
        {isLoading && logs.length === 0 ? (
          <div className="account-logs-loading">
            {window.CircularSpinner ? (
              <window.CircularSpinner size="md" text="Đang tải nhật ký bot..." />
            ) : (
              <div>
                <div className="account-logs-loading-spinner" />
                <span className="account-logs-subtitle">Đang tải nhật ký bot...</span>
              </div>
            )}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="account-logs-empty">
            <div className="account-logs-empty-icon-wrap">
              <window.Icon name="terminal" size={36} color="var(--apple-blue)" />
            </div>
            <div className="account-logs-empty-title">
              Chưa Có Sự Kiện Hoạt Động
            </div>
            <div className="account-logs-empty-subtitle">
              Khi bot chạy hoặc thực hiện auto, toàn bộ sự kiện gieo hạt, thu hoạch, câu cá, kết nối sẽ hiển thị ở đây.
            </div>
          </div>
        ) : (
          filteredLogs.map((log, idx) => {
            const { username, text, tagInfo } = parseLogEntry(log);

            return (
              <div key={idx} className="account-logs-row">
                <span className="account-logs-time">
                  {log.timestamp || '--:--:--'}
                </span>
                <span className={`account-logs-tag ${tagInfo.className}`}>
                  {tagInfo.tag}
                </span>
                {username && (
                  <span className="account-logs-user-badge">
                    [{username}]
                  </span>
                )}
                <span className={`account-logs-text ${tagInfo.textClass}`}>
                  {renderLogText(text)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </window.ModalBase>
  );
};
