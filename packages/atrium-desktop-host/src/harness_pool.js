import {
  args,
  KERNEL_EXE,
  DSH_BIN,
  WORKSPACE,
} from './args.js'
import { kernelState } from './kernel.js'
import { broadcast } from './ws_broadcast.js'
import {
  dshRoute,
  routeKey,
  piAiRouteId,
  writeRoutePatch,
  writePiAiPatch,
  PI_AI_KEY_ENV,
  PI_AI_EFFORTS,
  EXECUTION_MODE_SANDBOX,
} from './routes.js'

export const harnessPool = new Map()
export const conversations = new Map()

export const MAX_LIVE_HARNESSES = Math.max(
  1,
  Number(process.env.ATRIUM_MAX_HARNESSES ?? 3) || 3,
)

export function createHarness(request, childEnv, workspace, route, provider, reasoningEffort) {
  const { DeepSeekHarness, HarnessClient, mode: kernelMode } = kernelState

  const shared = {
    cwd: workspace,
    processCwd: workspace,
    provider,
    model: request.model ?? 'deepseek-flash',
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    initializeTimeoutMs: 60_000,
  }

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

export async function ensureHarness(request) {
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
  let provider = 'deepseek-official'
  if (route.adapter === 'pi-ai') {
    provider = piAiRouteId(route.protocol, request.baseUrl, request.model)
    if (request.apiKey) childEnv[PI_AI_KEY_ENV] = request.apiKey
  } else {
    if (request.apiKey) childEnv.DEEPSEEK_API_KEY = request.apiKey
    if (request.baseUrl) {
      childEnv.DEEPSEEK_BASE_URL = request.baseUrl
      const isOfficial = !request.baseUrl || request.baseUrl.includes('api.deepseek.com')
      if (!isOfficial) {
        childEnv.DEEPSEEK_SEARCH_BASE_URL = 'http://127.0.0.1:0'
      }
    }
  }
  if (args.dshHome) childEnv.DSH_HOME = args.dshHome
  const sandboxMode = EXECUTION_MODE_SANDBOX[request.executionMode]
  if (sandboxMode) childEnv.DSH_PERMISSION_MODE = sandboxMode

  const workspace = request.workspace ?? WORKSPACE
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
  await pruneHarnessPool(key)
  return entry
}

export async function pruneHarnessPool(protectKey) {
  const boundKeys = new Set(
    [...conversations.values()].map((record) => record.routeKey).filter(Boolean),
  )
  const evictable = [...harnessPool.values()]
  if (protectKey) {
    // filter out protected key
  }
  const targets = evictable
    .filter((entry) => entry.key !== protectKey && entry.activeTurns === 0)
    .sort((a, b) => a.lastUsed - b.lastUsed)

  const evict = async (entry, droppedContext) => {
    harnessPool.delete(entry.key)
    for (const record of conversations.values()) {
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

  for (const entry of targets) {
    if (harnessPool.size <= MAX_LIVE_HARNESSES) break
    if (boundKeys.has(entry.key)) continue
    await evict(entry, false)
  }
  for (const entry of targets) {
    if (harnessPool.size <= MAX_LIVE_HARNESSES * 2) break
    if (!harnessPool.has(entry.key)) continue
    await evict(entry, true)
  }
}

export function bindConversation(conversationId, dshSessionId) {
  const record = conversations.get(conversationId) ?? { dshSessionId, chain: Promise.resolve() }
  record.dshSessionId = dshSessionId
  conversations.set(conversationId, record)
}

export async function closeAllHarnesses() {
  for (const entry of harnessPool.values()) {
    await entry.harness.close().catch(() => undefined)
  }
  harnessPool.clear()
}
