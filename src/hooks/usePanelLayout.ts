import { useCallback, useState } from "react";

function usePersistedWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
  maxRatio: number,
  vertical: boolean,
) {
  const [value, setValue] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(key);
      const parsed = saved ? parseInt(saved, 10) : fallback;
      return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
    } catch {
      return fallback;
    }
  });

  const resize = useCallback(
    (delta: number) => {
      setValue((prev) => {
        const span = vertical ? window.innerWidth : window.innerHeight;
        const maxW = Math.max(min, Math.round(span * maxRatio));
        const next = Math.max(min, Math.min(maxW, prev + delta));
        try {
          localStorage.setItem(key, next.toString());
        } catch {
          /* storage unavailable — keep in-memory size */
        }
        return next;
      });
    },
    [key, min, maxRatio, vertical],
  );

  const reset = useCallback(() => {
    setValue(fallback);
    try {
      localStorage.setItem(key, fallback.toString());
    } catch {
      /* ignore */
    }
  }, [fallback, key]);

  return { value, resize, reset, setValue };
}

/**
 * Sidebar / git-panel / terminal sizing with localStorage persistence.
 * Pure view state — intentionally stays in the frontend.
 */
export function usePanelLayout() {
  const sidebar = usePersistedWidth("atrium_sidebar_width", 250, 180, 550, 0.45, true);
  const gitPanel = usePersistedWidth("atrium_git_panel_width", 280, 200, 550, 0.45, true);
  const terminal = usePersistedWidth("atrium_terminal_height", 260, 140, 600, 0.7, false);

  return {
    sidebarWidth: sidebar.value,
    handleResizeSidebar: sidebar.resize,
    handleResetSidebar: sidebar.reset,
    gitPanelWidth: gitPanel.value,
    handleResizeGitPanel: gitPanel.resize,
    handleResetGitPanel: gitPanel.reset,
    terminalHeight: terminal.value,
    handleResizeTerminal: terminal.resize,
    handleResetTerminal: terminal.reset,
  };
}
