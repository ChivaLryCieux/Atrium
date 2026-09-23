#!/usr/bin/env node
/**
 * Atrium 智役中庭 — Desktop Kernel Bridge
 *
 * Drives the real DeepSeek Harness (dsh) runtime through the official
 * `@deepseek-ai/dsh-sdk-client` and exposes it to the Tauri shell as:
 *
 *   GET  /healthz          liveness + kernel availability
 *   GET  /api/harness/info kernel identity
 *   POST /v1/turn          one orchestrated agent turn (prompt in, final text out)
 *   POST /v1/reset         drop conversation → kernel session bindings
 *   WS   /events           live assistant deltas + kernel telemetry
 *
 * The dsh runtime is spawned as a child process; this bridge holds one runtime
 * per (provider, model, reasoning effort, credential) route and one kernel
 * session per Atrium conversation, so multi-turn context is owned by the
 * kernel itself. Two payloads are supported, in preference order:
 *
 *   1. `--kernel-exe` — the packaged single-file dsh runtime (one ~250 MB exe
 *      with Node 24 and the whole closure embedded), driven through the SDK's
 *      runtime-descriptor seam. This is what ships in installers.
 *   2. a vendored `deepseek-harness` checkout run as `dsh --profile sdk`
 *      (development and source builds).
 */

import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

// ── CLI arguments ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = { port: 19387, host: '127.0.0.1', dshRoot: null, kernelExe: null, appVersion: null, patch: [], workspace: null, dshHome: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--port') args.port = Number(argv[++i])
    else if (a === '--host') args.host = argv[++i]
    else if (a === '--dsh-root') args.dshRoot = resolve(argv[++i])
    else if (a === '--kernel-exe') args.kernelExe = resolve(argv[++i])
    else if (a === '--app-version') args.appVersion = String(argv[++i])
    else if (a === '--patch') args.patch.push(resolve(argv[++i]))
    else if (a === '--workspace') args.workspace = resolve(argv[++i])
    else if (a === '--dsh-home') args.dshHome = resolve(argv[++i])
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
// The shell owns the product version and passes it in, so /healthz reports the
// build's real version instead of a fourth copy that drifts on every release.
const APP_VERSION = args.appVersion ?? 'dev'

const KERNEL_EXE = args.kernelExe
const DSH_ROOT = args.dshRoot ?? resolve(process.cwd(), 'deepseek-harness')
const DSH_BIN = join(DSH_ROOT, 'apps', 'cli', 'lib', 'bin.js')
// The SDK client is bundled next to the bridge at staging time, so a packaged
// app needs no kernel source tree at runtime; development uses the checkout.
const SDK_CLIENT_BUNDLED = join(
  // This module runs in two shapes: ESM source (development) and the esbuild
  // CJS bundle (packaged), where `import.meta` does not exist.
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url)),
  'sdk-client.mjs',
)
const SDK_CLIENT_CHECKOUT = join(DSH_ROOT, 'packages', 'sdk', 'client', 'lib', 'index.js')
const WORKSPACE = args.workspace ?? process.cwd()

// ── Kernel availability ────────────────────────────────────────

let kernelStatus = 'starting'
let kernelDetail = 'resolving DeepSeek Harness runtime'
let kernelMode = KERNEL_EXE ? 'exe' : 'checkout'
let DeepSeekHarness = null
let HarnessClient = null

async function loadSdkClient() {
  const entry = existsSync(SDK_CLIENT_BUNDLED) ? SDK_CLIENT_BUNDLED : SDK_CLIENT_CHECKOUT
  if (!existsSync(entry)) return false
  const mod = await import(pathToFileURL(entry).href)
  DeepSeekHarness = mod.DeepSeekHarness
  HarnessClient = mod.HarnessClient
  return typeof DeepSeekHarness === 'function' && typeof HarnessClient === 'function'
}

async function loadKernel() {
  if (KERNEL_EXE) {
    if (!existsSync(KERNEL_EXE)) {
      kernelStatus = 'missing'
      kernelDetail = `packaged single-file runtime missing: ${KERNEL_EXE}`
      return false
    }
    try {
      if (!(await loadSdkClient())) throw new Error('bundled SDK client entry not found')
      kernelMode = 'exe'
      kernelStatus = 'ready'
      kernelDetail = `single-file dsh runtime (${basename(KERNEL_EXE)})`
      return true
    } catch (error) {
      kernelStatus = 'error'
      kernelDetail = `failed to load bundled dsh SDK client: ${error?.message ?? error}`
      return false
    }
  }

  if (!existsSync(DSH_BIN) || !existsSync(SDK_CLIENT_CHECKOUT)) {
    kernelStatus = 'missing'
    kernelDetail = 'deepseek-harness is not built yet — run `pnpm run prepare:kernel`'
    return false
  }
  try {
    await loadSdkClient()
    kernelMode = 'checkout'
    kernelStatus = 'ready'
    kernelDetail = 'vendored dsh runtime resolved'
    return true
  } catch (error) {
    kernelStatus = 'error'
    kernelDetail = `failed to load dsh SDK client: ${error?.message ?? error}`
    return false
  }
}

