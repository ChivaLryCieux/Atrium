import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function parseArgs(argv) {
  const args = { port: 19387, host: '127.0.0.1', pipe: null, dshRoot: null, kernelExe: null, appVersion: null, patch: [], workspace: null, dshHome: null, token: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pipe') args.pipe = String(argv[++i])
    else if (a === '--token') args.token = String(argv[++i])
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

export const args = parseArgs(process.argv.slice(2))
export const APP_VERSION = args.appVersion ?? 'dev'
export const KERNEL_EXE = args.kernelExe
export const DSH_ROOT = args.dshRoot ?? resolve(process.cwd(), 'deepseek-harness')
export const DSH_BIN = join(DSH_ROOT, 'apps', 'cli', 'lib', 'bin.js')
export const SDK_CLIENT_BUNDLED = join(
  typeof __dirname === 'string' ? __dirname : dirname(fileURLToPath(import.meta.url)),
  'sdk-client.mjs',
)
export const SDK_CLIENT_CHECKOUT = join(DSH_ROOT, 'packages', 'sdk', 'client', 'lib', 'index.js')
export const WORKSPACE = args.workspace ?? process.cwd()
