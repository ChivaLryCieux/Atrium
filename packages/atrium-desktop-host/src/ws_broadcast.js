export const wsClients = new Set()

export function broadcast(payload) {
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
