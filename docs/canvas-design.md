# dtool Studio 二维画布设计文档

> 状态：**草稿 — 待 Heye 审阅**
> 日期：2026-06-27

---

## 1. 设计理念

### 1.1 核心原则：一切皆模块，模块皆可连接

dtool Studio 是一套**可视化编程系统**。所有功能单元都是"模块"，模块有输入端口和输出端口，通过连线构成有向无环图（DAG）。画布不关心模块内部的实现——原子函数、线性管道、嵌套循环、复合模块——对外都是方块 + 端口。

### 1.2 渐进式复杂度（Progressive Disclosure）

**不要让用户一眼看到所有东西。** 模板/模块默认使用预设参数，内部细节折叠隐藏。需要时才逐层展开。

```
  表面层（默认）              展开一层                   深层
┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐
│  URL 编码链       │    │  URL 编码链       │    │ base64 编码   │
│  ─────────────   │    │  ┌─────────────┐ │    │ ⚙ encoding:  │
│  ▼ input         │    │  │ url_encode  │ │    │   standard   │
│  ▲ encoded        │    │  │     ↓       │ │    │   urlsafe    │
│                  │    │  │ base64      │ │    │   ...        │
│  双击查看内部 →   │    │  │     ↓       │ │    └──────────────┘
│                  │    │  │ wrap_json   │ │
│  [仅显示端口]     │    │  └─────────────┘ │
└──────────────────┘    └──────────────────┘
    方块 + 端口             内部步骤可见          单个模块参数可见
```

**规则：**

| 层级 | 看到什么 | 操作 |
|------|---------|------|
| 画布表面 | 模块方块 + 端口 | 拖拽、连线、运行 |
| 双击进入 | 内部子模块列表/画布 | 编辑内部拓扑 |
| 展开属性 | 模块的 config 参数 | 修改默认值 |
| 封装为模板 | 选择要提升的参数 | 自定义对外配置项 |

- **默认不暴露参数**：模板预设了合理的默认值，直接就能用
- **想改也能改**：点开属性面板，参数在那里，不改就不需要看
- **一层一层来**：使用者不会一下子面对几十个参数和嵌套结构

### 1.3 一维管道 vs 二维画布

| | 管道模式（Pipeline） | 画布模式（Canvas） |
|---|---|---|
| 布局 | 从上到下线性排列 | 自由二维定位 |
| 数据流 | 隐式传递（上一步→下一步） | 显式连线（端口→端口） |
| 分支/合并 | 不支持 | 支持（多入多出） |
| 适用场景 | 快速线性流程 | 复杂 DAG、并行、多输入源 |
| 关系 | **管道本身可作为模块放入画布** | 画布是最外层容器 |

当前 dtool-studio 的 Editor.tsx 只有管道模式。本文档设计画布模式的完整方案。

---

## 2. 模块类型体系

```
                    ModuleMeta（所有模块的对外接口）
                    ├── id, name, category, description
                    ├── inputs: PortDef[]
                    └── outputs: PortDef[]
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   AtomicModule      PipelineModule      LoopModule
   (原子模块)         (管道模块)          (循环模块)
     │                   │                  │
     │ handler:           │ steps:           │ config: { type, count,
     │   ModuleHandler    │   StepDef[]      │           foreachVar, ... }
     │                    │                  │ container:
     └── 不可再分         └── 内部是线性步骤  │   PipelineNode[]
                                             └── 内含可重复执行的子模块
```

### 2.1 原子模块（AtomicModule）

- **类比**：编程中的一条语句或内置函数
- **特点**：有 JS/TS handler，执行具体逻辑
- **例子**：`base64_encode`、`url_decode`、`json_parse`
- **引擎对应**：`RegisteredModule { definition: ModuleDef, handler: ModuleHandler }`

### 2.2 管道模块（PipelineModule）

- **类比**：编程中的一个函数（内部是多行语句）
- **特点**：内部是线性步骤序列（1D），对外暴露输入/输出端口
- **例子**：URL编码链 = `[url_encode → base64_encode → wrap_json]`
- **在画布上**：就是一个方块，端口和其他模块一样，可以连线
- **引擎对应**：`CompositeModule` + `createCompositeHandler()`
- **当前实现**：Editor.tsx 的 `wrap-as-module` 功能 → 将画布上的步骤封装成一个复合模块

