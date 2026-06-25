# dtool Studio 模板 Schema 草案 v0.1

> 状态：**草案** — 待助手一号、助手二号、Manager review 后定稿
> 日期：2026-06-26
> 作者：知更鸟

---

## 一、设计目标

- **外部 AI 可生成**：格式简单明确，LLM 能稳定输出
- **模板优先**：Schema 的核心消费者是"模板导入系统"，不是执行引擎
- **参数化优先**：用户与模板的交互方式是"填参数表单"，不是"改 YAML"
- **日常视图友好**：主要结构是步骤列表（不是节点图），循环/条件是嵌套列表
- **底层可扩展**：保留节点+连线的高级表示位置，但不强制

---

## 二、模板定义格式（YAML）

### 2.1 顶层结构

```yaml
# ============================================
# dtool Studio 模板定义
# Schema 版本: v0.1
# ============================================

# --- 必须字段 ---
version: "0.1"                    # Schema 版本，用于兼容性检查
name: "模板名称"                   # 显示在模板库首页
description: "一句话说明这个模板做什么"  # 模板卡片上的描述
category: "编码/解码"              # 分类标签，对应模板库分类

# --- 可选字段 ---
tags: ["编码", "批量"]            # 供搜索
author: "知更鸟"                   # 创建者
created: "2026-06-26"             # 创建日期（ISO 格式）

# --- 参数定义（用户填的表单） ---
params:
  - id: "参数唯一ID"               # 供 flow 内部引用
    label: "参数显示名"             # 表单上的标签文字
    type: "string"                 # 参数类型：string | number | select | boolean | textarea
    required: true                 # 是否必填
    default: ""                    # 默认值
    placeholder: "提示性文字"       # 输入框占位符
    description: "对参数的说明"    # 帮助文字（可选）
    # 仅 type=select 时：
    options:                       # 选项列表
      - label: "Base64 编码"
        value: "base64_encode"
      - label: "URL 编码"
        value: "urlEncode"

# --- 内部流程定义 ---
flow:
  # 步骤列表（线性，执行顺序 = 列表顺序）
  # 自动数据传递：上一步的输出 → 下一步的默认输入
  steps:
    - id: "步骤唯一ID"             # 供内部引用用
      module: "模块ID"             # 使用哪个模块（或特殊模块 "loop"/"branch"）
      label: "步骤显示名"          # 画布上显示的标签（可选，默认用模块名）
      config:                      # 模块参数（键值对）
        param1: "值"
        param2: "$param.参数ID"    # 引用模板参数：$param.参数ID
      export: "变量名"             # 命名本步骤的输出（供后续步骤引用）
      # 特殊模块专属（loop / branch）：
      substeps: []                 # 仅 loop/branch 模块可用，定义内部子步骤（递归，结构同此表）

    - id: "步骤唯一ID"
      module: "模块ID"
      config:
        source: "$steps.上一步ID"  # 引用上一步的输出：$steps.步骤ID
```

### 2.2 变量引用规则

| 语法 | 含义 | 示例 |
|------|------|------|
| `$param.参数ID` | 引用用户填的表单参数 | `$param.encode_type` → 用户选择的编码类型 |
| `$steps.步骤ID` | 引用某个步骤的输出 | `$steps.read_input` → 输入步骤的输出 |

**值替换规则（按优先级）：**

1. **精确匹配**：完整值等于 `$param.xxx` 或 `$steps.xxx` 时，替换为对应值
2. **内联替换**：字符串中包含 `$param.xxx` 或 `$steps.xxx` 子串时，替换子串部分，保留其余文本
   - 例如 `"prefix-$param.host-suffix"` → `"prefix-example.com-suffix"`
   - 替换正则：`\$param\.\w+` 和 `\$steps\.\w+`
3. **动态模块**：如果 `module` 字段值包含 `$`，按以上规则替换后查询模块注册表
   - 例如 `module: "$param.encode_type"` → 实际加载用户选中的模块
4. **字面量 `$`**：用 `$$` 转义为单一 `$` 字符，不触发替换
5. **未解析引用**：任何 `$` 开头的值在替换后若仍有未识别引用，抛出错误（不静默忽略）

