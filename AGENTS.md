# AGENTS.md — Atrium 智役中庭

> 面向 AI Agent / 协作者的仓库级工作契约。本文件优先于口头约定；
> 与 `README.md` 冲突时，以本文件为准（并顺手提 PR 修 README）。

## 0. 一句话定位

Atrium 是 **AI Agent Harness 桌面应用**：`React 18 + Vite` 表现层跑在
`Tauri 2 / WebView2` 壳里，`Rust` 做原生主控，真正的智能体运行时是
vendored `deepseek-harness`（`dsh --profile sdk`），经由自包含 Node 桥接
（`@atrium/desktop-host`）以 stdio JSON-RPC 驱动。**Atrium 永远不绕过内核
直连模型 API。**

```
React UI  ──Tauri IPC (invoke / kernel-stream-event)──>  Rust (src-tauri/src)
   │  ↕ ws://127.0.0.1:19387 (容灾热备通道)
   └─> Bridge (Node, resources/bridge) ──stdio JSON-RPC──> dsh kernel exe
                                                            (+ -rg sidecar)
```

## 1. 工程铁律（违反即返工）

1. **包管理只用 pnpm**（`packageManager: pnpm@11.7.0`，workspace 根见
   `pnpm-workspace.yaml`）。禁用 npm / yarn / cnpm。
2. **Node ≥ 20 开发；分发内置 Node 24 单文件运行时。** 不要升级根
   `package.json` 的运行时假设而不更新 `README` 与 `bundle-runtime.mjs`。
3. **Zero-Pollution 内核宪章**：`deepseek-harness/`（`.gitignore` 忽略的上游
   纯净检出）内**禁止改任何业务代码**。定制一律走
   `packages/atrium-core/profiles/atrium-desktop/*.cordis.patch.yml`
   有序 `--patch` 叠加。改前先跑 `pnpm sync:upstream` 确认工作树干净。
4. **三处版本号必须同改**：`package.json.version`、
   `src-tauri/tauri.conf.json.version`、`src-tauri/Cargo.toml.version`
  （`Cargo.lock` 由 cargo 同步）。产物名 `智役中庭_<版本>_x64-setup.exe`
   与 About 页都依赖它。
5. **Tauri 命令是唯一前后端契约**：前端只许 `invoke()` 已在
   `src-tauri/src/lib.rs` `generate_handler!` 注册的命令；新增命令必须同时改
   `src-tauri/src/commands/*_cmd.rs` + `lib.rs` + 前端调用点 + capability（如需）。
6. **界面零硬编码文案**：用户可见中文/英文一律走 `src/locales/`，跑通
   `pnpm i18n:check` 才算完。
7. **不要提交构建产物与日志**：`dist/`、`src-tauri/target/`、
   `src-tauri/resources/`、`.kernel-build/`、`.kernel-dist/`、`*.log`、
   `deepseek-harness/`、`ZCode/` 全部 gitignored。`build-*.log` 只放本地看。

## 2. 常用命令（PowerShell）

```powershell
pnpm dev                  # Vite 前端，http://localhost:1420（strictPort）
pnpm tauri:dev            # 完整桌面联调（会拉起 Rust + Bridge + 内核）
pnpm build                # tsc && vite build（发版前必过）
pnpm i18n:check           # 文案 key 对齐/引用检查（CI 等同）
pnpm sync:upstream        # 上游内核干净度 + Cordis profile 检查
pnpm sync:upstream -- --fetch   # 再查上游新 Tag
pnpm prepare:kernel       # 内核安装与构建准备
pnpm run build:kernel-exe       # 打单文件内核 exe（首次 20–40 分钟，有缓存秒退）
pnpm run build:kernel-exe -- --force  # 强制重建内核
pnpm bundle:runtime       # 暂存 bridge/cordis/node/kernel 到 src-tauri/resources/
pnpm tauri:build          # = tauri build --config src-tauri/tauri.build.conf.json --bundles nsis
```