### 2.3 循环模块（LoopModule）

- **类比**：编程中的 `for` / `while` / `foreach` 循环
- **特点**：内含一个管道（子模块列表），迭代执行
- **停止条件**：
  | 类型 | 说明 | 配置 |
  |------|------|------|
  | `count` | 固定次数 | `count: N` |
  | `foreach` | 遍历列表 | `foreachVar: "item"` |
  | `until` | 直到输出匹配 | `untilCondition: "success"` |
  | `timeout` | 超时停止 | `timeoutMs: 30000` |
- **引擎状态**：旧版 dtool 的 `LoopNode` 已有实现，dtool-studio 引擎层待补充
- **画布交互**：双击循环模块进入内部画布，内部也是一个二维画布（可放置任何模块，包括嵌套循环）

### 2.4 输入/输出模块（特殊）

- `input` 模块：数据入口，只有输出端口，无输入端口。配置为原始输入文本。
- `output` 模块：数据出口，只有输入端口，无输出端口。收集最终结果。
- 画布上至少有一个 `input` 和一个 `output` 才能执行。

### 2.5 端口自动推导（Port Derivation）

多个模块封装为复合模块/模板时，**不需要手动声明**复合模块的对外端口——引擎自动从未连接的端口推导。

**直觉模型：**

```
原子模块：                 连接后：                         对外暴露：
 ●──[url_encode]──▶    ●──[url_encode]──▶──●──[base64]──▶    ●──[url_encode→base64]──▶
 入             出       内部连接（不暴露）                     入                     出

 ●──[base64]──▶
 入          出
```

- 连线连上的端口 → **内部端口**，对外不可见
- 连线没连上的输入端口 → 复合模块的**对外输入**（箭头指向内）
- 连线没连上的输出端口 → 复合模块的**对外输出**（箭头指向外）

**引擎已有实现：** `port-derivation.ts` 的 `derivePorts()` 函数——

```typescript
// 伪代码
function derivePorts(internalSteps, internalWires) {
  externalInputs  = internalSteps 中 没有入线的 input 端口
  externalOutputs = internalSteps 中 没有出线的 output 端口
}
```

### 2.6 参数提升（Param Lifting）

端口推导解决了数据 I/O。但内部模块还有 **config 参数**（如 `base64_encode` 的 `encoding: standard|urlsafe`）。封装为模板后，这些参数怎么处理？

```
  封装前：                       封装后（作为方块）：
  ┌──────────────────────┐       ┌──────────────────┐
  │ url_encode           │       │  URL 编码链       │
  │  config: {}          │       │  ⚙ 编码方式: 标准  │  ← 来自 base64 内部
  │         ↓            │       │                  │
  │ base64_encode        │  ──▶  │  ▼ input         │
  │  config: {           │       │  ▲ encoded        │
  │    encoding: "标准"   │       └──────────────────┘
  │  }                   │
  └──────────────────────┘
```

**三种策略：**

| 策略 | 说明 | 适用 |
|------|------|------|
| 🔒 **锁定** | 参数值写死在模板内，不暴露 | 内部实现细节，用户无需关心 |
| 🔓 **提升** | 参数提升为模板的外部 param，用户可配置 | 影响行为的核心参数 |
| 🤖 **自动** | 默认锁定。封装时勾选要暴露的参数 | 最灵活 |

**默认行为（遵循渐进式复杂度）：** 封装时**全部锁定**——模板表面干净，只显示端口。用户拿过来就能直接用预设。需要自定义时，打开属性面板勾选"暴露为模板参数"，参数才出现在方块上。

```
  默认（锁定）：              用户展开属性面板后：
┌──────────────────┐       ┌──────────────────┐
│  URL 编码链       │       │  URL 编码链       │
│                  │       │  ⚙ 编码方式: 标准  │  ← 勾选后才出现
│  ▼ input         │       │  ⚙ 换行风格: LF   │
│  ▲ encoded        │       │  ▼ input         │
└──────────────────┘       │  ▲ encoded        │
                           └──────────────────┘
```

```yaml
# 封装后的模板 YAML
params:
  - key: encoding          # ← 来自内部 base64_encode.encoding
    label: 编码方式
    type: select
    default: standard
    options:
      - { label: 标准, value: standard }
      - { label: URL安全, value: urlsafe }
flow:
  steps:
    - id: s1
      module: url_encode
      config: {}
    - id: s2
      module: base64_encode
      config:
        encoding: $param.encoding   # ← 引用模板参数
```
## 3. 二维画布交互设计

