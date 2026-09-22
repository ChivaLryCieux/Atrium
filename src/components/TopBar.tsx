import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

type TopBarProps = {
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
  onNewTerminal?: () => void;
  onOpenAbout?: () => void;
  projectName?: string;
};

export function TopBar({
  sidebarCollapsed,
  onToggleSidebar,
  onNewTerminal,
  onOpenAbout,
  projectName,
}: TopBarProps) {
  const { t } = useTranslation();
  const handleMinimize = async () => {
    try {
      await invoke("minimize_window");
    } catch {
      console.log("Window minimize (fallback browser mode)");
    }
  };

  const handleToggleMaximize = async () => {
    try {
      await invoke("toggle_maximize_window");
    } catch {
      console.log("Window maximize (fallback browser mode)");
    }
  };

  const handleClose = async () => {
    try {
      await invoke("close_window");
    } catch {
      console.log("Window close (fallback browser mode)");
    }
  };

  return (
    <header className="top-bar" data-tauri-drag-region>
      {/* Left: Sidebar Toggle, App Logo, Project Name */}
      <div className="top-bar-left">
        <div className="app-logo-badge" title="Atrium">
          <img src="/logo.png" alt="Atrium" className="app-logo-icon" />
        </div>

        <button
          type="button"
          className="icon-btn sidebar-toggle-btn"
          title={sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          onClick={onToggleSidebar}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>

        {/* Project Name Indicator */}
        <div className="top-bar-project-title" data-tauri-drag-region>
          <span className="brand-prefix">Atrium 智役中庭：</span>
          <span className="project-name-text">{projectName || "初始空间"}</span>
        </div>
      </div>

      {/* Center Draggable Spacer */}
      <div className="top-bar-center" data-tauri-drag-region />

      {/* Right: Help, New Terminal, Window Controls */}
      <div className="top-bar-right">
        {/* About / Charter icon [?] */}
        <button
          type="button"
          className="icon-btn"
          title={t("topbar.about")}
          onClick={onOpenAbout}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" strokeLinecap="round" />
          </svg>
        </button>

        {/* New Terminal icon [>_] */}
        <button
          type="button"
          className="icon-btn"
          title={t("topbar.newTerminal")}
          onClick={onNewTerminal}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M7 9l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="13" y1="15" x2="17" y2="15" strokeLinecap="round" />
          </svg>
        </button>

        {/* Windows Frame Controls: Minimize, Maximize, Close */}
        <div className="window-controls">
          <button
            type="button"
            className="win-btn minimize"
            title={t("topbar.minimize")}
            onClick={handleMinimize}
          >
            <svg width="11" height="11" viewBox="0 0 12 12">
              <rect fill="currentColor" width="10" height="1.2" x="1" y="5.5" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn maximize"
            title={t("topbar.maximizeRestore")}
            onClick={handleToggleMaximize}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
              <rect x="1.5" y="1.5" width="9" height="9" />
            </svg>
          </button>
          <button
            type="button"
            className="win-btn close"
            title={t("topbar.close")}
            onClick={handleClose}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
              <line x1="1.5" y1="1.5" x2="10.5" y2="10.5" />
              <line x1="10.5" y1="1.5" x2="1.5" y2="10.5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
