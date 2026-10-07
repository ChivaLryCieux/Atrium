import { broadcast, broadcastTelemetry } from './ws_broadcast.js'
import { routeKey } from './routes.js'
import {
  conversations,
  ensureHarness,
  bindConversation,
} from './harness_pool.js'

export function textOfContentBlocks(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

export function textOfToolResult(dataOrMessage) {
  if (!dataOrMessage) return ''
  if (typeof dataOrMessage === 'string') return dataOrMessage
  if (typeof dataOrMessage.result === 'string') return dataOrMessage.result
  if (typeof dataOrMessage.output === 'string') return dataOrMessage.output
  const message = dataOrMessage.message || dataOrMessage
  if (!message || !Array.isArray(message.content)) return ''
  const block = message.content[0]
  if (block?.type === 'tool-result' || block?.type === 'tool_result') {
    if (typeof block.content === 'string') return block.content
    if (Array.isArray(block.content)) {
      return block.content
        .filter((b) => typeof b?.text === 'string')
        .map((b) => b.text)
        .join('\n')
    }
  }
  return textOfContentBlocks(message)
}

export function handleNotification(route, notification, state, sseWrite) {
  const { conversationId, stageId } = route

  const _emit = (payload) => {
    broadcast(payload)
    if (sseWrite) sseWrite(payload)
  }
  const _emitStream = (cid, sid, content, extra = {}) => {
    if (content === undefined || content === null) return
    if (!extra.isReasoning) {
      state.emittedText = (state.emittedText || '') + content
    }
    _emit({ type: 'assistant-stream', conversationId: cid, stageId: sid, content, ...extra })
  }

  if (notification.method === 'session.event') {
    const event = notification.params?.event

    if (event?.type === 'turn/start') {
      _emit({
        type: 'agent-status',
        conversationId,
        stageId,
        status: 'thinking',
        detail: '正在进行深度推理与任务规划...',
        turn: event.data?.turn,
      })
      broadcastTelemetry(conversationId, stageId, { kind: 'turn-start', turn: event.data?.turn })
    } else if (event?.type === 'assistant/message' || event?.type === 'assistant/attempt') {
      const usage = event.data?.usage
      if (usage && typeof usage === 'object') {
        const prev = state.usage
        const nextInput = Math.max(prev?.inputTokens ?? 0, Number(usage.inputTokens ?? 0))
        const nextOutput = Math.max(prev?.outputTokens ?? 0, Number(usage.outputTokens ?? 0))
        state.usage = {
          inputTokens: nextInput,
          outputTokens: nextOutput,
          ...(usage.totalTokens === undefined && prev?.totalTokens === undefined
            ? {}
            : { totalTokens: Math.max(prev?.totalTokens ?? 0, Number(usage.totalTokens ?? 0)) }),
        }
        _emit({
          type: 'token-usage',
          conversationId,
          stageId,
          usage: state.usage,
        })
      }
      const stream = Array.isArray(event.data?.stream) ? event.data.stream : []
      let emitted = 0
      for (const record of stream) {
        if (!record) continue
        if (record.type === 'text-chunks' && Array.isArray(record.texts)) {
          for (const piece of record.texts) {
            if (piece) {
              _emitStream(conversationId, stageId, piece)
              emitted += piece.length
            }
          }
        } else if (record.type === 'reasoning-chunks' && Array.isArray(record.texts)) {
          for (const piece of record.texts) {
            if (piece) {
              _emitStream(conversationId, stageId, piece, { isReasoning: true })
              state.reasoningText = (state.reasoningText || '') + piece
            }
          }
        } else if (record.type === 'chunk') {
          const chunk = record.chunk
          if (chunk?.type === 'text-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
            _emitStream(conversationId, stageId, chunk.text)
            emitted += chunk.text.length
          } else if (chunk?.type === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text.length > 0) {
            _emitStream(conversationId, stageId, chunk.text, { isReasoning: true })
            state.reasoningText = (state.reasoningText || '') + chunk.text
          }
        }
      }
      if (emitted === 0) {
        const text = textOfContentBlocks(event.data?.message)
        if (text) _emitStream(conversationId, stageId, text)
      }
      _emit({
        type: 'agent-status',
        conversationId,
        stageId,
        status: 'generating',
        detail: '正在整合生成最终回复...',
      })
      broadcastTelemetry(conversationId, stageId, { kind: 'assistant-message', turn: event.data?.turn, step: event.data?.step })
    } else if (event?.type === 'tool/call') {
      const callId = String(event.data?.callId ?? `call-${Date.now()}`)
      const name = String(event.data?.name ?? 'unknown')
      const args = typeof event.data?.arguments === 'string'
        ? event.data.arguments
        : JSON.stringify(event.data?.arguments ?? {})
      const item = {
        id: callId,
        name,
        arguments: args,
        turn: event.data?.turn,
        step: event.data?.step,
        status: 'running',
        timestamp: Date.now(),
      }
      if (Array.isArray(state.toolCalls)) {
        state.toolCalls.push(item)
      }
      _emit({
        type: 'tool-event',
        conversationId,
        stageId,
        event: { kind: 'call', item },
      })
      _emit({
        type: 'agent-status',
        conversationId,
        stageId,
        status: 'calling_tool',
        tool: name,
        detail: `正在执行工具: ${name}...`,
        callId,
      })
      broadcastTelemetry(conversationId, stageId, { kind: 'tool-call', tool: name, callId })
    } else if (event?.type === 'tool/result') {
      const callId = String(
        event.data?.callId ||
        event.data?.message?.source?.callId ||
        event.data?.message?.content?.[0]?.toolCallId ||
        ''
      )
      const output = textOfToolResult(event.data) || textOfToolResult(event.data?.message)
      const isError = Boolean(event.data?.message?.content?.[0]?.isError || event.data?.error || event.data?.isError)
      const errorDetail = event.data?.error ? `${event.data.error.name}: ${event.data.error.reason || event.data.error.code}` : undefined
      const status = isError ? 'error' : 'completed'

      let resolvedCallId = callId
      if (Array.isArray(state.toolCalls)) {
        const existing = callId
          ? state.toolCalls.find((c) => c.id === callId)
          : [...state.toolCalls].reverse().find((c) => c.status === 'running')
        if (existing) {
          resolvedCallId = existing.id
          existing.result = output
          existing.isError = isError
          existing.error = errorDetail
          existing.status = status
        }
      }
      _emit({
        type: 'tool-event',
        conversationId,
        stageId,
        event: {
          kind: 'result',
          callId: resolvedCallId,
          turn: event.data?.turn,
          step: event.data?.step,
          result: output,
          isError,
          error: errorDetail,
          status,
        },
      })
      _emit({
        type: 'agent-status',
        conversationId,
        stageId,
        status: 'tool_finished',
        tool: resolvedCallId,
        detail: '工具执行完成，正在分析并继续推进...',
        callId: resolvedCallId,
        isError,
      })
      broadcastTelemetry(conversationId, stageId, { kind: 'tool-result', turn: event.data?.turn, callId: resolvedCallId, isError })
    } else if (event?.type === 'turn/end') {
      const reason = event.data?.reason
      if (reason && typeof reason === 'object' && reason.kind === 'error') {
        const errorMsg = reason.error?.message || reason.message || '模型执行异常中断'
        state.lastError = errorMsg
        _emit({
          type: 'agent-status',
          conversationId,
          stageId,
          status: 'error',
          detail: `执行失败: ${errorMsg}`,
        })
      } else {
        _emit({
          type: 'agent-status',
          conversationId,
          stageId,
          status: 'turn_ended',
          detail: '轮次执行完毕',
        })
      }
      if (Array.isArray(state.toolCalls)) {
        for (const tc of state.toolCalls) {
          if (tc.status === 'running') {
            tc.status = state.lastError ? 'error' : 'completed'
            tc.isError = Boolean(state.lastError)
            tc.error = tc.error || state.lastError
            tc.result = tc.result || (state.lastError ? '轮次中断未完成' : '执行完成')
            _emit({
              type: 'tool-event',
              conversationId,
              stageId,
              event: {
                kind: 'result',
                callId: tc.id,
                result: tc.result,
                isError: tc.isError,
                error: tc.error,
                status: tc.status,
              },
            })
          }
        }
      }
    } else if (event?.type === 'user/message') {
      broadcastTelemetry(conversationId, stageId, { kind: 'user-message' })
    }
  } else if (notification.method === 'session.status') {
    broadcastTelemetry(conversationId, stageId, { kind: 'session-status', status: notification.params?.status })
  }
}

export const activeTurns = new Map()

export function abortTurn(conversationId) {
  const targetId = String(conversationId ?? 'default')
  const active = activeTurns.get(targetId)
  if (active) {
    active.abort()
    activeTurns.delete(targetId)
    return true
  }
  broadcast({
    type: 'agent-status',
    conversationId: targetId,
    status: 'paused',
    detail: '操作员已暂停任务',
  })
  return false
}

export function runTurn(request, sseWrite) {
  const conversationId = String(request.conversationId ?? 'default')
  const stageId = request.stageId ?? null
  const prompt = String(request.prompt ?? '').trim()
  if (!prompt) return Promise.reject(new Error('turn prompt is empty'))

  const route = routeKey(request)
  const record = conversations.get(conversationId) ?? { dshSessionId: undefined, routeKey: route, chain: Promise.resolve() }
  if (record.routeKey !== route) {
    record.dshSessionId = undefined
    record.routeKey = route
  }
  conversations.set(conversationId, record)

  const execution = record.chain.then(async () => {
    const entry = await ensureHarness(request)
    entry.activeTurns += 1
    const rKey = routeKey(request)
    const turnRoute = { conversationId, stageId }
    const state = { usage: null, toolCalls: [], reasoningText: '', emittedText: '', aborted: false }

    const handle = {
      entry,
      state,
      abort: () => {
        state.aborted = true
        broadcast({
          type: 'agent-status',
          conversationId,
          stageId,
          status: 'paused',
          detail: '操作员已暂停任务',
        })
        broadcastTelemetry(conversationId, stageId, { kind: 'turn-aborted' })
        try {
          const child = entry.harness?.clientInstance?.child
          if (child && child.exitCode === null && child.signalCode === null) {
            child.kill('SIGTERM')
          }
        } catch (e) {
          console.warn('[ATRIUM_BRIDGE] Failed to kill child on abort:', e)
        }
        harnessPool.delete(rKey)
      },
    }
    activeTurns.set(conversationId, handle)

    try {
      broadcastTelemetry(conversationId, stageId, { kind: 'turn-start', model: request.model })

      let result
      try {
        result = await entry.harness.run(prompt, {
          ...(record.dshSessionId ? { sessionId: record.dshSessionId } : {}),
          onNotification: (notification) => handleNotification(turnRoute, notification, state, sseWrite),
        })
      } catch (runError) {
        if (state.aborted) {
          result = {
            sessionId: record.dshSessionId ?? 'aborted-session',
            finalResponse: state.emittedText
              ? `${state.emittedText}\n\n*(操作员已暂停)*`
              : '*(操作员已暂停)*',
            aborted: true,
          }
        } else if (state.emittedText && state.emittedText.trim().length > 0) {
          console.warn(`[ATRIUM_BRIDGE] Turn execution failed with error: ${runError?.message ?? runError}. Recovering emitted text (${state.emittedText.length} chars).`)
          result = {
            sessionId: record.dshSessionId ?? 'recovered-session',
            finalResponse: state.emittedText,
          }
        } else {
          throw runError
        }
      }

      if (state.flushStreamBuffer) state.flushStreamBuffer()
      bindConversation(conversationId, result.sessionId)
      broadcastTelemetry(conversationId, stageId, { kind: 'turn-complete', sessionId: result.sessionId })

      if (Array.isArray(state.toolCalls)) {
        for (const tc of state.toolCalls) {
          if (tc.status === 'running') {
            tc.status = state.aborted ? 'error' : 'completed'
            tc.result = tc.result || (state.aborted ? '操作员已暂停任务' : '执行完成')
            broadcast({
              type: 'tool-event',
              conversationId,
              stageId,
              event: {
                kind: 'result',
                callId: tc.id,
                result: tc.result,
                isError: state.aborted,
                status: tc.status,
              },
            })
          }
        }
      }

      const finalResponse = result.finalResponse || state.emittedText || (state.aborted ? '*(操作员已暂停)*' : '')
      const hasContent = Boolean(finalResponse.trim())
      const hasReasoning = Boolean(state.reasoningText && state.reasoningText.trim())
      const hasToolCalls = Boolean(Array.isArray(state.toolCalls) && state.toolCalls.length > 0)

      if (!hasContent && !hasReasoning && !hasToolCalls && !state.aborted) {
        const errMessage = state.lastError || '模型未返回有效回复内容（请检查端点配置、API Key 与网络连通性）'
        throw new Error(errMessage)
      }

      return {
        sessionId: result.sessionId,
        finalResponse: finalResponse,
        reasoningContent: state.reasoningText || undefined,
        ...(state.usage ? { usage: state.usage } : {}),
        toolCalls: state.toolCalls,
        kernelRoute: routeKey(request),
        aborted: state.aborted,
      }
    } finally {
      activeTurns.delete(conversationId)
      entry.activeTurns -= 1
    }
  })

  record.chain = execution.catch(() => undefined)
  return execution
}