### 3.1 画布行为

```
┌──────────────────────────────────────────────────────┐
│  Toolbar: [▶ 运行] [■ 取消] [撤销] [重做] [缩放: 100%]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│    ┌──────────┐                ┌──────────┐          │
│    │  IN      │                │ base64   │          │
│    │  input   │────data───────▶│ _encode  │──┐       │
│    └──────────┘                └──────────┘  │       │
│                                               │       │
│    ┌────────────────────────┐                 │       │
│    │  ⟳ 循环 (×3)          │                 │       │
│    │  ┌──────┐  ┌──────┐   │                 │       │
│    │  │ url  │─▶│ json │   │                 │       │
│    │  │encode│  │ wrap │   │                 │       │
│    │  └──────┘  └──────┘   │                 │       │
│    └────────────────────────┘                 │       │
│              │                                 │       │
│              │            ┌──────────┐         │       │
│              └──data─────▶│  OUT     │◀────────┘       │
│                           │  output  │                 │
│                           └──────────┘                 │
│                                                      │
│                    🖱 可平移 · 可缩放                  │
├──────────────────────────────────────────────────────┤
│  Sidebar: [模块库] [模板]                [属性面板: 折叠] │
└──────────────────────────────────────────────────────┘
```

**交互清单：**

| 操作 | 行为 |
|------|------|
| 从侧边栏拖入模块 | 在鼠标释放位置创建新节点 |
| 拖拽模块 | 自由移动位置（Drag） |
| 从端口拖出 | 创建连线（Wire），到目标端口释放 |
| 点击连线 | 选中，按 Delete 删除 |
| 双击模块 | 进入子编辑（管道模块→编辑步骤；循环模块→编辑循环体） |
| 滚轮 | 缩放（Zoom） |
| 拖拽空白区域 | 平移画布（Pan） |
| 右键空白区域 | 上下文菜单（添加模块/粘贴） |
| 右键模块 | 上下文菜单（复制/删除/禁用/封装为模块） |
| Ctrl+Z / Ctrl+Shift+Z | 撤销/重做 |
| Delete / Backspace | 删除选中元素 |

### 3.2 模块视觉设计

```
   ┌──────────────────┐
   │ ⬤  base64 编码    │  ← 标题栏（类别色带 + 模块名）
   │ ─────────────────│
   │  ▼ data          │  ← 输入端口（左侧，带类型标签）
   │                  │
   │  ▲ encoded       │  ← 输出端口（右侧，带类型标签）
   │ ─────────────────│
   │  ⚙ 编码方式: 标准  │  ← 可配置参数摘要（折叠）
   └──────────────────┘
        ▼ 紫色圆点 = 端口连接点（可拖拽连线）
```

**视觉规范：**
- 模块方块：圆角矩形，浅色背景，细边框
- 端口：小圆点（直径 10px），颜色按数据类型区分
- 连线：贝塞尔曲线，`#6a4c93` 主色，hover 高亮，running 时动画
- 类别色带：模块顶部 3px 色条，按 category 着色
- 状态指示：执行中→黄色边框脉动；完成→绿色勾；错误→红色边框

### 3.3 连线规则

- **类型检查**：`fromPort.type` 必须兼容 `toPort.type`（`any` 通配）
- **无环约束**：创建连线时实时检测是否会形成环，拒绝成环连线
- **一入多出**：一个输出端口可以连到多个输入端口（fan-out）
- **多入一端口**：不允许。一个输入端口只能有一条入线
- **悬空端口**：未连接的输入端口在运行时会得到 `undefined`

---

## 4. 技术选型

### 4.1 候选方案

| 方案 | 成熟度 | 学习成本 | 包体积 | 定制灵活度 | 生态 |
|------|--------|----------|--------|------------|------|
| **React Flow** | ⭐⭐⭐⭐⭐ | 低 | ~200KB gzip | 中高 | 极好 |
| **自研 SVG** | ⭐⭐ | 高 | 0 | 极高 | 无 |
| **自研 Canvas** | ⭐⭐ | 很高 | 0 | 极高 | 无 |

