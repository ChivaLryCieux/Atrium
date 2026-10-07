import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { TerminalSession } from "../../components/TerminalPanel";

export function useTerminalState() {
  const { t } = useTranslation();
  const [terminals, setTerminals] = useState<TerminalSession[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);

  const handleNewTerminal = (cwd: string, onNavigateWorkspace?: () => void) => {
    const id = crypto.randomUUID();
    const seed: TerminalSession = {
      id,
      title: t("terminal.fallbackTitle"),
      cwd,
    };
    setTerminals((prev) => [...prev, seed]);
    setActiveTerminalId(id);
    setIsTerminalOpen(true);
    onNavigateWorkspace?.();
  };

  const handleTerminalCreated = (info: TerminalSession) => {
    setTerminals((prev) => prev.map((t) => (t.id === info.id ? info : t)));
  };

  const handleTerminalClosed = (id: string) => {
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTerminalId((cur) => {
        if (cur !== id) return cur;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      if (next.length === 0) setIsTerminalOpen(false);
      return next;
    });
  };

  const handleCloseOneTerminal = async (id: string) => {
    // Close backend first so its exit event stays idempotent
    try {
      await invoke("close_terminal", { id });
    } catch {
      /* backend already reaped */
    }
    handleTerminalClosed(id);
  };

  return {
    terminals,
    setTerminals,
    activeTerminalId,
    setActiveTerminalId,
    isTerminalOpen,
    setIsTerminalOpen,
    handleNewTerminal,
    handleTerminalCreated,
    handleTerminalClosed,
    handleCloseOneTerminal,
  };
}
