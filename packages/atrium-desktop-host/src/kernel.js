import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  KERNEL_EXE,
  DSH_BIN,
  SDK_CLIENT_BUNDLED,
  SDK_CLIENT_CHECKOUT,
} from './args.js'

export const kernelState = {
  status: 'starting',
  detail: 'resolving DeepSeek Harness runtime',
  mode: KERNEL_EXE ? 'exe' : 'checkout',
  DeepSeekHarness: null,
  HarnessClient: null,
}

export async function loadSdkClient() {
  const entry = existsSync(SDK_CLIENT_BUNDLED) ? SDK_CLIENT_BUNDLED : SDK_CLIENT_CHECKOUT
  if (!existsSync(entry)) return false
  const mod = await import(pathToFileURL(entry).href)
  kernelState.DeepSeekHarness = mod.DeepSeekHarness
  kernelState.HarnessClient = mod.HarnessClient
  return typeof kernelState.DeepSeekHarness === 'function' && typeof kernelState.HarnessClient === 'function'
}

export async function loadKernel() {
  if (KERNEL_EXE) {
    if (!existsSync(KERNEL_EXE)) {
      kernelState.status = 'missing'
      kernelState.detail = `packaged single-file runtime missing: ${KERNEL_EXE}`
      return false
    }
    try {
      if (!(await loadSdkClient())) throw new Error('bundled SDK client entry not found')
      kernelState.mode = 'exe'
      kernelState.status = 'ready'
      kernelState.detail = `single-file dsh runtime (${basename(KERNEL_EXE)})`
      return true
    } catch (error) {
      kernelState.status = 'error'
      kernelState.detail = `failed to load bundled dsh SDK client: ${error?.message ?? error}`
      return false
    }
  }

  if (!existsSync(DSH_BIN) || !existsSync(SDK_CLIENT_CHECKOUT)) {
    kernelState.status = 'missing'
    kernelState.detail = 'deepseek-harness is not built yet — run `pnpm run prepare:kernel`'
    return false
  }
  try {
    await loadSdkClient()
    kernelState.mode = 'checkout'
    kernelState.status = 'ready'
    kernelState.detail = 'vendored dsh runtime resolved'
    return true
  } catch (error) {
    kernelState.status = 'error'
    kernelState.detail = `failed to load dsh SDK client: ${error?.message ?? error}`
    return false
  }
}
