import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { loadDraft, saveDraft } from "../utils/drafts";

/**
 * Per-session composer drafts: switching sessions swaps in that session's
 * stored text, edits persist debounced. The save effect re-arms on every
 * (draft, session) change so the transient render right after a switch
 * (old text, new key) never flushes a wrong value.
 */
export function useComposerDrafts(
  draft: string,
  activeSessionId: string | null,
  setDraft: Dispatch<SetStateAction<string>>,
) {
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setDraft(loadDraft(activeSessionId));
  }, [activeSessionId, setDraft]);

  useEffect(() => {
    if (draftTimerRef.current !== undefined) {
      clearTimeout(draftTimerRef.current);
    }
    draftTimerRef.current = setTimeout(() => {
      saveDraft(activeSessionId, draft);
    }, 300);
    return () => {
      if (draftTimerRef.current !== undefined) {
        clearTimeout(draftTimerRef.current);
      }
    };
  }, [draft, activeSessionId]);
}