// ── WebSocket fan-out ──────────────────────────────────────────

const wsClients = new Set()

function broadcast(payload) {
  const line = JSON.stringify(payload)
  for (const socket of wsClients) {
    if (socket.readyState === 1 /* open */) socket.send(line)
  }
}

function broadcastStream(conversationId, stageId, content, extra = {}) {
  if (content === undefined || content === null) return
  broadcast({ type: 'assistant-stream', conversationId, stageId, content, ...extra })
}

function broadcastTelemetry(conversationId, stageId, event) {
  broadcast({ type: 'telemetry', conversationId, stageId, event })
}

// ── Harness pool + conversation bindings ───────────────────────

// route key: provider|model|effort|credential-fingerprint → DeepSeekHarness
const harnessPool = new Map()
// conversationId → { dshSessionId, chain: Promise }
const conversations = new Map()

function fingerprint(secret) {
  return createHash('sha256').update(String(secret ?? '')).digest('hex').slice(0, 12)
}

// Atrium execution modes map onto the kernel's DSH_PERMISSION_MODE env knob
// (sandbox mode + approval policy are derived from it by the base bundle):
//   plan → read-only        只计划，不改文件
//   ask  → workspace-write  工作区内可预测修改放行，需审批的操作在无应答器时拒绝
//   auto → danger-full-access 允许目录内的一切修改
const EXECUTION_MODE_SANDBOX = {
  plan: 'read-only',
  ask: 'workspace-write',
  auto: 'danger-full-access',
}

function routeKey(request) {
  return [
    request.provider ?? 'deepseek-official',
    request.baseUrl ?? 'inherit',
    request.model ?? 'deepseek-flash',
    request.reasoningEffort ?? 'default',
    fingerprint(request.apiKey),
    request.workspace ?? 'inherit',
    request.executionMode ?? 'default',
  ].join('|')
}

/**
 * Build the harness for one route. The packaged single-file runtime is driven
 * through the SDK's runtime-descriptor seam — `HarnessClient`'s optional second
 * argument — which is the supported way to launch a kernel payload that is not
 * a Node script; development boots the checkout's `dsh --profile sdk` instead.
 */
function createHarness(request, childEnv, workspace) {
  const shared = {
    cwd: workspace,
    processCwd: workspace,
    provider: request.provider ?? 'deepseek-official',
    model: request.model ?? 'deepseek-flash',
    ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
    initializeTimeoutMs: 60_000,
  }

  if (kernelMode === 'exe') {
    const cliArgs = ['--profile', 'sdk']
    for (const patch of args.patch) cliArgs.push('--patch', patch)
    return new DeepSeekHarness(
      shared,
      () =>
        new HarnessClient(
          {},
          {
            command: KERNEL_EXE,
            args: cliArgs,
            cwd: workspace,
            environment: () => childEnv,
            description: 'atrium dsh single-file runtime',
            initializeTimeoutMs: 60_000,
          },
        ),
    )
  }

  return new DeepSeekHarness({
    ...shared,
    profile: 'sdk',
    dshBin: DSH_BIN,
    ...(args.patch.length > 0 ? { patches: args.patch } : {}),
    env: childEnv,
  })
}

async function ensureHarness(request) {
  const key = routeKey(request)
  let entry = harnessPool.get(key)
  if (entry) return entry

  const childEnv = { ...process.env }
  if (request.apiKey) childEnv.DEEPSEEK_API_KEY = request.apiKey
  // Bare base URL (no /chat/completions path); the kernel appends it.
  if (request.baseUrl) {
    childEnv.DEEPSEEK_BASE_URL = request.baseUrl
    const isOfficial = !request.baseUrl || request.baseUrl.includes('api.deepseek.com')
    if (!isOfficial) {
      // Third-party provider (e.g. StepFun, Moonshot, OpenAI compatible):
      // Disable DeepSeek native web search endpoint to prevent 401 errors
      // against api.deepseek.com/anthropic/v1/messages.
      childEnv.DEEPSEEK_SEARCH_BASE_URL = 'http://127.0.0.1:0'
    }
  }
  if (args.dshHome) childEnv.DSH_HOME = args.dshHome
  const sandboxMode = EXECUTION_MODE_SANDBOX[request.executionMode]
  if (sandboxMode) childEnv.DSH_PERMISSION_MODE = sandboxMode

  const workspace = request.workspace ?? WORKSPACE

  const harness = createHarness(request, childEnv, workspace)

  entry = { harness, key }
  harnessPool.set(key, entry)
  broadcast({ type: 'kernel-status', status: 'starting', detail: `spawning dsh runtime for ${request.model ?? 'deepseek-flash'}` })
  await harness.start()
  broadcast({ type: 'kernel-status', status: 'ready', detail: `dsh runtime ready (${request.model ?? 'deepseek-flash'})` })
  return entry
}

