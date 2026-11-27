import { useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { dshClient } from "../services/dshClient";
import { applyKernelEvent, type MergeContext } from "../utils/streamMerge";
import type { ChatMessage } from "../types/chat";

export type KernelStreamRefs = {
  isSendingRef: MutableRefObject<boolean>;
  activeSessionIdRef: MutableRefObject<string | null>;
  tRef: MutableRefObject<(k: string) => string>;
};

type SetMessages = Dispatch<SetStateAction<ChatMessage[]>>;

/**
 * Live kernel fan-in — the ONLY merge path for streamed events.
 *
 * The merge reducers are pure (utils/streamMerge) and event delivery is
 * deduped exactly by sequence at the dshClient layer, so this listener set
 * stays active during sends as well: there is no per-send listener to
 * double-apply with, and no isSending mutual-exclusion gate that would
 * disable the WS backup channel precisely when it matters.
 *
 * High-frequency UI merge intentionally stays in the frontend; moving it
 * behind invoke/event round-trips would stall per-token updates.
 */
export function useKernelStreams(setMessages: SetMessages, refs: KernelStreamRefs) {
  useEffect(() => {
    const { activeSessionIdRef, tRef } = refs;

    const ctx = (): MergeContext => ({
      activeSessionId: activeSessionIdRef.current,
      thinkingText: tRef.current("app.thinking"),
      stageAnalyzingText: tRef.current("app.stageAnalyzing"),
    });

    const merge = (payload: any) => {
      setMessages((prev) => applyKernelEvent(prev, payload, ctx()));
    };

    const unlistenStream = dshClient.onStream(merge);
    const unlistenToolEvent = dshClient.onToolEvent(merge);
    const unlistenTokenUsage = dshClient.onTokenUsage(merge);
    const unlistenAgentStatus = dshClient.onAgentStatus(merge);

    return () => {
      unlistenStream();
      unlistenToolEvent();
      unlistenTokenUsage();
      unlistenAgentStatus();
    };
    // setMessages is React-stable; refs are stable containers mutated in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setMessages]);
}
