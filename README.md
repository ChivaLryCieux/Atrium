# Atrium // 智役中庭

> **Atrium (AI Agent Harness Terminal)** 是一个基于 DeepSeek Harness (`dsh`) 内核、Cordis 微内核架构、Rust Tauri 2 与 React 18 构建的工程级智能体装具与编排终端。优先面向 **Desktop / Windows 桌面端**，为复杂研发、推理与多模型协同任务提供严谨、可预测、高信息密度的 AI 编排能力。

---

## 核心定位

Atrium 定位于与 **Codex、ZCode、Antigravity** 同类型的 **AI Agent Harness（智能体装具）** 应用：
- **真实内核驱动 (Real Kernel Runtime)**：桌面壳通过官方 `@deepseek-ai/dsh-sdk-client` 以 stdio JSON-RPC 拉起 vendored `deepseek-harness` 的 `dsh --profile sdk` 运行时，会话、工具与模型调度全部由 dsh 内核执行，Atrium 不再绕过内核直连 API。
- **装具化调度 (Harness & Dispatch)**：每个智能体作为一个标准化算子槽位（Slot），支持专属凭据、模型参数与工程约束；多轮上下文由内核会话（Session）持有。
- **确定性 DAG 流水线 (Deterministic DAG Pipeline)**：多节点协同流水线（探针 Probe -> 拓展 Synthesis -> 审校 Critique）逐节点推进内核会话，节点输出以流式增量实时渲染。
- **全向并行群测 (Parallel Concurrency)**：多智能体同态输入并列响应，用于基准对比与多样性探索。
- **直连兜底 (Direct Fallback)**：内核不可用（未构建/无 Node）时自动回退 OpenAI 兼容直连通道，产品保持可用。
- **Cordis 微内核扩展 (Zero-Pollution Microkernel)**：通过外置的 `@aria/dsh-plugin-desktop` 与 Cordis Profile (`aria-desktop`) 实现无侵入热插拔定制，上游 `deepseek-harness` 仓库保持 0 代码污染。

---

## 视觉与工程美学：砼核粗野主义 (Concrete Core Brutalism)

Atrium 采用冷静、克制、硬核的**粗野主义（Brutalism）**与**砼核（Béton Brut）**美学：
- **胶片颗粒与水泥噪点覆层 (Film Grain & Noise Texture)**：SVG `feTurbulence` 分形噪点遮罩，模拟工业冷钢与现浇水泥表面质感。
- **纯直角机械装具排版 (0px Radius / Precision Geometry)**：坚固冷硬的结构分割线、等宽字体（Monospace）遥测标线与工业状态指示灯。
- **桌面级工作台布局 (Desktop-First Ergonomics)**：为 Windows 桌面设计的多窗格装具插槽、中央执行遥测流与内核装具检查器（Harness Inspector）。

---

## 架构概览

```text
Atrium 桌面工作台 (Desktop Host)
├── 表现层 (React 18 + TypeScript + Vite)
│   ├── 胶片颗粒滤镜层 (Film Grain Overlay)
│   ├── 算子槽位管理器 (Agent Harness Slots)
│   ├── 执行遥测流 (Brutalist Execution Stream)
│   ├── 装具内核遥测 (Harness Inspector)
│   └── DSH WebSocket 流式客户端 (dshClient.ts)
│
├── 宿主层 (Rust + Tauri 2.0)
│   ├── 内核桥接进程托管 (daemon.rs: spawn/探活/退出回收)
│   ├── 确定性编排拓扑服务 (orchestration.rs: 内核路由 + 直连兜底)
│   ├── 原生系统遥测与 Explorer 集成 (commands.rs)
│   └── 本地配置与状态持久化 (storage.rs)
│
└── 内核层 (DeepSeek Harness / Cordis Microkernel)
    ├── 内核桥 (@aria/desktop-host: SDK stdio 运行时 + HTTP/WS 桥面)
    ├── 核心运行时 (deepseek-harness upstream) - [ZERO POLLUTION]
    ├── SDK 协议 (@deepseek-ai/dsh-sdk-client: initialize/session/prompt)
    └── Cordis Profile (@aria/profile-desktop + cordis.patch.yml)
```

### 内核数据流

```text
React UI ──Tauri IPC──> Rust 编排 ──POST /v1/turn──> @aria/desktop-host
                                                          │ DeepSeekHarness.run()
                                                          ▼
                                        dsh --profile sdk (stdio JSON-RPC 子进程)
                                                          │ session.event
React UI <──WS /events── 桥接广播 assistant-stream 增量 ◄──┘
```

---

## 常用命令

