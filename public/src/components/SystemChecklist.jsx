/**
 * SystemChecklist Component (Presentation Layer)
 * Displays file existence checks and Java environment readiness.
 */
window.SystemChecklist = function SystemChecklist({ status }) {
  const isEmulatorOk = status?.files?.emulator;
  const isGameOk = status?.files?.game;
  const isJavaOk = status?.java?.available;
  const javaVersion = status?.java?.version || 'Đang quét...';

  return (
    <section className="info-card">
      <h3>Kiểm Tra Tệp Tin & Môi Trường</h3>
      <div className="checklist">
        <div className="check-item">
          <span className="check-status" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isEmulatorOk ? (
              <window.Icon name="check-circle" size={16} color="var(--apple-green)" />
            ) : (
              <window.Icon name="x-circle" size={16} color="var(--apple-red)" />
            )}
          </span>
          <span className="check-name">AngelChipEmulator_V2Proxy.jar</span>
          <span className="check-desc">Giả lập Java ME MicroEmulator Headless</span>
        </div>
        <div className="check-item">
          <span className="check-status" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isGameOk ? (
              <window.Icon name="check-circle" size={16} color="var(--apple-green)" />
            ) : (
              <window.Icon name="x-circle" size={16} color="var(--apple-red)" />
            )}
          </span>
          <span className="check-name">avatar_fish_build40.jar</span>
          <span className="check-desc">Game Avatar Auto Fish Build</span>
        </div>
        <div className="check-item">
          <span className="check-status" style={{ display: 'inline-flex', alignItems: 'center' }}>
            {isJavaOk ? (
              <window.Icon name="check-circle" size={16} color="var(--apple-green)" />
            ) : (
              <window.Icon name="x-circle" size={16} color="var(--apple-red)" />
            )}
          </span>
          <span className="check-name">Môi trường Java Runtime</span>
          <span className="check-desc">{javaVersion}</span>
        </div>
      </div>
    </section>
  );
};
