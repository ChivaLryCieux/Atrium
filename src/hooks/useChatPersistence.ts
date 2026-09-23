import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ChatMessage, SessionSummary } from "../types/chat";

/**
 * Debounced persistence: per-session messages + legacy global history.
 * No cleanup on unmount — the pending timeout is overwritten, never leaked,
 * matching the original App behavior exactly.
 */
export function useChatPersistence(
  settings: AppSettings | null,
  messages: ChatMessage[],
  activeSessionId: string | null,
  setSessions: Dispatch<SetStateAction<SessionSummary[]>>,
) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!settings || messages.length === 0) return;
    if (saveTimeoutRef.current !== undefined) {
      clearTimeout(saveTimeoutRef.current);
    }
    const timeoutId = setTimeout(() => {
      if (activeSessionId) {
        invoke("save_session_messages", {
          sessionId: activeSessionId,
          messages,
        })
          .then(() => {
            invoke<SessionSummary[]>("list_sessions")
              .then(setSessions)
              .catch(console.error);
          })
          .catch(console.error);
      }
      invoke("save_history", { messages }).catch(console.error);
    }, 500);
    saveTimeoutRef.current = timeoutId;
  }, [messages, activeSessionId, settings, setSessions]);
}
