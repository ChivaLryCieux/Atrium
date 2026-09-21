# Atrium: 智役中庭

> **Atrium (AI Agent Harness)** 是一个基于 **pnpm monorepo** 工程体系、DeepSeek Harness (`dsh`) 内核、Cordis 微内核架构、Rust Tauri 2 与 React 18 构建的工程级智能体驾驭应用。优先面向 **Desktop / Windows 桌面端**，为复杂研发、推理与多模型协同任务提供严谨、可预测、高信息密度的 AI 编排能力。

---

## 核心定位

Atrium 定位于与 **Codex、ZCode、Antigravity** 同类型的 **AI Agent Harness（智能体驾驭）** 应用：
- **真实内核驱动 (Real Kernel Runtime)**：桌面壳通过官方 `@deepseek-ai/dsh-sdk-client` 以 stdio JSON-RPC 拉起 vendored `deepseek-harness` 的 `dsh --profile sdk` 运行时，会话、工具与模型调度全部由 dsh 内核执行，Atrium 不再绕过内核直连 API。
- **驾驭化调度 (Harness & Dispatch)**：每个智能体作为一个标准化算子槽位（Slot），支持专属凭据、模型参数与工程约束；多轮上下文由内核会话（Session）持有。
- **确定性 DAG 流水线 (Deterministic DAG Pipeline)**：多节点协同流水线（探针 Probe -> 拓展 Synthesis -> 审校 Critique）逐节点推进内核会话，节点输出以流式增量实时渲染。
- **全向并行群测 (Parallel Concurrency)**：多智能体同态输入并列响应，用于基准对比与多样性探索。
- **直连兜底 (Direct Fallback)**：内核不可用（未构建/无 Node）时自动回退 OpenAI 兼容直连通道，产品保持可用。
- **Cordis 微内核扩展 (Zero-Pollution Microkernel)**：通过 Cordis Profile (`atrium-desktop`) 与有序 `--patch` 覆写文件实现无侵入热插拔定制，上游 `deepseek-harness` 仓库保持 0 代码污染。
- **嵌入式 PTY 终端 (Embedded PTY Terminal)**：工作台底部坞接 xterm.js 终端，由 Rust 侧 `portable-pty` 驱动真实 Shell 会话，工作目录跟随当前项目。
- **工程上下文管理 (Projects & Sessions)**：项目（默认工作目录）、多会话（与内核 Session 绑定）、Soul 人格（`SOUL.md`）三层上下文，全部本地持久化。
- **用量计量 (Token Metering)**：token 消耗按模型与项目双维度计量，内核上报用量优先，缺失时回退本地估算。

---

## 视觉与工程美学

当前界面为 **极简中性风格（1:1 Replica）**：中性灰阶画布、克制的圆角刻度（4–16px）、细分割线与聚焦态高对比描边；节点徽标与遥测标线使用等宽字体（JetBrains Mono）保留工业仪表质感。支持亮色 / 暗色 / 跟随系统三档主题与 13–15px 三档字号。

项目的设计演进方向为**砼核粗野主义（Concrete Core Brutalism）**——胶片噪点覆层、纯直角结构分割线与更硬朗的装具插槽排版；其中噪点遮层等元素尚未落地，以当前极简实现为准。

排版采用三款 SIL OFL 1.1 字体**本地自托管**（`public/fonts/`，随应用分发、离线可用）：西文与数字用 Linux Biolinum，中文自动回退 Noto Sans SC（思源黑体），代码与等宽遥测用 JetBrains Mono。

---

## 技术栈

| 层 | 选型 | 版本 |
| --- | --- | --- |
| 包管理 / 工程体系 | pnpm workspace + Corepack（`packageManager` 字段锁定） | pnpm 11.7.0 |
| 运行时 | Node（开发 ≥ 20；分发的桥接内置 Node 24 单文件运行时） | 24.19.0 |
| AI 内核 | vendored `deepseek-harness`，以 `dsh --profile sdk` 运行（零污染检出） | 0.1.6-alpha.2 |
| 内核 SDK | `@deepseek-ai/dsh-sdk-client`（stdio JSON-RPC） | 随内核检出 |
| 桌面宿主 | Tauri 2 + Rust（edition 2021，rust-version 1.77） | 2.11 |
| 表现层 | React 18 + TypeScript + Vite | 18.3 / 5.6 / 5.4 |
| 排版字体 | Linux Biolinum（西文）+ Noto Sans SC 思源黑体（中文）+ JetBrains Mono（等宽），OFL 1.1 本地自托管 | 见 `public/fonts/` |
| 嵌入式终端 | xterm.js + Rust `portable-pty` | 6.0 / 0.8 |
| 国际化 | i18next + react-i18next | 26 / 17 |
| 内核桥 | `@atrium/desktop-host`（esbuild 自包含 bundle + `ws`） | 0.2.0 |