### 4.2 推荐：React Flow（@xyflow/react v12）

**理由：**

1. **开箱即用**：节点拖拽、平移缩放、连线、选中、快捷键——全部内置
2. **可定制**：自定义节点（Custom Node）、自定义边（Custom Edge）都支持 React 组件
3. **我们的节点正好是 React 组件**：dtool-studio 已有 `StepCard`，改造为 Custom Node 成本低
4. **包体积可控**：~200KB gzip，对 SPA 可接受
5. **与现有引擎对接简单**：React Flow 的 `nodes` + `edges` 结构可以直接映射到引擎的 `ExecutionGraph`
6. **活跃维护**：npm 周下载 150 万+，xyflow 团队持续迭代

**React Flow 数据结构映射：**

```typescript
// React Flow 的 Node
interface CanvasNode {
  id: string;              // → ExecutionNode.id
  type: string;            // → 'atomic' | 'pipeline' | 'loop' | 'input' | 'output'
  position: { x: number; y: number };
  data: {
    moduleId: string;      // → ExecutionNode.module
    config: Record<string, unknown>;  // → ExecutionNode.config
    label?: string;
    // 嵌套模块的内部结构
    steps?: StepDef[];     // pipeline/loop 类型才有
  };
}

// React Flow 的 Edge
interface CanvasEdge {
  id: string;
  source: string;          // → Wire.fromNode
  sourceHandle: string;    // → Wire.fromPort
  target: string;          // → Wire.toNode
  targetHandle: string;    // → Wire.toPort
}
```

### 4.3 为什么不自己写

- 节点图的平移/缩放/选中/框选/对齐/吸附/minimap——每一个都是坑
- React Flow 已经把这些坑填了 5 年
- 我们可以把精力花在模块设计和执行引擎上，不重复造轮子

---

## 5. 执行模型：Fail-Stop 级联中断

### 5.1 核心规则

dtool 采用**电路断路器（Fail-Stop）**执行模型，而非传统的"错误当数据传"：

```
                ┌──────────────────────────┐
  input ───────▶│                          │
                │  模块 C（需要 A + B）      │──────▶ D ──────▶ E
  input ───────▶│  如果 A ✅ 但 B ❌        │
                │  → C 不执行              │
                │  → D 也不执行            │
                │  → E 也不执行            │
                └──────────────────────────┘
```

**规则细则：**

| # | 规则 | 说明 |
|---|------|------|
| 1 | **多输入全满足** | 模块可以有多个输入端口。只有**所有**输入端都收到有效数据，模块才执行 |
| 2 | **单端口不合格即中断** | 任意一个输入端不符合要求（类型不匹配、上游报错、空值、校验失败）→ 模块不执行 |
| 3 | **错误不流入输出** | 报错信息**不会**作为该模块的输出数据交给下游。不像 Unix pipe 那样错误继续流 |
| 4 | **级联中断** | 模块不执行 → 其所有输出端口无数据 → 依赖这些端口的下游模块也收不到输入 → 也不执行 |
| 5 | **错误溯源可见** | 画布上红色高亮**第一个出错的节点**，下游被牵连的节点灰色显示，清楚区分根因和连带 |

**与常见模型的对比：**

| 模型 | 错误处理方式 | 例子 |
|------|-------------|------|
| Unix Pipe | 错误进入 stdout/stderr，下游可以读到 | `cat bad | grep x` — grep 仍运行 |
| Try/Catch | 上游抛异常，下游可以捕获并恢复 | `try { A() } catch { fallback() }` |
| Result/Option | 错误包装为值，下游判断 | `A().and_then(B)` — B 看到的是 Err |
| **dtool Fail-Stop** | **上游出错 → 本节点 + 全部下游沉默** | A❌ → B、C、D 都不执行 |

**设计意图：** dtool 是安全工具链，不是通用编程语言。安全场景下"不完整的数据不应被继续处理"——如果 SQL 注入 payload 构建过程中的某个环节失败了，不应该把残缺的 payload 提交给下一个模块。宁可什么都不输出，也不输出不确定的结果。

### 5.2 端口校验

每个输入端口在接收数据时进行校验：

