/**
 * Exact dedup for sequence-stamped kernel events.
 *
 * The bridge stamps every payload with a globally monotonic `seq` before it
 * fans out to the dual channels (WS broadcast + SSE→IPC relay), so both copies
 * of one logical event carry the same seq and distinct events never collide
 * within a bridge process lifetime. The window is a bounded FIFO: cross-channel
 * copies are emitted synchronously microseconds apart, so even a few hundred
 * entries cover any realistic arrival skew.
 *
 * Reset policy: callers reset the window when the bridge may have restarted
 * (WS reconnect), because seq is only monotonic within one bridge process.
 */
export class SequencedEventDedup {
  private seen = new Set<string>();
  private readonly cap: number;

  constructor(cap = 500) {
    this.cap = cap;
  }

  /** Returns true when this payload was already dispatched before. */
  isDuplicate(payload: unknown): boolean {
    if (!payload || typeof payload !== "object") return false;
    const seq = (payload as { seq?: unknown }).seq;
    if (typeof seq !== "number") return false;
    const key = `s${seq}`;
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    if (this.seen.size > this.cap) {
      const evictCount = Math.floor(this.cap / 5);
      const iter = this.seen.values();
      for (let i = 0; i < evictCount; i++) {
        const val = iter.next().value;
        if (val === undefined) break;
        this.seen.delete(val);
      }
    }
    return false;
  }

  reset(): void {
    this.seen.clear();
  }

  get size(): number {
    return this.seen.size;
  }
}
