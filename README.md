# dtool Studio

Visual dataflow programming tool — 可视化数据流编辑器。

拖拽模块、连接管道、一键运行。适用于个人/团队内部的数据处理和自动化任务。

## 项目结构

```
dtool-studio/
├── packages/
│   ├── engine/     # 执行引擎（纯逻辑，无 HTTP 依赖）
│   ├── server/     # Fastify + WebSocket 后端服务
│   └── studio/     # React/Vite 前端编辑器
├── templates/      # 内置 YAML 模板
└── docker/         # 容器化部署配置
```

## 快速开始

```bash
pnpm install
pnpm dev
```

## 许可证

MIT