```typescript
interface PortValidation {
  portId: string;
  type: PortType;
  required: boolean;
  // 可选：自定义校验规则
  pattern?: RegExp;          // 正则匹配
  minLength?: number;
  maxLength?: number;
  allowedValues?: string[];
}

// 校验结果
interface PortValidationResult {
  portId: string;
  valid: boolean;
  error?: string;  // "类型不匹配: 期望 string，收到 null"
}

// 模块执行前置检查
function preflightCheck(node: ExecutionNode): PortValidationResult[] {
  // 收集所有输入端口的校验结果
  // 如果有任何一个 invalid → 模块不执行
}
```

### 5.3 画布上的呈现

```
  正常运行：               A❌ 出错：               B 被连带：
  ┌──────┐              ┌──────┐              ┌──────┐
  │  A   │ ✓            │  A   │ ✗            │  A   │ ✓
  └──┬───┘              └──┬───┘              └──┬───┘
     │                     │ ╳ 红线               │
  ┌──┴───┐              ┌──┴───┐              ┌──┴───┐
  │  B   │ ✓            │  B   │ ⬜ 灰         │  B   │ ✗
  └──┬───┘              └──┬───┘              └──┬───┘
     │                     │ ╳                    │ ╳
  ┌──┴───┐              ┌──┴───┐              ┌──┴───┐
  │  C   │               │  C   │ ⬜           │  C   │ ⬜
  └──────┘               └──────┘              └──────┘
```

**连线状态：**
- 正常运行：连线实线，数据流过时动画
- 上游出错：连线变红虚线，标注 ╳
- 级联中断：连线变灰虚线

---

## 6. 与现有 DAG 引擎的对接

引擎层已经准备好了，UI 层主要做**双向映射**：

```
  ┌─────────────────────┐       ┌──────────────────────────┐
  │   React Flow UI     │       │   dtool Engine (已存在)    │
  │                     │ 映射   │                          │
  │  CanvasNode[]       │◄─────▶│  ExecutionNode[]          │
  │  CanvasEdge[]       │◄─────▶│  Wire[]                   │
  │  position: {x,y}    │       │  (引擎不关心位置)          │
  └─────────────────────┘       └──────────────────────────┘
                                          │
                  执行时                   ▼
                                ┌──────────────────────────┐
                                │  graph-builder.ts         │
                                │  ↓ buildGraph()           │
                                │  ExecutionGraph           │
                                │  ↓ topologicalSort()      │
                                │  executeGraph()           │
                                └──────────────────────────┘
```

### 6.1 画布 → 引擎（执行时）

```typescript
function canvasToEngine(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): ExecutionGraph {
  // 1. 展开管道/循环/复合模块（Composite expansion）
  // 2. 从 edges 直接构建 wires（不再 auto-derive）
  // 3. 构建 ExecutionNode[]
  // 4. 返回 ExecutionGraph { nodes, wires }
}
```

**关键变更**：画布模式下，连线是**显式的**（用户手动拖线），不再用 `deriveWires()` 的线性自动推导。`deriveWires()` 保留给管道模式使用。

### 6.2 引擎 → 画布（加载模板时）

- 从模板 YAML 的 `flow.steps` 解析出节点
- 从 `flow.wires`（模板新增字段）解析出连线
- 如果没有 wires（旧模板），在画布上自动排列节点（dagre 布局算法），不创建连线

---

## 7. 嵌套编辑（Sub-Editor）

### 7.1 现有实现

dtool-studio Editor.tsx 已支持嵌套编辑：
- `contextStack` 面包屑导航
- `enterSubEdit(stepId)` → 进入复合模块内部
- `navigateToLevel(depth)` → 返回上级

### 7.2 画布模式下的扩展

**循环模块的嵌套编辑**：
```
  主画布                   循环内部画布
┌────────────┐          ┌────────────────┐
│            │  双击    │  ← 返回  循环体  │  面包屑: 根 › 循环×3
│  ┌──────┐  │────────▶│                │
│  │⟳ 循环 │  │         │  [模块A]       │
│  │ ×3   │  │         │    │           │
│  └──────┘  │         │  [模块B]       │
│            │         │    │           │
└────────────┘         │  [模块C]       │
                       └────────────────┘
```