> `tauri:build` 的 `beforeBuildCommand` 已自动跑 `bundle:runtime`。
> `--bundles nsis` 只出 NSIS；要 MSI 把它换成 `msi`/`all`（压缩耗时翻倍）。
> **不要 `tauri dev` 与 `bundle:runtime`/`tauri:build` 并行**：暂存会写
> 255MB+ exe 到 `src-tauri/resources/`，dev 的文件监视会疯狂重启。

## 3. 目录心智模型

```text
src/                      # React 18 + TS 表现层（strict, ES2020, react-jsx）
  components/             # 通用岛屿式 UI（TopBar/Sidebar/PromptCard/TerminalPanel…）
  features/               # 按域聚合：git / sessions / settings / terminal / modals
  hooks/                  # useSessionState/useTerminalState/useKernelStreams…
  services/dshClient.ts   # 内核事件星型多路复用：Tauri IPC 主通道 + WS 热备
  locales/                # zh-CN（默认/fallback）+ en，index.ts 管检测与切换
  themes/                 # 主题注册表（加主题只改这里 + i18n + styles.css）
  commands/registry.ts    # 命令面板注册表
src-tauri/                # Rust 宿主（edition 2021, rust-version 1.77）
  src/lib.rs              # invoke_handler 唯一注册表 + 退出时杀桥接/内核
  src/commands/           # *_cmd.rs 按域拆分（settings/session/project/soul/…）
  src/{daemon,orchestration,storage,terminal,git,tokens}.rs
  tauri.conf.json         # 日常开发配置（含 NSIS 图标，见 §6）
  tauri.build.conf.json   # 打包覆盖层：--config 合并，resources 指向 kernel/
  capabilities/default.json # 权限白名单（core:default + dialog:default）
packages/
  atrium-core/            # Cordis profile 与 patch（零污染定制的唯一入口）
  atrium-desktop-host/    # Node 桥接（HTTP 19387 + WS + stdio JSON-RPC 拉内核）
scripts/                  # mjs 流水线：sync/bundle/build-kernel/check-i18n…
public/fonts/             # OFL 1.1 三字体本地自托管（离线可用，勿删）
```

## 4. 前端约定

- **入口**：`src/main.tsx` 包 `ErrorBoundary + ToastProvider + StrictMode`；
  状态粘在 `src/App.tsx`，重逻辑必须下沉到 `hooks/` 或 `features/`，
  App 只做装配。
- **重型面板懒加载**：Settings / Git / WorkspaceTree / Terminal / Grainient
  一律 `React.lazy`（与 `vite.config.ts` 的 `vendor-3d/vendor-term/vendor-md`
  manualChunks 配对）。新增 >100KB 依赖先问：能否懒载、能否进已有 chunk。
- **i18n**：`useTranslation()` + `t("settings.providerBtn")`；插值留在文案里
  （`t("project.dispatchCount", { count })`）；顶层 key 按模块分
  `common/topbar/sidebar/home/prompt/terminal/dialog/about/souls/project/
  settings/app`，**禁往 `common` 堆**。`{{...}}` 占位符原样保留。
  `check-i18n.mjs` 校验：双语 key 全等、代码引用 key 必存在、未引用 key 告警。
- **主题**：`src/themes/index.ts` 是唯一真源；新增主题 = 加 `ThemeDefinition`
  + i18n 名/描述 + `[data-theme="<id>"]` CSS 变量块。`locales/index.ts` 的
  `load: "currentOnly"` 与 detector 顺序不得改（动了 `t()` 会回退成 raw key）。
- **样式**：岛屿式布局、浮动面板、圆角卡片；OFL 字体走 `public/fonts/`。
  `decorations: false`（无边框窗），窗口控制走 `minimize/toggle_maximize/close_window`。

## 5. Rust / IPC 约定

- 新增 Tauri 命令三步：`src-tauri/src/commands/<域>_cmd.rs` 实现 →
  `commands/mod.rs` 导出 → `lib.rs` `generate_handler!` 注册。前端经
  `@tauri-apps/api/core` 的 `invoke()` 调用，事件经 `kernel-stream-event`
  下发（`dshClient.ts` 做 IPC/WS 双通道去重，recent keys 上限 200）。