---

## 架构概览

```text
Atrium 桌面工作台 (Desktop Host)
├── 表现层 (React 18 + TypeScript + Vite)
│   ├── 工作台布局 (TopBar / Sidebar / CenterHome / PromptCard)
│   ├── 设置与人格 (SettingsView / SoulManagerDialog)
│   ├── 嵌入式终端 (TerminalPanel: xterm.js + PTY)
│   └── DSH WebSocket 流式客户端 (dshClient.ts)
│
├── 宿主层 (Rust + Tauri 2.0)
│   ├── 内核桥接进程托管 (daemon.rs: spawn/探活/退出回收)
│   ├── 确定性编排拓扑服务 (orchestration.rs: 内核路由 + 直连兜底)
│   ├── 原生系统遥测与 Explorer 集成 (commands.rs)
│   └── 本地配置与状态持久化 (storage.rs)
│
└── 内核层 (DeepSeek Harness / Cordis Microkernel)
    ├── 内核桥 (@atrium/desktop-host: SDK stdio 运行时 + HTTP/WS 桥面)
    ├── 核心运行时 (deepseek-harness upstream) - [ZERO POLLUTION]
    ├── SDK 协议 (@deepseek-ai/dsh-sdk-client: initialize/session/prompt)
    └── Cordis Profile (@atrium/profile-desktop + cordis.patch.yml)
```

### 内核数据流

```text
React UI ──Tauri IPC──> Rust 编排 ──POST /v1/turn──> @atrium/desktop-host
                                                          │ DeepSeekHarness.run()
                                                          ▼
                                        dsh --profile sdk (stdio JSON-RPC 子进程)
                                                          │ session.event
React UI <──WS /events── 桥接广播 assistant-stream 增量 ◄──┘
```

---

## 工程结构（pnpm Monorepo）

```text
Atrium/
├── package.json / pnpm-workspace.yaml  # 根工作区 + 全部脚本入口（pnpm 11.7.0）
├── src/                                # 表现层（React 18 + TS + Vite）
│   ├── components/                     #   TopBar / Sidebar / CenterHome / SettingsView / TerminalPanel ...
│   ├── services/dshClient.ts           #   内核桥 WebSocket 流式客户端
│   ├── locales/                        #   i18next 双语（zh-CN 默认 / en）
│   └── types/ constants/ utils/        #   共享类型与工具
├── packages/
│   ├── atrium-desktop-host/            # @atrium/desktop-host：内核桥（HTTP + WS 桥面）
│   └── atrium-core/                    # @atrium/core：Cordis Profile（profiles/atrium-desktop/）
├── src-tauri/                          # 宿主层（Rust + Tauri 2）
│   ├── src/daemon.rs                   #   内核桥进程托管（Windows Job Object 进程树）
│   ├── src/orchestration.rs            #   编排路由（内核优先 + 直连兜底）
│   ├── src/terminal.rs                 #   PTY 终端管理（portable-pty）
│   └── resources/                      #   打包暂存资源（bridge/node/kernel/cordis，gitignore）
├── scripts/                            # 工程脚本（内核构建 / 暂存 / 上游同步 / i18n 校验）
├── deepseek-harness/                   # vendored 上游内核检出 —— 零污染，禁止业务改动
└── dist/                               # 前端构建产物（gitignore）
```

---

## 常用命令

```powershell
# 安装 monorepo 依赖（Node ≥ 20，pnpm 版本由 packageManager 锁定）
pnpm install

# 检查与同步上游 deepseek-harness 引擎 (保持零污染)
pnpm run sync:upstream
pnpm run sync:upstream -- --fetch

# 构建内核（安装并编译 vendored deepseek-harness，桥接层运行的前提）
pnpm run prepare:kernel

# 构建内核单文件运行时（完整包必需，产物缓存在 .kernel-dist/）
pnpm run build:kernel-exe
pnpm run build:kernel-exe -- --force    # 强制重建

# 暂存内核（复制 2 个文件）
pnpm run bundle:runtime -- --with-kernel

# 启动桌面端开发调试 (Windows Desktop，秒级增量编译)
pnpm run tauri:dev

# 打包完整发行包（含内核，NSIS）
pnpm tauri:build:full

# 前端单独构建与类型校验
pnpm run build
```

---

## 打包与分发

### 两种打包形态

| 形态 | 内容 | 安装包体积 | 适用场景 |
| --- | --- | --- | --- |
| **轻量包** | 仅内核桥接层 + 内置 Node 运行时；检测不到 dsh 内核时自动回退直连 API 通道 | ~35 MB（含自托管字体，预估） | 自用/内部（本机已有内核检出） |
| **完整包** | 额外内嵌上游的**单文件 dsh 运行时**（一个 ~250 MB 可执行文件，Node 24 与整个内核闭包已内嵌，外加 ~6 MB ripgrep sidecar） | ~82 MB（含自托管字体，预估） | **分发给他人**（对方无需任何环境） |