**管道模块的嵌套编辑**：
```
  主画布                   管道内部画布
┌────────────┐          ┌────────────────┐
│            │  双击    │  ← 返回  编码链  │  面包屑: 根 › 编码链
│  ┌──────┐  │────────▶│                │
│  │编码链 │  │         │  url_encode    │
│  │      │  │         │    ↓           │
│  └──────┘  │         │  base64_encode │
│            │         │    ↓           │
└────────────┘         │  wrap_json     │
                       └────────────────┘
                       （内部可用管道或画布模式）
```

**技术实现**：
- React Flow 支持嵌套（sub-flows）——每个模块类型可以有独立的 React Flow 实例
- 或者复用现有的 contextStack 方案：进入子编辑时替换整个画布内容
- 推荐：**复用 contextStack**，画布内容根据当前层级渲染不同的 nodes/edges

---

## 8. 管道模式与画布模式的共存

### 8.1 模式切换

```
┌─────────────────────────────────────────┐
│  [管道模式]  [画布模式]     ← 顶部切换 Tab │
├─────────────────────────────────────────┤
│                                         │
│   当前选中的编辑模式渲染对应 UI            │
│                                         │
└─────────────────────────────────────────┘
```

- **管道模式**：保留现有 Editor.tsx（`SortableContext` + 卡片 + SVG pipe）
- **画布模式**：新的 `CanvasEditor.tsx`（React Flow）
- **数据共享**：同一个 `steps` + `wires` 状态，两种模式双向同步
- **管道可封装为模块**：管道模式下 `wrap-as-module` 功能保留

### 8.2 管道作为模块放入画布

```typescript
// 用户在管道模式下编辑了一个管道，封装为模块
const myPipeline: CompositeModule = {
  id: "my-url-encode-chain",
  name: "URL 编码链",
  category: "自定义",
  inputs: [{ id: "data", type: "string" }],
  outputs: [{ id: "encoded", type: "string" }],
  params: [],
  steps: [
    { id: "s1", module: "url_encode", config: {} },
    { id: "s2", module: "base64_encode", config: {} },
    { id: "s3", module: "wrap_json", config: { template: '{"payload":"{{output}}"} '} },
  ],
};

// 在画布模式下，myPipeline 作为一个方块出现
// 和原子模块一样，可以拖入、连线、双击进入内部编辑
```

---

## 9. 循环模块设计

### 9.1 循环模块类型

```typescript
interface LoopModule {
  id: string;
  type: 'loop';
  name: string;
  config: {
    mode: 'count' | 'foreach' | 'until' | 'timeout';
    count?: number;
    foreachSource?: string;      // 变量名或 JSON 数组
    untilCondition?: string;     // 停止匹配字符串
    untilMaxIterations?: number; // 保险：最多迭代次数
    timeoutMs?: number;          // 超时毫秒
  };
  // 循环体：内部是一个管道（子模块列表）
  body: PipelineNode[];
  // 循环变量：每次迭代中被注入的变量
  loopVars: {
    index: string;     // 当前迭代索引，默认 "index"
    item?: string;     // foreach 模式的当前项，默认 "item"
  };
}
```

### 9.2 循环在画布上的表现

```
   ┌──────────────────────────┐
   │  ⟳ 循环解码 (count × 3)  │  ← 蓝紫色标题栏
   │  ┌────────────────────┐  │
   │  │  ▼ input           │  │  ← 对外输入端口
   │  │                    │  │
   │  │  [内部: 3 个步骤]   │  │  ← 摘要信息，双击进入
   │  │                    │  │
   │  │  ▲ output          │  │  ← 对外输出端口
   │  └────────────────────┘  │
   └──────────────────────────┘
```

**端口行为**：
- `input` 端口：循环开始前接收数据，每次迭代体内作为初始输入
- `output` 端口：输出最后一次迭代的结果（或所有轮次聚合结果，可配置）

**画布内循环体**：
- 可以是管道模式（一维线性步骤）
- 也可以是画布模式（二维 DAG，支持嵌套分支）

---

## 10. 数据持久化格式

### 10.1 画布数据 → 模板 YAML

扩展现有模板格式，增加 `wires` 和 `positions` 字段：

```yaml
version: "0.2"
name: URL 编码 + 循环爆破
description: 先 URL 编码，再 Base64 循环解码 3 次
category: 自定义
params: []
flow:
  steps:
    - id: s1
      module: url_encode
      config: {}
    - id: s2
      module: _loop
      label: 循环解码
      config:
        mode: count
        count: 3
      substeps:
        - id: s2a
          module: base64_decode
          config: {}
    - id: s3
      module: output
      config: {}
  wires:
    - fromNode: s1
      fromPort: encoded
      toNode: s2
      toPort: input
    - fromNode: s2
      fromPort: output
      toNode: s3
      toPort: data
  layout:
    s1: { x: 100, y: 200 }
    s2: { x: 400, y: 200 }
    s3: { x: 700, y: 200 }
```

