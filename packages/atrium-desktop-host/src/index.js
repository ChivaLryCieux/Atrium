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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'

// ── CLI arguments ──────────────────────────────────────────────

function parseArgs(argv) {
  const args = { port: 19387, host: '127.0.0.1', dshRoot: null, kernelExe: null, appVersion: null, patch: [], workspace: null, dshHome: null, token: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--token') args.token = String(argv[++i])
    else if (a === '--port') args.port = Number(argv[++i])
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

/**
 * How many dsh runtimes may stay live at once.
 *
 * One runtime is a whole Node process with the entire plugin graph mounted, and
 * the route key includes the model, the reasoning effort and the credential
 * fingerprint — so without a cap, switching models in the picker leaves one
 * ~250 MB runtime behind per combination, for the life of the bridge.
 *
 * Eviction is last-used-first and skips anything a turn is currently running
 * on or a live conversation is still bound to; when every runtime is busy the
 * pool is allowed to exceed the cap rather than interrupt work.
 */
const MAX_LIVE_HARNESSES = Math.max(
  1,
  Number(process.env.ATRIUM_MAX_HARNESSES ?? 3) || 3,
)
const conversations = new Map()

// ── Wire protocol ──────────────────────────────────────────────
//
// The kernel serves two LLM adapter families whose protocol sets are
// disjoint, so a profile's protocol decides which one drives the route:
//
//   • `dsh-llm-deepseek` (mounted as the `llm-deepseek` row by
//     `dsh-llm-deepseek-api-key`) — Anthropic Messages only. Since dsh 0.2 the
//     protocol is not configurable: the row accepts a Messages-compatible
//     `baseURL` and rejects a `protocol` key. This family also carries the
//     DeepSeek-native features (session log, plugin inventory, Files API,
//     DeepSeek web search).
//   • `dsh-llm-pi-ai` — the multi-provider adapter serving OpenAI Chat
//     Completions (`openai-completions`) and OpenAI Responses
//     (`openai-responses`). It mounts dormant and owns no routes until its
//     `providers` config declares some, so those routes supply a generated
//     per-route `llm-pi-ai` row patch.
//
// A protocol neither family serves is rejected here rather than silently
// spoken to the wrong endpoint.

/** Atrium profile protocol -> the kernel adapter and protocol that serve it. */
const DSH_ROUTES = {
  'anthropic-messages': { adapter: 'deepseek', protocol: 'messages' },
  'openai-chat': { adapter: 'pi-ai', protocol: 'openai-completions' },
  'openai-responses': { adapter: 'pi-ai', protocol: 'openai-responses' },
}

/**
 * Credential reference a generated pi-ai route names. One variable serves every
 * pi-ai route because each one runs in its own runtime process with its own
 * environment; a per-route name would only add names nobody can address.
 * It matches dsh's credential-ref grammar `^[A-Za-z_][A-Za-z0-9_]*$`.
 */
const PI_AI_KEY_ENV = 'ATRIUM_ROUTE_API_KEY'

/**
 * Reasoning efforts a generated pi-ai route declares, as `[level, wire]`
 * pairs: the level is what the harness selects, the wire spelling what goes on
 * the wire. An empty wire is `null` — offered, sends nothing — which only `off`
 * may be. `max` clamps to the Responses API's top effort, `high`.
 *
 * The list is both what the generated document declares and what a requested
 * effort is checked against, so the two cannot drift.
 */
const PI_AI_EFFORTS = [
  ['off', ''],
  ['low', 'low'],
  ['high', 'high'],
  ['max', 'high'],
]

/**
 * Resolve the kernel route for one turn.
 * @param {unknown} apiProtocol - `apiProtocol` from the turn request.
 * @returns {{adapter: string, protocol: string}|null} the route, or null when
 *   no kernel adapter can serve the protocol.
 */
function dshRoute(apiProtocol) {
  const key = typeof apiProtocol === 'string' ? apiProtocol.trim() : ''
  // An absent value keeps the DeepSeek row's own default, which is Messages.
  if (key === '') return DSH_ROUTES['anthropic-messages']
  return DSH_ROUTES[key] ?? null
}

/** Cordis overlay directories generated per route, removed when the bridge exits. */
const generatedPatchDirs = []

// YAML single-quoted scalars: the only escape is '' for an embedded quote.
const yamlScalar = value => `'${String(value).replace(/'/g, "''")}'`

/** Create this route's scratch directory, tracked for removal on exit. */
function routeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'atrium-route-'))
  generatedPatchDirs.push(dir)
  return dir
}