function bindConversation(conversationId, dshSessionId) {
  const record = conversations.get(conversationId) ?? { dshSessionId, chain: Promise.resolve() }
  record.dshSessionId = dshSessionId
  conversations.set(conversationId, record)
}
// ── Session-event translation (kernel → UI stream) ─────────────

function textOfContentBlocks(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
}

function textOfToolResult(message) {
  if (!message || !Array.isArray(message.content)) return ''
  const block = message.content[0]
  if (block?.type === 'tool-result') {
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

// A run's notification subscription is already scoped to its session tree,
// so every notification here belongs to (conversationId, stageId). The last
// assistant usage seen during the run is collected into `state.usage`.
// `sseWrite` (optional) writes each event as an SSE line to the HTTP response
// stream so the Rust backend can read events incrementally.
function handleNotification(route, notification, state, sseWrite) {
  const { conversationId, stageId } = route

  // Helpers that emit both to WS clients AND the SSE response stream
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
        // 词元计数只增不减：一次运行内 attempt / 子步骤通知可能乱序到达
        // （重放的 attempt 早于最终 message，或多步工具循环中间步骤的
        // usage 小于后续步骤），直接取最后一条会让 /v1/turn 结算载荷与
        // 前端计数器回退。按 (conversationId, stageId) 路线内各字段取高水位。
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
      // Settlement safety net: if the compacted stream carried no text deltas,
      // push the assembled message so the UI never shows an empty node.
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
        event.data?.message?.source?.callId ||
        event.data?.message?.content?.[0]?.toolCallId ||
        ''
      )
      const output = textOfToolResult(event.data?.message)
      const isError = Boolean(event.data?.message?.content?.[0]?.isError || event.data?.error)
      const errorDetail = event.data?.error ? `${event.data.error.name}: ${event.data.error.reason || event.data.error.code}` : undefined
      const status = isError ? 'error' : 'completed'

      if (Array.isArray(state.toolCalls)) {
        const existing = state.toolCalls.find((c) => c.id === callId)
        if (existing) {
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
          callId,
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
        tool: callId,
        detail: '工具执行完成，正在分析并继续推进...',
        callId,
        isError,
      })
      broadcastTelemetry(conversationId, stageId, { kind: 'tool-result', turn: event.data?.turn, callId, isError })
    } else if (event?.type === 'turn/end') {
      _emit({
        type: 'agent-status',
        conversationId,
        stageId,
        status: 'turn_ended',
        detail: '轮次执行完毕',
      })
    } else if (event?.type === 'user/message') {
      broadcastTelemetry(conversationId, stageId, { kind: 'user-message' })
    }
  } else if (notification.method === 'session.status') {
    broadcastTelemetry(conversationId, stageId, { kind: 'session-status', status: notification.params?.status })
  }
}

// ── Turn execution ─────────────────────────────────────────────

function runTurn(request, sseWrite) {
  const conversationId = String(request.conversationId ?? 'default')
  const stageId = request.stageId ?? null
  const prompt = String(request.prompt ?? '').trim()
  if (!prompt) return Promise.reject(new Error('turn prompt is empty'))

  const route = routeKey(request)
  const record = conversations.get(conversationId) ?? { dshSessionId: undefined, routeKey: route, chain: Promise.resolve() }
  if (record.routeKey !== route) {
    // The runtime route changed (model / credential / workspace): the old
    // kernel session lives in another process and cannot continue here.
    record.dshSessionId = undefined
    record.routeKey = route
  }
  conversations.set(conversationId, record)

  const execution = record.chain.then(async () => {
    const entry = await ensureHarness(request)
    const route = { conversationId, stageId }
    const state = { usage: null, toolCalls: [], reasoningText: '', emittedText: '' }
    broadcastTelemetry(conversationId, stageId, { kind: 'turn-start', model: request.model })

    let result
    try {
      result = await entry.harness.run(prompt, {
        ...(record.dshSessionId ? { sessionId: record.dshSessionId } : {}),
        onNotification: (notification) => handleNotification(route, notification, state, sseWrite),
      })
    } catch (runError) {
      // If harness.run rejected (e.g. repeated tool execution failure or network break),
      // check if we already emitted substantial text. If so, recover partial output
      // so the user never loses answers already generated.
      if (state.emittedText && state.emittedText.trim().length > 0) {
        console.warn(`[ATRIUM_BRIDGE] Turn execution failed with error: ${runError?.message ?? runError}. Recovering emitted text (${state.emittedText.length} chars).`);
        result = {
          sessionId: record.dshSessionId ?? 'recovered-session',
          finalResponse: state.emittedText,
        }
      } else {
        throw runError
      }
    }

    bindConversation(conversationId, result.sessionId)
    broadcastTelemetry(conversationId, stageId, { kind: 'turn-complete', sessionId: result.sessionId })

    return {
      sessionId: result.sessionId,
      finalResponse: result.finalResponse ?? state.emittedText ?? '',
      reasoningContent: state.reasoningText || undefined,
      ...(state.usage ? { usage: state.usage } : {}),
      toolCalls: state.toolCalls,
      kernelRoute: routeKey(request),
    }
  })

  // Keep the chain alive even when a turn fails; the next turn retries.
  record.chain = execution.catch(() => undefined)
  return execution
}

