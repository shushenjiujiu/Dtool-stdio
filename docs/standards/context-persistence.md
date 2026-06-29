# 上下文固化标准：开发侧 (Context Persistence — Developer View)

> 制定人：助手二号 | 版本 v0.1 | 2025-06-26
>
> 依据原则：**上下文固化** — 关键信息必须写入持久文件，不得依赖 session 内存或 Agent 间口头传递。

---

## 1. 问题

Session reset 后，Agent 丢失全部上下文。MEMORY.md 仅存压缩摘要——丢失了人类原话、决策理由、接口约定。Agent 在新 session 里基于残存摘要开工，方向必然漂移。

**本文件定义：开发侧什么信息必须写入持久文件、写入哪里、按什么格式。**

---

## 2. 持久化分层

```
仓库根目录 /
├── CHARTER.md          ← Heye 原话 + 硬约束 + North Star（不可变）
├── MEMORY.md           ← 施工日志 + 决策结论（压缩摘要）
├── docs/
│   ├── adr/            ← 架构决策记录（每条一个文件）
│   │   ├── 001-dag-engine.md
│   │   └── 002-composite-modules.md
│   └── interfaces/     ← 模块接口约定（跨 package 契约）
│       ├── engine-server.md
│       └── server-studio.md
```

| 文件 | 写入者 | 内容性质 | 更新频率 |
|------|--------|----------|----------|
| CHARTER.md | 管理员（Heye 批准） | 不变项：愿景、硬约束、Heye 原话 | 每重大决策 |
| MEMORY.md | 各 Agent 自己 | 可变项：施工进度、决策结论 | 每日/每次交付 |
| docs/adr/*.md | 决策参与者 | 不可变项：决策记录 | 每次架构决策 |
| docs/interfaces/*.md | 接口双方 Agent | 约定项：跨包 API 契约 | 接口变更时 |

---

## 3. 必须固化的信息

### 3.1 需求原文

**规则**：Heye 的需求表述必须原话引入 CHARTER.md，不得转述。

**格式**：
```markdown
## Heye 原话 (2025-06-25)

> "dtool Studio 的目标是让安全工程师在浏览器里搭积木式组合 payload 处理管道。
>  不需要后端，纯前端 SPA + 单 Nginx 容器。"
```

**为什么转述不够**：转述丢失语气（"不需要" vs "暂时不做"）、丢失隐含约束（"单 Nginx 容器"隐含不可引入新服务）。

### 3.2 架构决策 → 代码实现映射

**规则**：每个影响代码结构的决策，必须在 ADR 中记录"决策影响了哪些文件"。

**格式**（`docs/adr/001-dag-engine.md`）：
```markdown
# ADR-001: DAG 执行引擎

## 决策
采用 Kahn 拓扑排序 + 线性自动连线。

## 影响代码
- `engine/src/types/dag.ts` — PortType, Wire, ExecutionNode, ExecutionGraph
- `engine/src/dag/dag-executor.ts` — topologicalSort + executeGraph
- `engine/src/dag/connection-resolver.ts` — deriveWires 线性推导
- `engine/src/dag/graph-builder.ts` — ResolvedPipeline → ExecutionGraph 桥梁
- `server/ws/execute.ts` — 已切换到 DAG 执行

## 确认
Heye, 2025-06-25
```

**目的**：新 session 里 Agent 看到一份代码文件（如 `graph-builder.ts`），能反向追溯到它为什么存在、哪个决策产生它。

### 3.3 模块接口约定

**规则**：跨 package（engine ↔ server ↔ studio）的接口必须文档化，记录双方的输入/输出契约。

**格式**（`docs/interfaces/engine-server.md`）：
```markdown
# 接口约定：engine ↔ server

## executeGraph → WebSocket 通信

### server 调用 engine
server/ws/execute.ts 调用 engine 的 executeGraph():
  输入: { graph: ExecutionGraph, signal: AbortSignal, callbacks: DagExecuteCallbacks }
  输出: Promise<Map<string, Record<string, unknown>>>

### callbacks 契约
engine 通过 callbacks 向 server 推送执行状态：
  onStepStart(nodeId, module)  — 步骤开始
  onStepComplete(nodeId, output) — 步骤完成
  onStepError(nodeId, error) — 步骤失败
  onLog(level, message) — 日志
  onProgress(percent) — 进度

### server 消费
server 将 callbacks 事件序列化为 WebSocket JSON 消息发送给 studio 前端。
消息格式见 server/ws/execute.ts 的 switch(msg.type) 分支。

## 变更历史
- 2025-06-25: 初始约定（助手二号 + 管理员）
```

**目的**：集成失败时（如 06-26），Agent 无需完整 context reload 就能诊断契约断裂。

---

## 4. Session 启动校准清单

新 session 启动后，Agent 必须按序读取：

1. **CHARTER.md** — 了解 North Star + 硬约束
2. **MEMORY.md** — 了解施工进度
3. **docs/adr/** — 最近的架构决策（按文件时间排序取最近 3 条）
4. **docs/interfaces/** — 本 Agent 涉及的接口约定

读取完成后发送校准确认信号（约定格式待 Manager 定义）。

---

## 5. 代码侧工具（待实现）

```
scripts/context-check.sh
  → 检查 CHARTER.md 是否存在且包含 `> ` 引用块
  → 检查 docs/adr/ 是否有至少一篇 ADR
  → 检查 docs/interfaces/ 是否覆盖所有跨包边界
  → 输出 checklist pass/fail
```