/**
 * Write the per-route composition overlay.
 *
 * A Cordis patch replaces a row's whole `config`, so this restates each row
 * it owns in full and leaves every other row at whatever the composition
 * shipped. It is appended after the static `--patch` files so the route always
 * wins, and one file is written per route because the harness pool holds one
 * runtime per (protocol, base URL, model, ...) route.
 *
 * Two things are route-owned:
 *
 *   1. `llm-deepseek` — the API root. Since dsh 0.2 the row speaks Anthropic
 *      Messages only and rejects a `protocol` key, so none is written.
 *   2. The DeepSeek-only request extensions. `dsh_session_log` and
 *      `dsh_plugin_packages` are top-level body fields that only DeepSeek's
 *      own Messages endpoint reads; a third-party endpoint that follows the
 *      Anthropic schema rejects unknown top-level fields, so those two rows
 *      are switched off whenever the route is not DeepSeek's own service.
 *
 * @param {string} protocol - dsh protocol (always `messages` for this adapter).
 * @param {string|undefined} baseUrl - validated API root for the route.
 * @returns {string|null} the patch path, or null when there is nothing to pin.
 */
function writeRoutePatch(protocol, baseUrl) {
  const official = baseUrl === undefined || baseUrl.includes('api.deepseek.com')
  if (baseUrl === undefined && official) return null
  const dir = routeDir()
  const path = join(dir, `llm-deepseek.${fingerprint(`${protocol}|${baseUrl ?? ''}`)}.cordis.patch.yml`)
  const lines = [
    '# Generated by @atrium/desktop-host — one route, one runtime.',
    '- id: llm-deepseek',
    '  config:',
  ]
  if (baseUrl !== undefined) lines.push(`    baseURL: ${yamlScalar(baseUrl)}`)
  if (!official) {
    // `enabled: false` is each plugin's own documented off switch, and is the
    // whole config of these rows, so replacing it is complete.
    for (const id of ['session-log-deepseek', 'plugin-package-inventory-deepseek']) {
      lines.push(`- id: ${id}`, '  config:', '    enabled: false')
    }
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

/**
 * The pi-ai route id for a Responses route. It doubles as a credential key
 * segment, so it must match dsh's `^[a-z][a-z0-9-]*$`: lowercase, digits and
 * dashes only, which the hex fingerprint satisfies.
 * @param {string} protocol - the pi-ai protocol.
 * @param {string|undefined} baseUrl - API root for the route.
 * @param {string|undefined} model - model id for the route.
 * @returns {string} the route id.
 */
function piAiRouteId(protocol, baseUrl, model) {
  return `atrium-${fingerprint(`${protocol}|${baseUrl ?? ''}|${model ?? ''}`)}`
}

/**
 * Write the per-route composition overlay for a `dsh-llm-pi-ai` route.
 *
 * `llm-pi-ai` owns no routes until its `providers` config supplies provider
 * profiles. Since dsh 0.2 there is no `settings.yaml` document: a plugin's
 * settings are its own composition row, so the route is declared by patching
 * the `llm-pi-ai` row's `providers` directly. That row has no other config, so
 * replacing the whole `config` here is complete. One file is written per route
 * because one shared row cannot describe two concurrently live routes.
 *
 * The model entry declares reasoning levels because a hand-declared route has
 * no installed catalog entry to inherit them from, and a request naming an
 * effort the model does not offer fails with `UNSUPPORTED_REASONING_EFFORT`.
 * The keys are exactly the efforts Atrium persists; the values are the wire
 * spellings the API accepts, where `max` clamps to its top effort.
 *
 * @param {string} routeId - the pi-ai route id.
 * @param {string} protocol - the pi-ai protocol.
 * @param {string|undefined} baseUrl - API root for the route.
 * @param {string|undefined} model - model id for the route.
 * @param {string} keyEnv - environment variable naming the route's key.
 * @returns {string} the patch path.
 */
function writePiAiPatch(routeId, protocol, baseUrl, model, keyEnv) {
  const path = join(routeDir(), 'llm-pi-ai.cordis.patch.yml')
  const lines = [
    '# Generated by @atrium/desktop-host — one route, one runtime.',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    `      ${routeId}:`,
    `        api: ${yamlScalar(protocol)}`,
    `        apiKeyEnv: ${yamlScalar(keyEnv)}`,
  ]
  if (baseUrl !== undefined) lines.push(`        baseURL: ${yamlScalar(baseUrl)}`)
  lines.push('        models:', `          - id: ${yamlScalar(model ?? '')}`, '            reasoningEfforts:')
  for (const [level, wire] of PI_AI_EFFORTS) {
    // An empty wire is written as a bare key, which YAML reads as `null`:
    // the level is offered and sends nothing.
    lines.push(wire === '' ? `              ${level}:` : `              ${level}: ${wire}`)
  }
  writeFileSync(path, `${lines.join('\n')}\n`, 'utf8')
  return path
}

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
  const route = dshRoute(request.apiProtocol)
  return [
    route === null ? 'unsupported' : `${route.adapter}:${route.protocol}`,
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
 *
 * `patches` is the ordered overlay list: the static `--patch` files first, then
 * this route's generated row, which must be last so the operator's protocol and
 * endpoint win over any shipped default.
 *
 * @param {object} request - the turn request.
 * @param {object} childEnv - the complete environment for this runtime.
 * @param {string} workspace - the runtime's working directory.
 * @param {{adapter: string, protocol: string}} route - the resolved kernel route.
 * @param {string} provider - the provider route the agent is created on.
 * @param {string|undefined} reasoningEffort - effort the model declares, if any.
 * @returns {DeepSeekHarness} the harness for this route.
 */
function createHarness(request, childEnv, workspace, route, provider, reasoningEffort) {
  const shared = {
    cwd: workspace,
    processCwd: workspace,
    provider,
    model: request.model ?? 'deepseek-flash',
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    initializeTimeoutMs: 60_000,
  }
  // A pi-ai route is declared by a generated `llm-pi-ai` row patch, and
  // `provider` is that patch's route id.
  const routePatch = route.adapter === 'pi-ai'
    ? writePiAiPatch(provider, route.protocol, request.baseUrl, request.model, PI_AI_KEY_ENV)
    : writeRoutePatch(route.protocol, request.baseUrl)
  const patches = routePatch === null ? args.patch : [...args.patch, routePatch]

  if (kernelMode === 'exe') {
    const cliArgs = ['--profile', 'sdk']
    for (const patch of patches) cliArgs.push('--patch', patch)
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
    ...(patches.length > 0 ? { patches } : {}),
    env: childEnv,
  })
}

async function ensureHarness(request) {
  const route = dshRoute(request.apiProtocol)
  if (route === null) {
    throw new Error(
      `no kernel adapter speaks protocol "${String(request.apiProtocol).trim()}";`
      + ' the kernel serves anthropic-messages, openai-chat and openai-responses routes only.',
    )
  }
  const key = routeKey(request)
  let entry = harnessPool.get(key)
  if (entry) {
    entry.lastUsed = Date.now()
    return entry
  }

  const childEnv = { ...process.env }
  // The DeepSeek adapter reads its own endpoint and key from the environment;
  // the pi-ai adapter reads them from the route's generated row patch
  // and its named reference. Both are per-runtime, so both are safe to set per
  // route.
  let provider = 'deepseek-official'
  if (route.adapter === 'pi-ai') {
    provider = piAiRouteId(route.protocol, request.baseUrl, request.model)
    if (request.apiKey) childEnv[PI_AI_KEY_ENV] = request.apiKey
  } else {
    if (request.apiKey) childEnv.DEEPSEEK_API_KEY = request.apiKey
    // The endpoint root for the kernel route: it appends the protocol's own
    // resource path itself (`/v1/messages` for Messages, `/chat/completions` for
    // Chat Completions), so the stored inference endpoint is reduced upstream.
    if (request.baseUrl) {
      childEnv.DEEPSEEK_BASE_URL = request.baseUrl
      const isOfficial = !request.baseUrl || request.baseUrl.includes('api.deepseek.com')
      if (!isOfficial) {
        // Third-party provider (e.g. StepFun, Moonshot, a gateway, or a
        // non-DeepSeek Anthropic endpoint): the shipped web search tool speaks
        // DeepSeek's own Messages endpoint and its key, so pointing it at this
        // route's base would 401 on every search.
        childEnv.DEEPSEEK_SEARCH_BASE_URL = 'http://127.0.0.1:0'
      }
    }
  }
  if (args.dshHome) childEnv.DSH_HOME = args.dshHome
  const sandboxMode = EXECUTION_MODE_SANDBOX[request.executionMode]
  if (sandboxMode) childEnv.DSH_PERMISSION_MODE = sandboxMode

  const workspace = request.workspace ?? WORKSPACE
  // A model only accepts an effort its route declares; the generated pi-ai
  // patch declares exactly the four Atrium persists, so anything else here
  // is stale and is dropped rather than failing the turn.
  const declared = route.adapter === 'pi-ai' ? PI_AI_EFFORTS.map(([level]) => level) : undefined
  const requested = request.reasoningEffort
  const reasoningEffort = requested === undefined
    || requested === ''
    || (declared !== undefined && !declared.includes(requested))
    ? undefined
    : requested

  const harness = createHarness(request, childEnv, workspace, route, provider, reasoningEffort)

  entry = { harness, key, lastUsed: Date.now(), activeTurns: 0 }
  harnessPool.set(key, entry)
  broadcast({
    type: 'kernel-status',
    status: 'starting',
    detail: `spawning dsh runtime for ${request.model ?? 'deepseek-flash'} over ${route.protocol} (${route.adapter})`,
  })
  await harness.start()
  broadcast({
    type: 'kernel-status',
    status: 'ready',
    detail: `dsh runtime ready (${request.model ?? 'deepseek-flash'}, ${route.protocol} over ${route.adapter})`,
  })
  // The new runtime is live; make room for it before the next route arrives.
  await pruneHarnessPool(key)
  return entry
}

/**
 * Close idle runtimes until the pool fits {@link MAX_LIVE_HARNESSES}.
 *
 * Two tiers, because a runtime's kernel session is the *only* home of a
 * conversation's context (`runTurn` sends the prompt alone), so closing a
 * runtime that a conversation is still bound to silently ends that
 * conversation's memory:
 *
 *   • soft cap — evict only runtimes no conversation is bound to. Safe, runs
 *     forever, and reclaims exactly the leftovers of abandoned model switches.
 *   • hard cap (`MAX_LIVE_HARNESSES * 2`) — if every runtime still holds a live
 *     conversation, keep going and give up the coldest one's context, because an
 *     unbounded pool is what exhausts memory in the first place. A dropped
 *     context is announced on the event stream rather than done quietly.
 *
 * A runtime with a turn in flight is never closed, at either tier.
 *
 * @param {string} protectKey - route key to keep regardless of age.
 */
async function pruneHarnessPool(protectKey) {
  const boundKeys = new Set(
    [...conversations.values()].map((record) => record.routeKey).filter(Boolean),
  )
  const evictable = [...harnessPool.values()]
    .filter((entry) => entry.key !== protectKey && entry.activeTurns === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed)

  const evict = async (entry, droppedContext) => {
    harnessPool.delete(entry.key)
    for (const record of conversations.values()) {
      // The kernel session lived in the process being closed, so the next turn
      // on this route must seed a fresh one rather than resume a session id the
      // new runtime never knew.
      if (record.routeKey === entry.key) record.dshSessionId = undefined
    }
    broadcast({
      type: 'kernel-status',
      status: 'evicted',
      detail: droppedContext
        ? `released the least recently used dsh runtime (${harnessPool.size} left); its conversation context was reset`
        : `released an unused dsh runtime (${harnessPool.size} left)`,
    })
    await entry.harness.close().catch(() => undefined)
  }

  // Soft cap: only runtimes no conversation is bound to.
  for (const entry of evictable) {
    if (harnessPool.size <= MAX_LIVE_HARNESSES) break
    if (boundKeys.has(entry.key)) continue
    await evict(entry, false)
  }
  // Hard cap: every remaining runtime holds live context — trade the coldest
  // one's memory for a bounded process count.
  for (const entry of evictable) {
    if (harnessPool.size <= MAX_LIVE_HARNESSES * 2) break
    if (!harnessPool.has(entry.key)) continue
    await evict(entry, true)
  }
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
    // Held for the whole turn so pool pruning never closes a runtime that is
    // currently producing a response, however this turn ends.
    entry.activeTurns += 1
    try {
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

      if (state.flushStreamBuffer) state.flushStreamBuffer()
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
    } finally {
      entry.activeTurns -= 1
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


// ── Local IPC Security & Origin Isolation ──────────────────────

function isOriginAllowed(origin) {
  if (!origin) return true // native local non-browser requests (Rust reqwest, curl)
  try {
    const parsed = new URL(origin)
    const host = parsed.hostname
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      parsed.protocol === 'tauri:' ||
      parsed.protocol === 'app:'
    )
  } catch {
    return false
  }
}

function authenticate(req) {
  if (!args.token) return true // backwards-compatible if no token configured
  const authHeader = req.headers['authorization']
  const customHeader = req.headers['x-atrium-token']
  if (authHeader && authHeader === `Bearer ${args.token}`) return true
  if (customHeader && customHeader === args.token) return true
  return false
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

  const origin = req.headers['origin']
  if (origin && !isOriginAllowed(origin)) {
    sendJson(res, 403, { error: 'Forbidden: untrusted origin' })
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
      if (!authenticate(req)) {
        sendJson(res, 401, { error: 'Unauthorized: invalid or missing Atrium IPC token' })
        return
      } 
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
wss.on('connection', (socket, req) => {
  if (args.token) {
    try {
      const host = req.headers.host || '127.0.0.1'
      const parsedUrl = new URL(req.url, `http://${host}`)
      const tokenParam = parsedUrl.searchParams.get('token')
      const authHeader = req.headers['authorization']
      const valid = tokenParam === args.token || authHeader === `Bearer ${args.token}`
      if (!valid) {
        socket.close(4001, 'Unauthorized')
        return
      }
    } catch {
      socket.close(4001, 'Unauthorized')
      return
    }
  }
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
  // The per-route Cordis overlays are scratch files describing a live runtime;
  // nothing reads them once the runtimes are gone.
  for (const dir of generatedPatchDirs) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch { /* the OS temp sweeper is the backstop */ }
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
