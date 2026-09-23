import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, ChatMessage, SessionSummary } from "../types/chat";

/**
 * Debounced persistence: per-session messages + legacy global history.
 * No cleanup on unmount — the pending timeout is overwritten, never leaked,
 * matching the original App behavior exactly.
 *
 * `save_session_messages` already refreshes the index row (message_count /
 * updated_at) inside the kernel, so the local list is patched in place
 * instead of paying a follow-up `list_sessions` round-trip per autosave.
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
        const sessionId = activeSessionId;
        invoke("save_session_messages", { sessionId, messages })
          .then(() => {
            setSessions((prev) =>
              prev.map((s) =>
                s.id === sessionId
                  ? {
                      ...s,
                      messageCount: messages.length,
                      updatedAt: Math.floor(Date.now() / 1000),
                    }
                  : s
              )
            );
          })
          .catch(console.error);
      }
      invoke("save_history", { messages }).catch(console.error);
    }, 500);
    saveTimeoutRef.current = timeoutId;
  }, [messages, activeSessionId, settings, setSessions]);
}
