import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import YAML from 'yaml'
import { args, DSH_ROOT } from './args.js'
import { broadcast } from './ws_broadcast.js'

export const KNOWN_BUNDLES = [
  {
    name: '@deepseek-ai/dsh-base',
    title: 'DSH 核心基础底座 (dsh-base)',
    description: 'Cordis 微内核、基础工具集、沙箱策略与会话上下文核心环境',
    category: 'core',
    core: true,
  },
  {
    name: '@deepseek-ai/dsh-sdk-app',
    title: 'SDK 运行时宿主 (dsh-sdk-app)',
    description: 'JSON-RPC Stdio 协议双向通信管道与宿主进程生命周期管理',
    category: 'core',
    core: true,
  },
  {
    name: '@deepseek-ai/dsh-plugin-manager',
    title: 'DSH 插件管理服务 (plugin-manager)',
    description: '内核插件与组合包管理核心服务，打通运行时依赖与热加载',
    category: 'core',
    core: true,
  },
  {
    name: '@deepseek-ai/dsh-experimental-agent-team-profile',
    title: 'Agent 协同团队 (Multi-Agent Team)',
    description: '支持多智能体协同协作、分工编排、子任务派发与角色代理机制',
    category: 'official',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-experimental-voice-input-bundle',
    title: '语音交互与流式输入 (Voice Input)',
    description: '提供音频输入识别、语音流式交互与多模态提示词注入通道',
    category: 'official',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-experimental-auto-review',
    title: '自动化代码评审 (Auto Review)',
    description: '智能体工作流执行后的自动化代码复查、质量审计与安全守卫',
    category: 'official',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-experimental-inspector-profile',
    title: '运行时内核探针 (Runtime Inspector)',
    description: '深入探测 Cordis 运行时依赖图谱、上下文生命周期与服务注入状态',
    category: 'official',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-browser-use',
    title: '浏览器自动化 (Browser-Use)',
    description: '驱动无头浏览器执行网页阅读、表单交互与端到端自动化操作',
    category: 'ecosystem',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-skill-office',
    title: 'Office 文档智能处理 (Skill Office)',
    description: '提供 Word、Excel、PPT、PDF 等常用办公文档的深度解析与生成',
    category: 'ecosystem',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-tool-workspace-dependencies',
    title: '工作区依赖诊断 (Workspace Dependencies)',
    description: '分析项目依赖拓扑结构、潜在版本冲突与开发环境健康度',
    category: 'ecosystem',
    core: false,
  },
  {
    name: '@deepseek-ai/dsh-lsp',
    title: '语言服务协议支持 (LSP)',
    description: '支持代码定义跳转、语义分析、代码诊断与符号索引',
    category: 'ecosystem',
    core: false,
  },
]

export function resolveDshHomePath() {
  if (args.dshHome) return args.dshHome
  if (process.env.DSH_HOME) return process.env.DSH_HOME
  return join(homedir(), '.dsh')
}

export function getProfileDirectory(profile = 'sdk') {
  const dshHome = resolveDshHomePath()
  const dir = join(dshHome, 'profiles', profile)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) {
    const initialManifest = {
      name: `dsh-profile-${profile}`,
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-sdk-app',
          ],
        },
      },
    }
    writeFileSync(pkgPath, JSON.stringify(initialManifest, null, 2) + '\n', 'utf8')
  }
  const patchPath = join(dir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    writeFileSync(patchPath, '[]\n', 'utf8')
  }
  return dir
}