- `AppState` 常驻 `http`（120s）与 `kernel_http`（900s，长 tool-turn 专用）；
  不要把长因子的 agent-turn 挂到短 client 上。
- 进程退出语义：`RunEvent::Exit` 时 `block_on(daemon.stop())`，
  **桥接与内核不许比壳活得久**。
- PTY 终端由 `portable-pty` 驱动，cwd 跟随当前项目；git 操作收敛在
  `git.rs` + `git_cmd.rs`，前端只调命令不拼 shell。
- `windows-sys` 仅 `cfg(target_os = "windows")` 生效（JobObject/命名管道）；
  首要目标是 **Desktop / Windows x64**，Android 仅保 `minSdkVersion 24` 可配。
- dev-profile 已裁剪符号（`debug = line-tables-only` 等，见 Cargo.toml 注释）：
  为压 `link.exe` 超大 PDB；mobile 需要的 `staticlib+cdylib+rlib` 不可裁。

## 6. 打包 / 发版（含图标坑）

1. 三处 bump 版本（见 §1.4）。
2. `pnpm run build:kernel-exe`（commit 未变则命中 `.kernel-dist/.built-from`
   缓存秒退；变了才重打 20–40 分钟）。
3. `pnpm tauri:build`（自动 `bundle:runtime`，出
   `target/release/bundle/nsis/智役中庭_<版本>_x64-setup.exe`，约 100MB）。
4. 发前验证：`curl http://127.0.0.1:19387/healthz` 须 `kernel: ready` 且
   `kernelMode: exe`；建议 `/S /D=<临时目录>` 静默装测后再分发。
- **NSIS 图标四件套**（`bundle.windows.nsis`，两份 conf 都要写，
  路径相对 `src-tauri/`）：
  `installerIcon/uninstallerIcon → icons/icon.ico`（与 `public/favicon.ico`
  同文件）；`headerImage → icons/nsis-header.bmp`（150×57 24bit）；
  `sidebarImage → icons/nsis-sidebar.bmp`（164×314 24bit）。
  NSIS 不认 PNG，BMP 用白底垫透明；换 logo 先跑 `scripts/regen-icons.ps1`
 （源 `Atrium.png`），再重出两张 BMP。`installer.nsi` 里对应
  `!define` 为空即回退默认图标，打包后必查。
- `src-tauri/resources/` 是暂存区（bridge/cordis/node/kernel + manifest），
  gitignored；`bundle:runtime` 永远暂存内核，缺 `.kernel-dist/` 直接 FAIL，
  不允许出无核包。

## 7. 内核 / 桥接红线

- 与内核的全部交互收敛在 SDK 协议（`initialize / session/prompt /
  session.event`）；桌面侧不做内核内改造。
- 桥接默认端口 **19387**（`dshClient.ts` + Rust daemon 共用假设），改端口
  必须双端同改并更新 README 验证节。
- token 计量：内核上报优先，缺失回退本地估算；按模型×项目双维度记。
- `bundle-runtime.mjs` 的 Windows 删除走 robocopy 镜像清空（长路径/锁文件
  陷阱），不要换成天真 `rm -rf`；**禁止把 workspace 树整棵拷进 resources**
 （pnpm junction 会炸出数百万文件，见该脚本注释）。

## 8. Agent 工作流

- 先读：改 UI 看 `src/features|components`；改 IPC 看 `lib.rs` 注册表；
  改内核行为看 `packages/atrium-desktop-host/src` + Cordis patch；
  改打包看两份 `tauri.*.conf.json` + `scripts/bundle-runtime.mjs`。
- 改完必跑：`pnpm build`（tsc+vite）→ 动文案加跑 `pnpm i18n:check` →
  动 Rust 跑 `cargo check`（在 `src-tauri/` 下）→ 动打包跑一次
  `pnpm tauri:build` 并验 `installer.nsi` 四图标 + `/healthz`。
- 提交信息：`<域>: <动词+结果>`（如 `nsis: wire favicon into installer icon`）；
  大改同步更新本文件与 README 对应章节。
- 不确定就问，不要猜端口、路径、profile 名；`ZCode/` 是本地参考检出，
  不参与构建，别引它。