**字段说明：**
- `wires`：画布模式的显式连线。如果存在，优先使用；不存在时回退到线性自动推导。
- `layout`：节点位置信息。仅画布模式需要，管道模式忽略。
- `_loop`：循环模块的 sentinel（类似 `_composite`）。

---

## 11. 实施路线

### Phase 1：React Flow 集成 + 画布骨架
- [ ] 安装 `@xyflow/react`
- [ ] 创建 `CanvasEditor.tsx`，替换现有 Editor.tsx 的三栏布局
- [ ] 实现模块拖入画布 → 创建 React Flow Node
- [ ] 实现自定义节点组件（`ModuleNode`）
- [ ] 实现端口连线（Custom Handle + Custom Edge）
- [ ] 画布平移/缩放

### Phase 2：管道模块 + 嵌套编辑
- [ ] 管道模式嵌入为画布上的一个模块类型
- [ ] 双击管道模块 → 进入子画布编辑
- [ ] contextStack 面包屑导航
- [ ] "封装为模块" 功能（画布选中多个节点 → 创建复合模块）

### Phase 3：循环模块
- [ ] `LoopModule` 类型 + 引擎 handler
- [ ] 循环模块的 Custom Node（蓝紫色样式）
- [ ] 双击进入循环体编辑
- [ ] 循环体内二维画布（支持嵌套循环）

### Phase 4：执行引擎对接
- [ ] `canvasToEngine()` 转换函数
- [ ] 画布模式下的 WebSocket 实时执行
- [ ] 节点级进度指示（黄色脉动边框）
- [ ] 循环执行可视化（迭代计数更新）

### Phase 5：体验打磨
- [ ] 自动布局（dagre，批量排列节点）
- [ ] MiniMap 小地图
- [ ] 连线类型检查 + 错误提示
- [ ] 撤销/重做（React Flow 集成）
- [ ] 节点搜索 + 定位
- [ ] 键盘快捷键完整覆盖

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| React Flow 升级 breaking changes | 锁定主版本，定期评估升级 |
| 包体积过大（~200KB） | 按需引入（tree-shaking 友好），延迟加载 |
| 嵌套画布性能（大量节点） | React Flow 虚拟化已处理，超过 500 节点才需优化 |
| 循环模块的引擎实现复杂 | 先支持 `count` 模式（最简单），逐步加 `foreach`/`until` |
| 管道 ↔ 画布数据同步 | 统一状态管理（Zustand），双向 watch |

---

## 13. 讨论要点

1. **循环模块输出策略**：
   - `last` — 最后一次迭代结果（默认，适用累积变换）
   - `all` — 所有轮次结果数组 `[r1, r2, r3]`（适用批量处理）
   - `first-match` — 第一个满足条件的结果（适用爆破/猜解场景）
2. **管道模式是否保留为独立入口**，还是降级为画布上的一个"管道模块"？建议：主界面同时提供两个 Tab，管道模式作为快速编辑入口，画布模式作为完整编辑器。
3. **变量系统在画布中的角色**：连线是主路径，但模块输出仍可命名（`name: "encoded"`），其他节点通过 `{{encoded}}` 跨分支引用。连线 + 变量共存。
4. **条件分支（Switch 模块）**：是否需要 1 入 N 出的路由模块？之前讨论结论是"先不做"（用普通模块 + 正则即可），但画布模式下分支结构的表达需要重新评估。
5. **多选 + 批量操作**：框选多个节点 → 封装为模块 / 对齐 / 复制粘贴 / 批量删除。
6. **当前紫色虚线修复**：在 Phase 1 之前可以先修——编辑器 SVG overlay 的 z-index 调整，线从卡片背后穿过。
7. **断点调试**：未来是否需要在画布上加断点（类似 IDE debugger）？Phase 5+ 考虑。
8. **模块市场**：用户封装的自定义模块是否可以发布/分享？dtool 生态化的关键方向，但暂时不做。