```powershell
# 安装 monorepo 依赖
pnpm install

# 检查与同步上游 deepseek-harness 引擎 (保持零污染)
pnpm run sync:upstream
pnpm run sync:upstream -- --fetch

# 构建内核（安装并编译 vendored deepseek-harness，桥接层运行的前提）
pnpm run prepare:kernel

# 启动桌面端开发调试 (Windows Desktop，秒级增量编译)
pnpm run tauri:dev

# 前端单独构建与类型校验
pnpm run build
```

打包与分发见下一节。

---

## 打包与分发

### 两种打包形态

| 形态 | 内容 | 安装包体积 | 适用场景 |
| --- | --- | --- | --- |
| **轻量包** | 仅内核桥接层 + 内置 Node 运行时；检测不到 dsh 内核时自动回退直连 API 通道 | ~26 MB | 自用/内部（本机已有内核检出） |
| **完整包** | 额外内嵌完整 dsh 内核（~1.9 GB 运行树，约 27 万个文件） | 预计 ~550–750 MB（压缩后） | **分发给他人**（对方无需任何环境） |

两种形态的产品功能一致：完整包让会话由 dsh 内核驱动（工具、权限、多轮上下文），轻量包走直连兜底。

### 前置条件

```powershell
pnpm install
pnpm run prepare:kernel     # 安装并构建 vendored dsh 内核（完整包必需）
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
# 1. 暂存内核到打包资源目录（约 2 GB / 27 万文件，数分钟）
pnpm run bundle:runtime -- --with-kernel

# 2. 打包（附带内核资源映射，仅出 NSIS 安装器）
pnpm tauri:build:full
# 产物: src-tauri/target/release/bundle/nsis/Atrium_<版本>_x64-setup.exe
```

工作机制与注意事项：

- **首次暂存会做一次性重链接**：内核的 pnpm 依赖默认用 NTFS junction 链接，安装器无法重建 junction，因此脚本会把 `deepseek-harness/node_modules` 重装为 hoisted 布局（真实文件）。该操作只影响未跟踪的 `node_modules`，vendored 仓库本身始终保持零污染（脚本会临时写入并在完成后立即还原 `pnpm-workspace.yaml`）。
- **`tauri:build:full`** = `tauri build --config src-tauri/tauri.build.conf.json --bundles nsis`。`tauri.build.conf.json` 只是在一份不含内核的基础配置上**追加**内核资源映射，因此日常 `tauri:dev` 与轻量构建都不受内核体积拖累。要 MSI 就把 `--bundles nsis` 换成 `msi`（或 `all`，但压缩耗时约翻倍）。
- **暂存模式**：`bundle:runtime` 默认是 auto 模式——已暂存内核则保留（`tauri build` 前置钩子不会把它清掉），否则按轻量暂存；用 `pnpm run bundle:runtime -- --light` 可主动清掉已暂存的内核回到轻量态。
- **不要与 dev 并行**：暂存会向 `src-tauri/resources/` 写入几十万个文件，`tauri dev` 会监视该目录并反复重启应用，同时两边的磁盘争用会拖慢一切。请在打包完成后再启动 dev。
- **耗时预期**：Rust 增量编译约 1–2 分钟；主要耗时在 NSIS 用 LZMA 压缩约 2 GB 数据，通常 15–25 分钟（跳过 MSI 可省掉另一遍同等压缩）。

### 验证安装包

```powershell
# 启动应用后查询内核桥接状态
curl http://127.0.0.1:19387/healthz
```

- 完整包应返回 `"kernel":"ready"`（dsh 运行时已挂载）。
- 轻量包返回 `"kernel":"missing"`，此时 AI 请求自动走直连通道，产品仍可用。

打包后的运行时会随安装包分发到应用的资源目录：`bridge/`（自包含内核桥接）、`node/`（Node 运行时）、`kernel/`（完整包才含内核本体）、`cordis/`（人格覆写补丁）。

---

## 上游无污染同步机制 (Zero-Pollution Sync Policy)

1. **绝对隔离**：`deepseek-harness/` 保持为官方纯净克隆，不在该目录内修改任何业务代码。
2. **Profile 叠加**：内核定制通过有序 `--patch` 覆写文件（`packages/aria-core/profiles/aria-desktop/atrium-sdk.cordis.patch.yml`）声明式注入 SDK 运行时。
3. **进程边界**：Atrium 与内核之间的全部交互收敛在官方 SDK 协议（initialize / session/prompt / session.event），桌面侧不做任何内核内改造。
4. **一键同步**：运行 `pnpm run sync:upstream` 自动校验目录干净度、检测上游新 Tag 并验证 Cordis Profile 兼容性；`pnpm run prepare:kernel` 负责内核安装与构建。