export function getPluginCatalog(profile = 'sdk') {
  const profileDir = getProfileDirectory(profile)
  const pkgPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')

  let manifest = { dependencies: {}, dsh: { profile: { bundles: [] } } }
  try {
    manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    console.warn('[PluginManager] Failed to read package.json:', e)
  }

  const configuredBundles = new Set(manifest?.dsh?.profile?.bundles ?? [])
  const installedDeps = manifest?.dependencies ?? {}

  let patches = []
  try {
    const rawPatch = readFileSync(patchPath, 'utf8')
    patches = YAML.parse(rawPatch) || []
  } catch (e) {
    console.warn('[PluginManager] Failed to read cordis.patch.yml:', e)
  }

  // Map known bundles
  const knownNames = new Set(KNOWN_BUNDLES.map(b => b.name))
  const bundles = KNOWN_BUNDLES.map(b => {
    const isConfigured = configuredBundles.has(b.name)
    const isDep = Boolean(installedDeps[b.name])
    return {
      ...b,
      enabled: b.core ? true : isConfigured,
      installed: b.core ? true : (isDep || isConfigured),
      version: installedDeps[b.name] || 'bundled',
    }
  })

  // Add any user-installed extra dependencies
  for (const [depName, version] of Object.entries(installedDeps)) {
    if (!knownNames.has(depName)) {
      bundles.push({
        name: depName,
        title: depName,
        description: `用户自定义安装插件 (${version})`,
        category: 'custom',
        core: false,
        enabled: configuredBundles.has(depName),
        installed: true,
        version: String(version),
      })
    }
  }

  return {
    profile,
    profileDir,
    dshHome: resolveDshHomePath(),
    dshRoot: DSH_ROOT,
    bundles,
    patches: Array.isArray(patches) ? patches : [],
  }
}

export async function toggleBundle({ profile = 'sdk', name, enabled }) {
  const profileDir = getProfileDirectory(profile)
  const pkgPath = join(profileDir, 'package.json')

  let manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!manifest.dsh) manifest.dsh = {}
  if (!manifest.dsh.profile) manifest.dsh.profile = {}
  if (!Array.isArray(manifest.dsh.profile.bundles)) manifest.dsh.profile.bundles = []

  const currentBundles = new Set(manifest.dsh.profile.bundles)
  if (enabled) {
    currentBundles.add(name)
  } else {
    currentBundles.delete(name)
  }

  manifest.dsh.profile.bundles = Array.from(currentBundles)
  writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  broadcast({
    type: 'plugin-status',
    action: 'toggle-bundle',
    name,
    enabled,
    profile,
  })

  return { ok: true, name, enabled, catalog: getPluginCatalog(profile) }
}

export async function togglePatchPlugin({ profile = 'sdk', id, name, enabled }) {
  const profileDir = getProfileDirectory(profile)
  const patchPath = join(profileDir, 'cordis.patch.yml')

  let patches = []
  try {
    const rawPatch = readFileSync(patchPath, 'utf8')
    patches = YAML.parse(rawPatch) || []
    if (!Array.isArray(patches)) patches = []
  } catch {
    patches = []
  }

  const existingIndex = patches.findIndex(p => p.id === id)
  if (existingIndex >= 0) {
    patches[existingIndex].disabled = !enabled
  } else {
    patches.push({
      id,
      name: name || undefined,
      disabled: !enabled,
    })
  }

  writeFileSync(patchPath, YAML.stringify(patches), 'utf8')

  broadcast({
    type: 'plugin-status',
    action: 'toggle-plugin',
    id,
    enabled,
    profile,
  })

  return { ok: true, id, enabled, catalog: getPluginCatalog(profile) }
}

export function executeCommand(cmd, argsList, cwd, onLog) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const child = isWin
      ? spawn(`${cmd} ${argsList.map(a => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`, {
          cwd,
          shell: true,
          env: { ...process.env },
        })
      : spawn(cmd, argsList, {
          cwd,
          shell: false,
          env: { ...process.env },
        })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', data => {
      const text = data.toString()
      stdout += text
      if (onLog) onLog(text, 'stdout')
    })

    child.stderr.on('data', data => {
      const text = data.toString()
      stderr += text
      if (onLog) onLog(text, 'stderr')
    })

    child.on('close', code => {
      if (code === 0) {
        resolve({ code, stdout, stderr })
      } else {
        const err = new Error(`Command ${cmd} exited with code ${code}\n${stderr || stdout}`)
        err.code = code
        err.stdout = stdout
        err.stderr = stderr
        reject(err)
      }
    })

    child.on('error', err => {
      reject(err)
    })
  })
}

