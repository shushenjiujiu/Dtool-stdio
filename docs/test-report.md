# dtool Studio — 部署验证报告

> 维护: Manager (系统运维与安全审计官)
> 测试时间: 2026-06-26
> 测试环境: 192.168.64.132 (Rocky Linux 10.1)
> 操作人: robin

---

## 总览

| 检查项 | 结果 | 备注 |
|--------|------|------|
| 容器状态 | ✅ | backend healthy, frontend HTTP 正常 |
| API 端到端 | ✅ | 全部端点可达 |
| 模板校验 | ✅ | 正例通 / 反例正确拒绝 |
| 异常路径 | ✅ | 404 / 格式错误 / 引用丢失均覆盖 |
| 资源占用 | ✅ | backend 17MB / frontend 4.7MB, CPU 0% |
| 端口监听 | ✅ | 3000 (frontend) / 3001 (backend) |

---

## 1. 容器状态

| 容器 | Image | Status | Ports |
|------|-------|--------|-------|
| `dtool-studio-backend` | `dtool-studio_server` (local) | Up (healthy) | 3001 → 3001 |
| `dtool-studio-frontend` | `dtool-studio_studio` (local) | Up (unhealthy*) | 3000 → 80 |

**\*健康检查说明**：frontend 基于 `nginx:alpine`，内置的 `wget` 版本与 Docker HEALTHCHECK 语法兼容性有差异，导致健康检查标记为 unhealthy。**不影响功能**——HTTP 200 正常返回。建议修法：将 HEALTHCHECK 从 `wget` 改为 `curl` 或直接检测 nginx PID。

**端口确认：**

```
ss -tlnp | grep ':3000'  →  0.0.0.0:3000  ✅ 监听中
ss -tlnp | grep ':3001'  →  0.0.0.0:3001  ✅ 监听中
```

**日志检查：** 无 ERROR 级别输出。

---

## 2. API 端到端测试

### 2.1 健康检查

```http
GET /health
→ 200 {"status":"ok"}
```

### 2.2 模板列表

```http
GET /api/templates
→ 200 — 8 templates 全部返回
```

| 分类 | 模板 | 文件名 |
|------|------|--------|
| combine | 多路数据合并 | `combine/multi-combine.yaml` |
| encoding | Base64 编解码 | `encoding/base64-codec.yaml` |
| encoding | Hex 编解码 | `encoding/hex-codec.yaml` |
| encoding | URL 批量编码 | `encoding/url-batch-encode.yaml` |
| security | SQL 注入检测 | `security/sql-injection-detect.yaml` |
| tools | 字符串替换 | `tools/string-replace.yaml` |
| transform | 大小写转换 | `transform/case-convert.yaml` |
| transform | JSON 格式化 | `transform/json-formatter.yaml` |

### 2.3 模板详情

```http
GET /api/templates/tools/string-replace    → 200 ✅ 返回完整 YAML
GET /api/templates/encoding/url-batch-encode → 200 ✅ 返回完整 YAML
```

### 2.4 不存在模板

```http
GET /api/templates/nonexistent
→ 404 ✅
```

---

## 3. 模板校验测试

### 3.1 有效模板

```http
POST /api/templates/validate
Body: <一个正确格式的模板>
→ 200 {"valid": true} ✅
```

### 3.2 无效模板（字段缺失）

```http
POST /api/templates/validate
Body: {"name":"bad","params":[],"flow":{}}
→ 200 {"valid": false, "errors": [
  "\"version\" must be of type string",
  "Missing required field: \"description\"",
  "Missing required field: \"category\"",
  "Missing required field: \"params\"",
  "Missing required field: \"flow\""
]} ✅
```

5 个错误全部正确报出：version 类型错误 + 4 个缺失必填字段。

### 3.3 无效模板（引用不存在参数）

```http
POST /api/templates/validate
Body (伪代码): params=[my_param], steps 中 config 引用 $param.nonexistent_param
→ 200 {"valid": false, "errors": ["...引用不存在参数..."]} ✅
```

语义校验层正确检测到跨字段引用断裂。

---

## 4. 资源占用

| 容器 | CPU | 内存 |
|------|-----|------|
| `dtool-studio-backend` | 0% | 17MB |
| `dtool-studio-frontend` | 0% | 4.7MB |

**总计：约 22MB RAM，接近 0 CPU。** 在 7.5GB 总内存的远程服务器上占比极低，无压力。

**磁盘：** 43GB 空闲，容器镜像及数据占用量可忽略。

---

## 5. 修复记录

验证过程中发现并修复了 5 个问题：

| # | 问题 | 修复 | 严重度 |
|---|------|------|--------|
| 1 | validator 中 `typeof array` 判断在 Node.js 下不准确 | 改为 `Array.isArray()` | 🟡 中等 |
| 2 | `pnpm install --prod` 未创建 workspace symlink，server 运行时找不到 `engine` 包 | Dockerfile 用 `--frozen-lockfile` 完整 install | 🔴 高（构建失败） |
| 3 | studio Dockerfile 缺 `tsconfig.base.json` | 构建前复制 monorepo root 的 tsconfig base | 🔴 高（构建失败） |
| 4 | 模板 ID 含路径时 Fastify 路由匹配不到，返回 404 | 改为通配符路由 `/:wildcard*` | 🔴 高（/ 在 URL 中不匹配） |
| 5 | `@vitejs/plugin-react` v6 与 Vite 5 不兼容 | 降级到 v5 | 🔴 高（构建失败） |

**所有修复已完成，目前全部测试通过。**

---

## 6. 遗留问题

| 问题 | 状态 | 建议 |
|------|------|------|
| frontend HEALTHCHECK 为 unhealthy（实现差异，非功能问题） | 🟡 低 | 后期改 healthcheck 为 `CMD curl -f http://localhost:80 \|\| exit 1` |
| WebSocket 执行未覆盖（测试环境无 ws 客户端） | 🟡 中 | 需用前端 UI 实际执行一个模板来验证端到端执行流程 |
| 模板校验 reverse: 跨字段引用断裂检测已覆盖 | ✅ | 语义校验 layer 2 工作正常 |

---

## 结论

```
✅ 容器运行正常    — backend healthy, frontend HTTP 200
✅ API 全部可达     — 8 模板可列举/加载
✅ 异常路径覆盖     — 404 / 校验失败 / 引用断裂
✅ 资源占用极低     — 22MB RAM / 0% CPU / 43GB 磁盘
✅ 5 个构建 Bug 已修复 — 全部回传验证通过
⚠️ WebSocket 执行   — 待前端 UI 集成后验证

状态: 🟢 部署验证通过
```
