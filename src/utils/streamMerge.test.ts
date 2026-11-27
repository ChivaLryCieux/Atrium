import { describe, it, expect } from "vitest";
import {
  applyKernelEvent,
  mergeStreamChunk,
  mergeToolEvent,
  mergeTokenUsageEvent,
  targetsActiveSession,
  type MergeContext,
} from "./streamMerge";
import type { ChatMessage } from "../types/chat";

const ctx: MergeContext = {
  activeSessionId: "sess-1",
  thinkingText: "思考中",
  stageAnalyzingText: "正在分析",
};

function pendingMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "profile-1-single",
    role: "assistant",
    content: "思考中",
    speakerName: "Atrium",
    avatar: "ATRIUM",
    pending: true,
    ...overrides,
  };
}

describe("targetsActiveSession", () => {
  it("accepts exact session and parallel sub-conversations", () => {
    expect(targetsActiveSession({ conversationId: "sess-1" }, "sess-1")).toBe(true);
    expect(targetsActiveSession({ conversationId: "sess-1::parallel-2" }, "sess-1")).toBe(true);
  });
  it("rejects other sessions", () => {
    expect(targetsActiveSession({ conversationId: "sess-2" }, "sess-1")).toBe(false);
  });
  it("passes everything when no session is active or event carries no conversation", () => {
    expect(targetsActiveSession({ conversationId: "sess-2" }, null)).toBe(true);
    expect(targetsActiveSession({}, "sess-1")).toBe(true);
  });
});

describe("mergeStreamChunk", () => {
  it("replaces the placeholder with the first chunk and appends later chunks", () => {
    const start = [pendingMsg()];
    const after1 = mergeStreamChunk(start, { stageId: "profile-1-single", content: "你好" }, ctx);
    expect(after1[0].content).toBe("你好");
    const after2 = mergeStreamChunk(after1, { stageId: "profile-1-single", content: "世界" }, ctx);
    expect(after2[0].content).toBe("你好世界");
  });

  it("is idempotent under exact reapplication only when content differs — duplicates are filtered upstream by seq", () => {
    const start = [pendingMsg()];
    const once = mergeStreamChunk(start, { stageId: "profile-1-single", content: "abc" }, ctx);
    // Applying the SAME chunk again appends again — which is exactly why the
    // seq dedup at the dshClient layer must be exact. This test pins the
    // contract that merging itself is NOT responsible for dedup.
    const twice = mergeStreamChunk(once, { stageId: "profile-1-single", content: "abc" }, ctx);
    expect(twice[0].content).toBe("abcabc");
  });

  it("accumulates reasoning content separately", () => {
    const start = [pendingMsg()];
    const next = mergeStreamChunk(
      start,
      { stageId: "profile-1-single", content: "think", isReasoning: true },
      ctx,
    );
    expect(next[0].reasoningContent).toBe("think");
    expect(next[0].content).toBe("思考中");
  });

  it("ignores events for unknown stages and returns the original array reference", () => {
    const start = [pendingMsg()];
    const next = mergeStreamChunk(start, { stageId: "no-such-stage", content: "x" }, ctx);
    expect(next).toBe(start);
  });

  it("never writes into settled (non-pending) messages", () => {
    const settled = [pendingMsg({ pending: false, content: "done" })];
    const next = mergeStreamChunk(settled, { stageId: "profile-1-single", content: "x" }, ctx);
    expect(next[0].content).toBe("done");
  });
});

describe("mergeToolEvent", () => {
  it("upserts calls and resolves results by callId", () => {
    const start = [pendingMsg()];
    const withCall = mergeToolEvent(start, {
      stageId: "profile-1-single",
      event: { kind: "call", item: { id: "c1", name: "read_file", arguments: "{}", status: "running" } },
    });
    expect(withCall[0].toolCalls).toHaveLength(1);
    expect(withCall[0].toolCalls![0].status).toBe("running");

    const withResult = mergeToolEvent(withCall, {
      stageId: "profile-1-single",
      event: { kind: "result", callId: "c1", result: "ok", status: "completed" },
    });
    expect(withResult[0].toolCalls).toHaveLength(1);
    expect(withResult[0].toolCalls![0].result).toBe("ok");
    expect(withResult[0].toolCalls![0].status).toBe("completed");
  });

  it("synthesizes a placeholder record when a result arrives without a call", () => {
    const start = [pendingMsg()];
    const next = mergeToolEvent(start, {
      stageId: "profile-1-single",
      event: { kind: "result", callId: "orphan", result: "x", status: "completed" },
    });
    expect(next[0].toolCalls).toHaveLength(1);
    expect(next[0].toolCalls![0].id).toBe("orphan");
  });
});

describe("mergeTokenUsageEvent", () => {
  it("keeps the high-water mark when smaller usage arrives later", () => {
    const start = [pendingMsg()];
    const big = mergeTokenUsageEvent(start, {
      stageId: "profile-1-single",
      usage: { inputTokens: 100, outputTokens: 50 },
    });
    const small = mergeTokenUsageEvent(big, {
      stageId: "profile-1-single",
      usage: { inputTokens: 30, outputTokens: 10 },
    });
    expect(small[0].promptTokens).toBe(100);
    expect(small[0].completionTokens).toBe(50);
  });
});

describe("applyKernelEvent", () => {
  it("drops events for other sessions before any merging", () => {
    const start = [pendingMsg()];
    const next = applyKernelEvent(
      start,
      { type: "assistant-stream", conversationId: "sess-2", stageId: "profile-1-single", content: "x" },
      ctx,
    );
    expect(next).toBe(start);
  });

  it("routes parallel sub-conversation events into the session", () => {
    const start = [pendingMsg()];
    const next = applyKernelEvent(
      start,
      { type: "assistant-stream", conversationId: "sess-1::parallel-0", stageId: "profile-1-single", content: "x" },
      ctx,
    );
    expect(next[0].content).toBe("x");
  });

  it("passes unknown event types through as no-ops", () => {
    const start = [pendingMsg()];
    expect(applyKernelEvent(start, { type: "kernel-status" }, ctx)).toBe(start);
  });
});