**注意：不支持表达式求值。** 变量引用仅做字典键值查找，不支持拼接运算、条件表达式、函数调用。

---

### 2.3 Loop 作用域规则

loop 模块创建子作用域，遵循词法作用域链规则：

**作用域链（查找顺序）：** 当前 loop 内 → 外层 loop → 顶层 flow

| 方向 | 引用来源 → 目标 | 是否允许 |
|------|----------------|---------|
| 子 → 父 | substeps 内部引用外部步骤：`$steps.父级ID` | ✅ 允许 |
| 任意 → 参数 | 任何作用域引用模板参数：`$param.xxx` | ✅ 允许 |
| 父 → 子 | 外部引用 substeps 内部步骤 | ❌ 禁止（作用域隔离，防止循环依赖） |
| 兄弟 | 同一层级不同步骤互相引用 | ✅ 允许（但需确保执行顺序正确） |

**变量遮蔽（Shadowing）：**
- 子作用域定义的步骤 id 与父级冲突时，子级生效
- 示例：父级有 `check_sql`，loop 内部也有 `check_sql` → loop 内部引用的是内部的
- 建议模板作者避免遮蔽，引擎不禁止但会 warning

**loop 的最终输出：**
- `$steps.loopID` 引用的是**最后一次迭代的最后一步输出**
- 示例：loop 迭代 5 次，每次编码 → `$steps.encode_loop` 值是第 5 次的结果

**循环内引用父级步骤的注意事项：**
- 父级步骤的输出在 loop 外部已确定，不会随迭代变化
- 如果需要在每次迭代中引用**上一次迭代的输出**，使用 `$steps.loopID` 自身（loop 自引用）

**循环上限（两层风控）：**
- **模板层**：`config.count` 值必须 ≤ 10000（静态检查硬上限）
- **引擎层**：执行引擎环境变量 `MAX_LOOP_ITERATIONS` 动态覆盖全局上限，可在部署时配置
- 实际生效值 = `min(config.count, 引擎上限)`
- 默认引擎上限 10000，超出会在运行前报错，不静默截断

---

### 2.4 安全约束规则

以下规则在执行引擎层强制实施，模板定义时不需要显式标注，但作者应了解：

| 约束 | 规则 | 违规后果 |
|------|------|---------|
| 仅查找替换 | 变量引用仅做精确的字典键值查找 | ❌ 不支持 eval / 表达式 / 拼接运算 |
| 模块白名单 | 动态模块选择（`$param.xxx` 作 module）只在已注册模块白名单内查找 | ❌ 不存在时抛错，不加载未知代码 |
| `$` 转义 | 字面量 `$` 用 `$$` 表示 | 例如 `price: "$$19.99"` → `"$19.99"` |
| 未解析引用 | 替换完成后仍有 `$` 开头的未识别引用 | 抛出 `UnresolvedReferenceError`，不静默跳过 |
| 输出大小限制 | 单步骤输出超过上限（默认 10MB） | 截断并记录 warning |

**安全原则：模板定义是声明式数据，不是可执行代码。**
模板 YAML 不包含、不引用可执行脚本，也不对字符串做表达式求值。

---

### 2.5 校验体系：两层校验

#### 第一层：静态结构校验（JSON Schema）
- 在编辑器侧实时执行
- 检查必填字段、字段类型、枚举范围
- 错误直接标红到对应字段

#### 第二层：语义校验（后端执行，模板导入时触发）