export async function inspectPlugin({ spec, registry }) {
  const argsList = ['view', spec, '--json']
  if (registry) {
    argsList.push('--registry', registry)
  }
  try {
    const { stdout } = await executeCommand('pnpm', argsList, process.cwd())
    const parsed = JSON.parse(stdout)
    const latest = Array.isArray(parsed) ? parsed.at(-1) : parsed
    return {
      ok: true,
      info: {
        name: latest.name || spec,
        version: latest.version || 'unknown',
        description: latest.description || '',
        homepage: latest.homepage || '',
        dsh: latest.dsh || null,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
    }
  }
}

export async function installPlugin({ profile = 'sdk', spec, registry, onLog }) {
  const profileDir = getProfileDirectory(profile)
  const argsList = ['add', spec]
  if (registry) {
    argsList.push('--registry', registry)
  }

  const logHandler = (chunk, stream) => {
    if (onLog) onLog(chunk, stream)
    broadcast({
      type: 'plugin-install-log',
      spec,
      stream,
      chunk,
    })
  }

  logHandler(`[DSH_PLUGIN_MANAGER] 开始在 profile [${profile}] 中安装: ${spec}\n`, 'stdout')

  const result = await executeCommand('pnpm', argsList, profileDir, logHandler)

  // After successful install, activate into bundles
  const pkgPath = join(profileDir, 'package.json')
  let manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (!manifest.dsh) manifest.dsh = {}
  if (!manifest.dsh.profile) manifest.dsh.profile = {}
  if (!Array.isArray(manifest.dsh.profile.bundles)) manifest.dsh.profile.bundles = []

  // Extract base package name from spec
  const baseName = spec.replace(/@[^@]+$/, '').trim() || spec
  const installedBundles = new Set(manifest.dsh.profile.bundles)
  installedBundles.add(baseName)
  manifest.dsh.profile.bundles = Array.from(installedBundles)

  writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  logHandler(`[DSH_PLUGIN_MANAGER] 插件 ${spec} 安装成功并已自动激活！\n`, 'stdout')

  broadcast({
    type: 'plugin-status',
    action: 'install',
    spec,
    profile,
  })

  return {
    ok: true,
    spec,
    output: result.stdout,
    catalog: getPluginCatalog(profile),
  }
}

export async function removePlugin({ profile = 'sdk', name, onLog }) {
  const profileDir = getProfileDirectory(profile)
  const logHandler = (chunk, stream) => {
    if (onLog) onLog(chunk, stream)
    broadcast({
      type: 'plugin-install-log',
      spec: name,
      stream,
      chunk,
    })
  }

  logHandler(`[DSH_PLUGIN_MANAGER] 正在从 profile [${profile}] 卸载: ${name}\n`, 'stdout')

  // Remove from bundles
  const pkgPath = join(profileDir, 'package.json')
  let manifest = JSON.parse(readFileSync(pkgPath, 'utf8'))
  if (manifest?.dsh?.profile?.bundles) {
    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(b => b !== name)
    writeFileSync(pkgPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  }

  // Remove dependency if present
  if (manifest?.dependencies && manifest.dependencies[name]) {
    await executeCommand('pnpm', ['remove', name], profileDir, logHandler).catch(e => {
      console.warn('[PluginManager] pnpm remove warning:', e.message)
    })
  }

  logHandler(`[DSH_PLUGIN_MANAGER] 插件 ${name} 卸载完成。\n`, 'stdout')

  broadcast({
    type: 'plugin-status',
    action: 'remove',
    name,
    profile,
  })

  return {
    ok: true,
    name,
    catalog: getPluginCatalog(profile),
  }
}
