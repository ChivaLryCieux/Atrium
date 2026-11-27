export const wsClients = new Set()

// Globally monotonic sequence stamped onto every emitted payload. Dual-channel
// events (WS broadcast + SSE relay) carry the SAME seq for one logical event,
// so the client can dedupe exactly instead of hashing content prefixes.
// Monotonicity is per bridge process; the client resets its dedup window when
// the WS reconnects (the only signal it has that the bridge may have restarted).
let eventSeq = 0

export function stampSeq(payload) {
  if (payload && typeof payload === 'object' && payload.seq === undefined) {
    payload.seq = ++eventSeq
  }
  return payload
}

export function broadcast(payload) {
  stampSeq(payload)
  const line = JSON.stringify(payload)
  for (const socket of wsClients) {
    if (socket.readyState === 1 /* open */) socket.send(line)
  }
}

export function broadcastStream(conversationId, stageId, content, extra = {}) {
  if (content === undefined || content === null) return
  broadcast({ type: 'assistant-stream', conversationId, stageId, content, ...extra })
}

export function broadcastTelemetry(conversationId, stageId, event) {
  broadcast({ type: 'telemetry', conversationId, stageId, event })
}
