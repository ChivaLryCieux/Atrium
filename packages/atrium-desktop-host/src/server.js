import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { WebSocketServer } from 'ws'

import {
  args,
  APP_VERSION,
  DSH_ROOT,
  DSH_BIN,
  KERNEL_EXE,
} from './args.js'
import { kernelState, loadKernel } from './kernel.js'
import { wsClients, broadcast } from './ws_broadcast.js'
import { cleanupPatchDirs } from './routes.js'
import {
  harnessPool,
  conversations,
  closeAllHarnesses,
} from './harness_pool.js'
import { runTurn, abortTurn } from './turns.js'
import {
  getPluginCatalog,
  toggleBundle,
  togglePatchPlugin,
  installPlugin,
  removePlugin,
  inspectPlugin,
} from './plugins.js'

export function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  })
  res.end(text)
}

export async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export function isOriginAllowed(origin) {
  if (!origin) return true
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

export function authenticate(req) {
  if (!args.token) return true
  const authHeader = req.headers['authorization']
  const customHeader = req.headers['x-atrium-token']
  if (authHeader && authHeader === `Bearer ${args.token}`) return true
  if (customHeader && customHeader === args.token) return true
  return false
}

export function startBridgeServer() {
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
          status: kernelState.status === 'ready' ? 'ready' : 'degraded',
          kernel: kernelState.status,
          kernelMode: kernelState.mode,
          detail: kernelState.detail,
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
          kernel: kernelState.mode === 'exe'
            ? 'DeepSeek Harness (packaged single-file runtime, SDK protocol)'
            : 'DeepSeek Harness (vendored upstream, SDK stdio runtime)',
          protocol: 'sdk.v1',
          server: 'deepseek-harness-sdk-runtime',
          profile: 'sdk',
          payload: kernelState.mode,
          dshRoot: DSH_ROOT,
          url: `http://${args.host}:${args.port}`,
          wsUrl: `ws://${args.host}:${args.port}/events`,
        })
        return
      }

      if (req.method === 'POST' && url === '/v1/turn') {
        if (kernelState.status !== 'ready') {
          sendJson(res, 503, { error: `内核不可用: ${kernelState.detail}` })
          return
        }
        const request = await readBody(req)

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
          } catch { /* client disconnected */ }
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
        } catch { /* already closed */ }
        return
      }

      if (req.method === 'POST' && (url === '/v1/abort' || url === '/v1/turn/abort')) {
        const body = await readBody(req)
        const conversationId = String(body.conversationId ?? '')
        const aborted = abortTurn(conversationId)
        sendJson(res, 200, { ok: true, conversationId, aborted })
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

      if (req.method === 'GET' && url === '/api/plugins') {
        const urlObj = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
        const profile = urlObj.searchParams.get('profile') || 'sdk'
        const data = getPluginCatalog(profile)
        sendJson(res, 200, { ok: true, data })
        return
      }

      if (req.method === 'POST' && url === '/api/plugins/bundle/toggle') {
        const body = await readBody(req)
        const profile = body.profile || 'sdk'
        const result = await toggleBundle({
          profile,
          name: body.name,
          enabled: Boolean(body.enabled),
        })
        sendJson(res, 200, result)
        return
      }

      if (req.method === 'POST' && url === '/api/plugins/plugin/toggle') {
        const body = await readBody(req)
        const profile = body.profile || 'sdk'
        const result = await togglePatchPlugin({
          profile,
          id: body.id,
          name: body.name,
          enabled: Boolean(body.enabled),
        })
        sendJson(res, 200, result)
        return
      }

      if (req.method === 'POST' && url === '/api/plugins/install') {
        const body = await readBody(req)
        const profile = body.profile || 'sdk'
        const spec = String(body.spec || '').trim()
        if (!spec) {
          sendJson(res, 400, { ok: false, error: 'Package spec is required' })
          return
        }
        try {
          const result = await installPlugin({
            profile,
            spec,
            registry: body.registry,
          })
          sendJson(res, 200, result)
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err.message || String(err) })
        }
        return
      }

      if (req.method === 'POST' && url === '/api/plugins/remove') {
        const body = await readBody(req)
        const profile = body.profile || 'sdk'
        const name = String(body.name || '').trim()
        if (!name) {
          sendJson(res, 400, { ok: false, error: 'Bundle/package name is required' })
          return
        }
        try {
          const result = await removePlugin({
            profile,
            name,
          })
          sendJson(res, 200, result)
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err.message || String(err) })
        }
        return
      }

      if (req.method === 'POST' && url === '/api/plugins/inspect') {
        const body = await readBody(req)
        const spec = String(body.spec || '').trim()
        if (!spec) {
          sendJson(res, 400, { ok: false, error: 'Package spec is required' })
          return
        }
        const result = await inspectPlugin({
          spec,
          registry: body.registry,
        })
        sendJson(res, 200, result)
        return
      }

      sendJson(res, 404, { error: 'not found' })
    } catch (error) {
      sendJson(res, 500, { error: error?.message ?? String(error) })
    }
  })

  const wss = new WebSocketServer({ server: httpServer, path: '/events' })
  wss.on('error', (err) => {
    // Handled by httpServer error listener
  })
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
    socket.send(JSON.stringify({ type: 'kernel-status', status: kernelState.status, detail: kernelState.detail }))
    socket.on('close', () => wsClients.delete(socket))
    socket.on('error', () => wsClients.delete(socket))
  })

  let pipeServer = null
  if (args.pipe) {
    try {
      pipeServer = createServer(httpServer.listeners('request')[0])
      pipeServer.listen(args.pipe, () => {
        console.log(`[ATRIUM_BRIDGE] listening on named pipe ${args.pipe}`)
      })
      pipeServer.on('error', (err) => {
        console.warn(`[ATRIUM_BRIDGE] named pipe listen error: ${err?.message ?? err}`)
      })
    } catch (err) {
      console.warn(`[ATRIUM_BRIDGE] could not create named pipe server: ${err?.message ?? err}`)
    }
  }

  async function shutdown() {
    broadcast({ type: 'kernel-status', status: 'stopping', detail: 'bridge shutting down' })
    await closeAllHarnesses()
    cleanupPatchDirs()
    if (pipeServer) {
      try {
        pipeServer.close()
      } catch { /* ignore */ }
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
    if (error.code === 'EADDRINUSE' && !process.env.ATRIUM_BRIDGE_STRICT_PORT) {
      console.warn(`[ATRIUM_BRIDGE] Port ${args.port} is already in use, trying ${args.port + 1}...`)
      args.port += 1
      server.listen(args.port, args.host)
      return
    }
    console.error(`[ATRIUM_BRIDGE][FATAL] could not bind ${args.host}:${args.port}: ${error?.message ?? error}`)
    process.exit(1)
  })

  return { httpServer, wss, pipeServer, shutdown }
}