两种形态的产品功能一致：完整包让会话由 dsh 内核驱动（工具、权限、多轮上下文），轻量包走直连兜底。

### 前置条件

```powershell
pnpm install                 # Node ≥ 20 + Corepack（pnpm 11.7.0 由 packageManager 锁定）
pnpm run prepare:kernel     # 安装并构建 vendored dsh 内核
pnpm run sync:upstream      # 可选：校验内核零污染并检测上游新版本
```

### 轻量包

```powershell
pnpm tauri:build
# 产物: src-tauri/target/release/bundle/nsis/Atrium_<版本>_x64-setup.exe
#       src-tauri/target/release/bundle/msi/Atrium_<版本>_x64_en-US.msi
```

### 完整包（分发给他人）

```powershell
# 1. 构建内核单文件运行时（约 20–40 分钟；产物缓存在 .kernel-dist/，内核未升级则跳过）
pnpm run build:kernel-exe

# 2. 暂存进打包资源目录（复制 2 个文件，秒级）
pnpm run bundle:runtime -- --with-kernel

# 3. 打包（附带内核资源映射，仅出 NSIS 安装器）
pnpm tauri:build:full
# 产物: src-tauri/target/release/bundle/nsis/Atrium_<版本>_x64-setup.exe
```

工作机制与注意事项：

- **内核以单文件形式分发**：`build:kernel-exe` 调用上游的 `scripts/build-exe-for-python-sdk.ts`（`@yao-pkg/pkg --sea` 模式），把 Node 24 运行时与整个 dsh 闭包打进一个可执行文件，`-rg` ripgrep sidecar 必须与之同目录。桥接层通过 SDK 的运行时刻度接口（`HarnessClient` 的 runtime descriptor）拉起它，不再需要任何内核源码树。
- **绝不要把内核工作区树直接复制进安装包**：pnpm 用 NTFS junction 链接依赖，复制时跟随这些链接会把文件数放大到数百万（实测 440 万），既让安装包失控，也会因为崩溃的依赖清单把 `tauri dev` 拖死。
- **构建在隔离克隆中进行**：上游的 deploy 步骤会把 workspace 包搬离检出目录（实测影响 6467 个文件），因此构建脚本总是在 `.kernel-build/` 的临时克隆里执行，vendored 仓库始终保持零污染。
- **两处 pnpm 11 适配**：上游脚本用 CLI `--config.*` 传参，而 pnpm 11 只从 `pnpm-workspace.yaml` 读这些键，构建脚本会把 `nodeLinker: hoisted`、`ignoreScripts: true`、`verifyDepsBeforeRun: false`、`confirmModulesPurge: false` 预先写进构建克隆——否则 devDependencies 会被生产安装裁掉、崩溃的 root postinstall 会中断流水线。
- **`tauri:build:full`** = `tauri build --config src-tauri/tauri.build.conf.json --bundles nsis`。`tauri.build.conf.json` 只是在一份不含内核的基础配置上**追加**内核资源映射，因此日常 `tauri:dev` 与轻量构建都不受内核体积拖累。要 MSI 就把 `--bundles nsis` 换成 `msi`（或 `all`，压缩耗时约翻倍）。
- **暂存模式**：`bundle:runtime` 默认是 auto 模式——已暂存内核则保留（`tauri build` 前置钩子不会把它清掉），否则按轻量暂存；用 `pnpm run bundle:runtime -- --light` 可主动清掉已暂存的内核回到轻量态。内核 exe 变更后重跑 `-- with-kernel` 即可。
- **不要与 dev 并行**：暂存会往 `src-tauri/resources/` 写入 255 MB 的 exe，`tauri dev` 会监视该目录并重启应用。请在打包完成后再启动 dev。
- **耗时预期**：内核 exe 首次 20–40 分钟（之后缓存复用）；NSIS 压缩 255 MB 数据通常几分钟。远小于原来的「小时级」。

### 验证安装包

```powershell
# 启动应用后查询内核桥接状态
curl http://127.0.0.1:19387/healthz
```

- 完整包应返回 `"kernel":"ready"` 且 `"kernelMode":"exe"`（单文件运行时已挂载）。
- 轻量包返回 `"kernel":"missing"`，此时 AI 请求自动走直连通道，产品仍可用。

打包后的运行时会随安装包分发，与 `atrium.exe` 同级：`bridge/`（自包含内核桥接 + 打包进来的 SDK 客户端）、`node/`（Node 运行时，桥接自身运行所需）、`kernel/`（完整包才含内核本体：单文件 exe 与 `-rg` sidecar）、`cordis/`（人格覆写补丁）。