// ── HTTP surface ───────────────────────────────────────────────

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(text)
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

const httpServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    })
    res.end()
    return
  }

  const url = (req.url ?? '').split('?')[0]

  try {
    if (req.method === 'GET' && (url === '/healthz' || url === '/status')) {
      sendJson(res, 200, {
        service: 'Atrium Desktop Kernel Bridge',
        version: APP_VERSION,
        status: kernelStatus === 'ready' ? 'ready' : 'degraded',
        kernel: kernelStatus,
        kernelMode,
        detail: kernelDetail,
        dshRoot: DSH_ROOT,
        dshBin: existsSync(DSH_BIN),
        kernelExe: KERNEL_EXE ?? null,
        kernelExePresent: KERNEL_EXE ? existsSync(KERNEL_EXE) : false,
        port: args.port,
        pid: process.pid,
        conversations: conversations.size,
        runtimes: harnessPool.size,
      })
      return
    }

    if (req.method === 'GET' && url === '/api/harness/info') {
      sendJson(res, 200, {
        harness: 'Atrium 智役中庭',
        kernel: kernelMode === 'exe'
          ? 'DeepSeek Harness (packaged single-file runtime, SDK protocol)'
          : 'DeepSeek Harness (vendored upstream, SDK stdio runtime)',
        protocol: 'sdk.v1',
        server: 'deepseek-harness-sdk-runtime',
        profile: 'sdk',
        payload: kernelMode,
        dshRoot: DSH_ROOT,
        url: `http://${args.host}:${args.port}`,
        wsUrl: `ws://${args.host}:${args.port}/events`,
      })
      return
    }

    if (req.method === 'POST' && url === '/v1/turn') {
      if (kernelStatus !== 'ready') {
        sendJson(res, 503, { error: `内核不可用: ${kernelDetail}` })
        return
      }
      const request = await readBody(req)

      // Stream SSE events so the Rust backend can emit Tauri events
      // incrementally instead of waiting for the full turn to complete.
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      })

      const sseWrite = (payload) => {
        try {
          res.write(`event: stream\ndata: ${JSON.stringify(payload)}\n\n`)
        } catch { /* client may have disconnected */ }
      }

      try {
        const result = await runTurn(request, sseWrite)
        res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`)
      } catch (error) {
        try {
          res.write(`event: error\ndata: ${JSON.stringify({ error: error?.message ?? String(error) })}\n\n`)
        } catch { /* client disconnected */ }
      }
      try {
        res.end()
      } catch { /* socket already closed */ }
      return
    }

    if (req.method === 'POST' && url === '/v1/reset') {
      const { conversationId } = await readBody(req)
      if (conversationId) conversations.delete(String(conversationId))
      else conversations.clear()
      sendJson(res, 200, { ok: true })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    sendJson(res, 500, { error: error?.message ?? String(error) })
  }
})

const wss = new WebSocketServer({ server: httpServer, path: '/events' })
wss.on('connection', (socket) => {
  wsClients.add(socket)
  socket.send(JSON.stringify({ type: 'kernel-status', status: kernelStatus, detail: kernelDetail }))
  socket.on('close', () => wsClients.delete(socket))
  socket.on('error', () => wsClients.delete(socket))
})

// ── Lifecycle ──────────────────────────────────────────────────

async function shutdown() {
  broadcast({ type: 'kernel-status', status: 'stopping', detail: 'bridge shutting down' })
  for (const entry of harnessPool.values()) {
    await entry.harness.close().catch(() => undefined)
  }
  httpServer.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
process.on('message', (message) => {
  if (message?.type === 'shutdown') void shutdown()
})

const server = httpServer.listen(args.port, args.host, () => {
  console.log(`[ATRIUM_BRIDGE] listening on http://${args.host}:${args.port} (dsh root: ${DSH_ROOT})`)
  void loadKernel()
})

server.on('error', (error) => {
  console.error(`[ATRIUM_BRIDGE][FATAL] could not bind ${args.host}:${args.port}: ${error?.message ?? error}`)
  process.exit(1)
})