| 检查项 | 描述 | 错误示例 |
|--------|------|---------|
| `$param.xxx` 存在性 | 所有 `$param` 引用在 `params[]` 中有对应 id | `$param.encode_type` 但 params 中没有 `encode_type` |
| `$steps.xxx` 存在性 | 所有 `$steps` 引用在对应作用域中有对应步骤 id | `$steps.nonexistent` 但 flow 里找不到 |
| steps id 唯一性 | 同一作用域内步骤 id 不重复 | 两个步骤 id 都是 `do_encode` |
| loop 完整性 | `module: "loop"` 必须同时有 `config.count` 和 `substeps` | loop 有 `substeps` 但没 `count` |
| 数字范围 | `config.count` 值不能超过全局上限（默认 10000） | count: 99999 但全局上限 10000 |
| 循环风控双上限 | 模板内上限（`params[].max`）≤ 静态检查上限（10000）≤ 引擎动态上限（env `MAX_LOOP_ITERATIONS`） | 模板写 count: 500，但引擎环境变量设为 200，取 200 |
| branch 未实现 | branch 类型模块仅在 Schema 预留位置，当前不可用 | `module: "branch"` → 语义校验报错
| 模块存在性 | 所有非动态 `module` 值必须在模块注册表中 | `module: "fake-module"` 但未注册 |
| 动态模块可选性 | `$param` 作 module 时，参数 options 的 value 必须在模块注册表中 | 下拉选项中有 `encode/magic` 但未实现 |

**语义校验只在后端执行**（模板导入或运行前），前端仅做第一层结构校验。

---

### 2.6 JSON Schema（校验用）

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "dtool-studio-template-v0.1",
  "title": "dtool Studio Template",
  "type": "object",
  "required": ["version", "name", "description", "category", "params", "flow"],
  "properties": {
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+$",
      "description": "Schema 版本号"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "description": {
      "type": "string",
      "maxLength": 256
    },
    "category": {
      "type": "string",
      "enum": [
        "编码/解码",
        "格式转换",
        "合并/拆分",
        "循环/批量",
        "安全检测",
        "工具",
        "自定义"
      ]
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "author": { "type": "string" },
    "created": { "type": "string", "format": "date" },
    "params": {
      "type": "array",
      "items": { "$ref": "#/definitions/ParamDef" }
    },
    "flow": {
      "type": "object",
      "required": ["steps"],
      "properties": {
        "steps": {
          "type": "array",
          "items": { "$ref": "#/definitions/StepDef" }
        }
      }
    }
  },
  "definitions": {
    "ParamDef": {
      "type": "object",
      "required": ["id", "label", "type"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$" },
        "label": { "type": "string" },
        "type": { "type": "string", "enum": ["string", "number", "select", "boolean", "textarea"] },
        "required": { "type": "boolean", "default": false },
        "default": {},
        "placeholder": { "type": "string" },
        "description": { "type": "string" },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["label", "value"],
            "properties": {
              "label": { "type": "string" },
              "value": { "type": "string" }
            }
          }
        },
        "min": { "type": "number" },
        "max": { "type": "number" }
      }
    },
    "StepDef": {
      "type": "object",
      "required": ["id", "module"],
      "properties": {
        "id": { "type": "string", "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$" },
        "module": { "type": "string" },
        "label": { "type": "string" },
        "config": { "type": "object" },
        "export": { "type": "string" },
        "substeps": {
          "type": "array",
          "items": { "$ref": "#/definitions/StepDef" },
          "description": "仅 loop/branch 模块可用，定义内部子步骤"
        }
      }
    }
  }
}
```

---

## 三、示例模板

### 示例 1：URL 批量编码

```yaml
version: "0.1"
name: "URL 批量编码"
description: "对输入的文本内容执行多次编码转换"
category: "编码/解码"
tags: ["编码", "批量"]
author: "知更鸟"
created: "2026-06-26"

params:
  - id: input_text
    label: "输入文本"
    type: "textarea"
    required: true
    placeholder: "输入要编码的内容，例如：https://example.com/path?id=1"

  - id: encode_type
    label: "编码方式"
    type: "select"
    default: "base64_encode"
    options:
      - label: "Base64 编码"
        value: "base64_encode"
      - label: "URL 编码"
        value: "urlEncode"
      - label: "Hex 编码"
        value: "hex"

  - id: repeat_count
    label: "循环次数"
    type: "number"
    default: 3
    min: 1
    max: 100

flow:
  steps:
    - id: read_input
      module: "input"
      label: "读取输入"
      config:
        text: "$param.input_text"
      export: raw

    - id: encode_loop
      module: "loop"
      label: "编码循环"
      config:
        count: "$param.repeat_count"
      export: result
      substeps:
        - id: do_encode
          module: "$param.encode_type"
          label: "执行编码"
          config: {}

    - id: show_result
      module: "output"
      label: "显示结果"
      config:
        source: "$steps.encode_loop.output"