---

## 发布新版本（版本更新流程）

### 1. 改版本号（共三处，缺一不可）

| 文件 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `src-tauri/tauri.conf.json` | `version` |
| `src-tauri/Cargo.toml` | `version` |

三处必须一致，否则产物文件名（`Atrium_<版本>_x64-setup.exe`）与 `about` 信息会对不上。桥接层的 `/healthz` 版本由 Rust 在启动时传入（`CARGO_PKG_VERSION`），不需要手工同步。

### 2. 判断是否需要重建内核

内核 exe 的缓存记录在 `.kernel-dist/.built-from`（记录 vendored 内核的 commit）。`build:kernel-exe` 会**自动比对**：

- **内核 commit 没变** → 直接复用缓存，跳到第 3 步（几秒完成）
- **内核 commit 变了**（执行过 `sync:upstream -- --fetch` 升级了内核）→ 自动重建，约 20–40 分钟
- 想强制重建：`pnpm run build:kernel-exe -- --force`

### 3. 打包

```powershell
pnpm run bundle:runtime -- --with-kernel   # 把内核 exe 暂存进资源目录（秒级）
pnpm tauri:build:full                      # 出完整 NSIS 安装包
```

> `tauri build` 的 `beforeBuildCommand` 会自动跑一次 `bundle:runtime`，此时是 **auto 模式**——
> 已暂存的内核会被保留，不会被清掉。所以上面两步的顺序一定是「先 `--with-kernel` 暂存，再打包」。

### 4. 验证后再分发

按上一节「验证安装包」确认 `kernel: "ready"` 且 `kernelMode: "exe"`，再发出安装包。
建议静默安装到临时目录实测一次（不污染正式环境）：

```powershell
.\Atrium_<版本>_x64-setup.exe /S /D=C:\Users\<你>\AppData\Local\Atrium-verify
curl http://127.0.0.1:19387/healthz
# 确认 kernel: ready 后，运行安装目录下的 uninstall.exe /S 卸载
```

### 版本更新速查

```powershell
# 改完上面三处版本号后：
pnpm run build:kernel-exe              # 内核没升级则命中缓存（秒退）
pnpm run bundle:runtime -- --with-kernel
pnpm tauri:build:full
```

---

## 多语言（i18n）与文案维护

界面文案全部收敛到 `src/locales/`，代码里不再出现硬编码文字，产品与策划可直接改 JSON。

```text
src/locales/
├── index.ts                    # i18next 初始化 + 语言切换 + LanguageDetector
├── zh-CN/translation.json      # 简体中文（默认 / fallback）
└── en/translation.json         # English
```

* **接入方式**：`import { useTranslation } from "react-i18next";` 后 `const { t } = useTranslation();`，模板里用 `t("settings.providerBtn")`；需要插值时把变量留在文案里：`t("project.dispatchCount", { count })`。
* **命名空间**：按界面模块划分顶层 key —— `common / topbar / sidebar / home / prompt / terminal / dialog / about / souls / project / settings / app`。新增界面模块时加一层同级命名空间，不要往 `common` 里堆。
* **语言切换**：设置 → 常规 → 界面语言，切换即时生效；选择写入 `localStorage["atrium.locale"]`，优先于系统语言。
* **文案校验**：

  ```powershell
  pnpm i18n:check
  ```

  该脚本会检查三件事并在 CI 里可直接用（失败返回非 0）：两种语言 key 完全对齐、代码里引用的 key 必须存在、列出已定义但未被引用的 key。
* **给非技术同事的改法**：只改 `zh-CN/translation.json` / `en/translation.json` 的值，不改 key（key 一改代码就引用不到）；`{{...}}` 占位符必须原样保留。改完跑一次 `pnpm i18n:check`。
* **不适合放进 JSON 的内容**：长文档（如宪章正文）建议后续改用 Markdown 承载；`console.error` 里的工程日志与错误码保留在代码中，只把面向操作员的提示接入 i18n。

---

## 内核定制宪章（Zero-Pollution）

1. **绝对隔离**：`deepseek-harness/` 保持为官方纯净克隆，不在该目录内修改任何业务代码。
2. **Profile 叠加**：内核定制通过有序 `--patch` 覆写文件（`packages/atrium-core/profiles/atrium-desktop/atrium-sdk.cordis.patch.yml`）声明式注入 SDK 运行时。
3. **进程边界**：Atrium 与内核之间的全部交互收敛在官方 SDK 协议（initialize / session/prompt / session.event），桌面侧不做任何内核内改造。
4. **一键同步**：运行 `pnpm run sync:upstream` 自动校验目录干净度、检测上游新 Tag 并验证 Cordis Profile 兼容性；`pnpm run prepare:kernel` 负责内核安装与构建。
