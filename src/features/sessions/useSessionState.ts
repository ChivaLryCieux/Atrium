import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ChatMessage, SessionSummary } from "../../types/chat";
import { ensureUniqueMessageIds } from "../../utils/messages";
import { generateSessionTitle } from "../../hooks/useSendMessage";

export function useSessionState(
  activeProjectId: string | null,
  setActiveProjectId: (id: string | null) => void,
) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Start New Task (inside the given project)
  const handleNewTask = async (projectId?: string) => {
    const targetProjectId = projectId || activeProjectId;
    if (targetProjectId) setActiveProjectId(targetProjectId);
    try {
      const title = await generateSessionTitle(targetProjectId ?? null, t);
      const created = await invoke<SessionSummary>("create_session", {
        title,
        projectId: targetProjectId,
      });
      setActiveSessionId(created.id);
      setMessages([]);
      setSessions((prev) => [created, ...prev.filter((s) => s.id !== created.id)]);
    } catch (err) {
      console.error(t("app.createSessionFailed"), err);
    }
  };

  // Rename Session
  const handleRenameSession = async (sessionId: string, newTitle: string) => {
    try {
      await invoke("rename_session", { sessionId, newTitle });
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
    } catch (err) {
      console.error("Failed to rename session:", err);
    }
  };

  // Select Existing Session
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId) return;
    try {
      const msgs = await invoke<ChatMessage[]>("load_session_messages", { sessionId });
      setActiveSessionId(sessionId);
      setMessages(ensureUniqueMessageIds(msgs || []));
    } catch (err) {
      console.error(t("app.loadSessionFailed"), err);
    }
  };

  // Delete Session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await invoke("delete_session", { sessionId });
      const updated = sessions.filter((s) => s.id !== sessionId);
      setSessions(updated);
      if (activeSessionId === sessionId) {
        if (updated.length > 0) {
          handleSelectSession(updated[0].id);
        } else {
          setActiveSessionId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error(t("app.deleteSessionFailed"), err);
    }
  };

  // Clear History
  const handleClearHistory = async () => {
    setMessages([]);
    setActiveSessionId(null);
    setSessions([]);
    try {
      await invoke("clear_history");
    } catch (err) {
      console.error("Failed to clear history:", err);
    }
  };

  return {
    messages,
    setMessages,
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    handleNewTask,
    handleRenameSession,
    handleSelectSession,
    handleDeleteSession,
    handleClearHistory,
  };
}