```

---

### 示例 2：安全检测（SQL 注释绕过检测）

```yaml
version: "0.1"
name: "SQL 注释绕过检测"
description: "检测输入中是否包含 SQL 注释绕过特征"
category: "安全检测"
tags: ["安全", "SQL", "检测"]
author: "知更鸟"
created: "2026-06-26"

params:
  - id: input_text
    label: "检测文本"
    type: "textarea"
    required: true
    placeholder: "输入需要检测的文本"

  - id: encode_before_check
    label: "编码后再检测"
    type: "select"
    default: "none"
    options:
      - label: "不编码，直接检测"
        value: "none"
      - label: "先 URL 编码"
        value: "urlEncode"
      - label: "先 Base64 编码"
        value: "base64_encode"

flow:
  steps:
    - id: read_input
      module: "input"
      label: "读取输入"
      config:
        text: "$param.input_text"
      export: raw

    - id: pre_encode
      module: "$param.encode_before_check"
      label: "预处理编码"
      config: {}

    - id: check_sql
      module: "sql-comment"
      label: "SQL 注释检测"
      config: {}

    - id: check_null
      module: "null-byte-inject"
      label: "Null 字节检测"
      config: {}

    - id: show_result
      module: "output"
      label: "检测结果"
      config:
        source: "$steps.check_null.output"
```

---

### 示例 3：多路合并（Combine）

```yaml
version: "0.1"
name: "多路数据合并"
description: "将多个输入按模板拼接组合"
category: "合并/拆分"
tags: ["合并", "格式化"]
author: "知更鸟"
created: "2026-06-26"

params:
  - id: input_a
    label: "数据源 A"
    type: "string"
    required: true
    placeholder: "第一部分内容"

  - id: input_b
    label: "数据源 B"
    type: "string"
    required: true
    placeholder: "第二部分内容"

  - id: separator
    label: "分隔符"
    type: "string"
    default: " → "
    placeholder: "例如： → 、 | 、 ，"

  - id: repeat_count
    label: "重复次数"
    type: "number"
    default: 1
    min: 1
    max: 10

flow:
  steps:
    - id: read_a
      module: "input"
      label: "读取数据 A"
      config:
        text: "$param.input_a"
      export: data_a

    - id: read_b
      module: "input"
      label: "读取数据 B"
      config:
        text: "$param.input_b"
      export: data_b

    - id: combine_loop
      module: "loop"
      label: "组合循环"
      config:
        count: "$param.repeat_count"
      export: combined
      substeps:
        - id: merge
          module: "combine"
          label: "合并数据"
          config:
            source_a: "$steps.read_a.output"
            source_b: "$steps.read_b.output"
            separator: "$param.separator"

    - id: show_result
      module: "output"
      label: "显示结果"
      config:
        source: "$steps.combine_loop.output"
```

---

## 四、Agent 协作规程

### 4.1 模板文件存放路径

```
dtool-studio/                       # 项目根目录
├── templates/                      # 模板库（Git 跟踪）
│   ├── encoding/                   # 按分类建子目录
│   │   ├── url-batch-encode.yaml
│   │   └── base64-encode.yaml
│   ├── security/
│   │   ├── sql-comment-detect.yaml
│   │   └── null-byte-check.yaml
│   ├── transform/
│   │   ├── multi-combine.yaml
│   │   └── case-convert.yaml
│   └── index.yaml                  # 模板索引（CI 自动生成，不建议手动维护）
└── schemas/
    └── template-v0.1.json          # JSON Schema 校验定义
```

### 4.2 Agent 模板生成规程

**谁写模板：**

| Agent | 角色 | 生产力 |
|-------|------|--------|
| 助手二号 | 设计流程逻辑，确保步骤顺序和模块选型正确 | 给出 YAML 骨架 |
| 知更鸟 | 写参数表单设计、标签、说明文字，确保用户友好 | 完善 params + 描述 |
| Manager | 校验模板结构、变量引用、边界条件 | 验证 + 补充约束 |

**模板创建流程（review 制）：**

```
① 需求提出（Heye / 任何 Agent）
    ↓
