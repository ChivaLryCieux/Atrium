import { describe, it, expect } from "vitest";
import { SequencedEventDedup } from "./eventDedup";

describe("SequencedEventDedup", () => {
  it("passes the first copy and drops the exact duplicate", () => {
    const d = new SequencedEventDedup();
    const evt = { type: "assistant-stream", seq: 1, content: "hello" };
    expect(d.isDuplicate(evt)).toBe(false);
    expect(d.isDuplicate({ ...evt })).toBe(true);
  });

  it("never collides distinct events within a process", () => {
    const d = new SequencedEventDedup();
    for (let seq = 1; seq <= 100; seq++) {
      expect(d.isDuplicate({ seq })).toBe(false);
    }
  });

  it("passes payloads without a seq (cannot dedup what is not stamped)", () => {
    const d = new SequencedEventDedup();
    expect(d.isDuplicate({ type: "kernel-status" })).toBe(false);
    expect(d.isDuplicate({ type: "kernel-status" })).toBe(false);
  });

  it("reset() reopens the window (bridge restart means seq restarts)", () => {
    const d = new SequencedEventDedup();
    expect(d.isDuplicate({ seq: 1 })).toBe(false);
    d.reset();
    expect(d.isDuplicate({ seq: 1 })).toBe(false);
  });

  it("evicts oldest entries beyond capacity but keeps recent ones", () => {
    const d = new SequencedEventDedup(100);
    for (let seq = 1; seq <= 100; seq++) d.isDuplicate({ seq });
    // Trigger eviction with a fresh event
    expect(d.isDuplicate({ seq: 101 })).toBe(false);
    // Recent events still dedup correctly
    expect(d.isDuplicate({ seq: 101 })).toBe(true);
    expect(d.isDuplicate({ seq: 95 })).toBe(true);
  });
});