② 指定一个 Agent 作为作者，写出初版 YAML
    ↓
③ 提 PR / 共享草案，另外两个 Agent review
    ├── 助手二号：模块选型、流程正确性
    ├── 知更鸟：参数命名、描述可读性、category 归类
    └── Manager：变量引用链完整性、边界条件
    ↓
④ 助手二号执行集成测试：模板导入→运行→输出是否符合预期
    ↓
⑤ 通过后合并到 templates/ 目录
```

**模板必须包含：**

- [x] 完整的 metadata（name, description, category, author, created）
- [x] 至少 1 个参数（没有参数的模板 = 常量，不应作为模板存在）
- [x] 每个参数有 label 和 placeholder 或 description
- [x] flow.steps 非空且 id 唯一
- [x] 所有 `$param.xxx` 引用在 params 中有对应定义
- [x] 所有 `$steps.xxx` 引用在 steps 中有对应 id

**模板禁止包含：**

- ❌ 硬编码的用户隐私数据
- ❌ `$steps.xxx` 引用不存在的步骤
- ❌ 无限循环（loop 必须有 count 上限）
- ❌ 循环次数超过 10000（执行引擎的安全限制）

### 4.3 模板版本管理

- 模板存储在项目 Git 仓库的 `templates/` 目录下
- 每个模板文件独立版本历史（Git 天然支持）
- 模板分类子目录由知更鸟维护，新增分类需在协作中声明
- `index.yaml` 为可选索引文件，供模板库首页展示用

---

## 五、设计决策说明

### 为什么用 YAML 而不是 JSON？

| 维度 | YAML | JSON |
|------|------|------|
| AI 生成稳定性 | 高（注释友好，结构自解释） | 中（括号对齐容易错） |
| 人读性 | 高 | 中 |
| 前端解析 | 需额外库 | 原生支持 |
| 执行引擎解析 | 需额外库 | 原生支持 |

AI 可生成性优先 → 选 YAML。前端和执行引擎解析 YAML 的库成本很低（js-yaml / js-yaml for Node）。

### 为什么不用 DSL 格式？

旧 dtool 的 DSL 格式（`input() name=raw` 行式语法）是为"人写"优化的。模板 Schema 是为"AI 生成 + 机器解析"优化的。
两者不冲突：模板 Schema 是存储格式，如果高级用户想手写，可以基于模板 Schema 做 DSL → YAML 转换器（未来功能）。

### 为什么 flow 是步骤列表而不是图？

日常视图下用户看到的是步骤列表。使用列表作为主要结构意味着：
- 不需要规定连线的显式表达（隐式顺序 = 上一步到下一步）
- 循环/条件内部也是列表（递归一致）
- 只有当需要非线性的连接时（高级模式），才需要额外的 `wires` 字段
- 当前草案先不做 wires 字段——等到真的需要跨层/跨分支连接时再加

### 为什么 $param / $steps 前缀引用？

- 区分于普通字符串值：看到 `$` 就知道是动态引用
- 比 `{{param}}` 更精确：`$param` 明确作用域（模板参数），`$steps` 明确引用目标
- 和旧 dtool 的 `{{var}}` 风格不同，避免命名空间混淆

---

## 六、后续待定项

| 问题 | 状态 | 需要在什么时候定 |
|------|------|----------------|
| 条件分支（branch）的 Schema 定义 | ❌ 草案未包含且禁止使用 | 等到条件模块实现时，在此之前 `module: "branch"` 语义校验报错 |
| 复杂非线性流程（需要 wires 字段） | 草案未包含 | 等到高级模式设计时 |
| `$steps.xxx` 引用跨循环层级的规则 | 草案使用隐式传递 | 等第一个复杂嵌套模板出现时 |
| template index.yaml 格式 | 改为 CI 自动生成，不建议手动维护 | 等模板库超过 10 个时定义生成逻辑 |
| param 的类型完整性（enum / array / object） | 仅覆盖了基础类型 | 等模块需求驱动时 |
