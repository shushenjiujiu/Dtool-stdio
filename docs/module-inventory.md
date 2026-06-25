# dtool Studio 模块清单

> 来源：基于旧 dtool 源码 `/src/modules/` 的完整扫描
> 实际模块数：**28 个**（注：此前旧文档记录的"51 个"为幻觉数据，以本清单为准）
> 日期：2026-06-26

---

## 索引

| 模块 ID | 显示名 | 分类 | 旧 dtool | 可移植到 Studio | 备注 |
|---------|--------|------|----------|----------------|------|
| `backtick_wrap` | 反引号包裹 | wrapping | ✅ | ✅ 纯函数 | 简单字符串包裹 |
| `base64_decode` | Base64 解码 | encoding | ✅ | ✅ 纯函数 | — |
| `base64_encode` | Base64 编码 | encoding | ✅ | ✅ 纯函数 | — |
| `case_convert` | 大小写转换 | transformation | ✅ | ✅ 纯函数 | 支持多种模式 |
| `case_obfuscate` | 大小写混淆 | injection | ✅ | ✅ 纯函数 | 用于 WAF 绕过 |
| `charcode_encode` | 字符编码转换 | encoding | ✅ | ✅ 纯函数 | 十进制/十六进制 |
| `combine` | 组合 | transformation | ✅ | ✅ 纯函数 | 模板拼接多变量 |
| `constant` | 常量 | transformation | ✅ | ✅ 纯函数 | 注入固定值 |
| `form_url_encode` | 表单 URL 编码 | wrapping | ✅ | ✅ 纯函数 | key:value → URL 编码 |
| `hex_decode` | Hex 解码 | encoding | ✅ | ✅ 纯函数 | — |
| `hex_encode` | Hex 编码 | encoding | ✅ | ✅ 纯函数 | — |
| `hex_escape` | Hex 转义 | encoding | ✅ | ✅ 纯函数 | 多种格式转义 |
| `html_entity_decode` | HTML 实体解码 | encoding | ✅ | ✅ 纯函数 | — |
| `html_entity_encode` | HTML 实体编码 | encoding | ✅ | ✅ 纯函数 | — |
| `json_to_querystring` | JSON → 查询字符串 | wrapping | ✅ | ✅ 纯函数 | — |
| `jwt_decode` | JWT 解码 | transformation | ✅ | ✅ 纯函数 | 不验签名 |
| `null_byte_inject` | 空字节注入 | injection | ✅ | ✅ 纯函数 | — |
| `querystring_to_json` | 查询字符串 → JSON | wrapping | ✅ | ✅ 纯函数 | — |
| `repeat_pad` | 重复填充 | transformation | ✅ | ✅ 纯函数 | — |
| `space_bypass` | 空格绕过 | injection | ✅ | ✅ 纯函数 | — |
| `sql_comment` | SQL 注释注入 | injection | ✅ | ✅ 纯函数 | — |
| `sql_comment_block` | SQL 全部注释化 | injection | ✅ | ✅ 纯函数 | — |
| `string_reverse` | 字符串反转 | transformation | ✅ | ✅ 纯函数 | — |
| `trim_whitespace` | 清除空白 | transformation | ✅ | ✅ 纯函数 | — |
| `unicode_escape` | Unicode 转义 | encoding | ✅ | ✅ 纯函数 | \\uXXXX 格式 |
| `unicode_unescape` | Unicode 反转义 | encoding | ✅ | ✅ 纯函数 | — |
| `url_encode` | URL 编码 | encoding | ✅ | ✅ 纯函数 | encodeURIComponent |
| `wrap_jsonrpc` | JSON-RPC 封装 | wrapping | ✅ | ✅ 纯函数 | — |

---

## 分类统计

| 分类 | 数量 | 模块 |
|------|------|------|
| encoding（编码/解码） | 13 | base64_encode/decode, hex_encode/decode, html_entity_encode/decode, unicode_escape/unescape, url_encode, hex_escape, charcode_encode |
| transformation（转换/处理） | 8 | combine, constant, case_convert, string_reverse, repeat_pad, trim_whitespace, jwt_decode, charcode_encode |
| injection（安全/注入） | 5 | sql_comment, sql_comment_block, space_bypass, case_obfuscate, null_byte_inject |
| wrapping（封装/包装） | 4 | form_url_encode, wrap_jsonrpc, json_to_querystring, querystring_to_json, backtick_wrap |

> 注：charcode_encode 同时出现在 encoding 和 transformation 中（按旧 dtool 分类体系）。上表中计在 encoding 下。

---

## 模块特性分析

### 纯函数可移植性

**所有 28 个模块均为纯函数**（输入 → 输出，无状态、无副作用、无外部依赖）。旧 dtool 的模块设计本身确保了这一点。

这意味着：**28 个模块全部可以直接移植到 dtool Studio**，无需修改核心逻辑，只需按 Studio 的 Schema 重新注册。

移植工作量：每个模块约 10-30 行纯逻辑代码的复制 + Studio 的 `moduleRegistry.register()` 调用。

### 旧 dtool 曾记录但实际不存在的模块

以下模块在旧 dtool 文档中被记录，但经代码验证不存在。**dtool Studio 如需使用需新建：**

| 模块名 | 记录来源 | 建议 |
|--------|---------|------|
| `input` | 旧文档 | ✅ Studio 需要此模块（前端输入交互） |
| `output` | 旧文档 | ✅ Studio 需要此模块（前端输出展示） |
| `http_get` | 幻觉文档 | ⚠️ 旧 dtool 无此模块，Studio 后端运行后可考虑实现 |
| `http_post` | 幻觉文档 | ⚠️ 同上 |
| `json_extract` | 幻觉文档 | ⚠️ 可做，但需要确定场景 |
| `split` | 幻觉文档 | ⚠️ 可做，字符串拆分 |
| `replace` | 幻觉文档 | ⚠️ 可做，字符串替换 |
| `regex_extract` | 幻觉文档 | ⚠️ 可做，正则提取 |
| `export_csv` | 幻觉文档 | ⚠️ 后端运行后有意义 |
| `export_excel` | 幻觉文档 | ⚠️ 同上 |

### Studio 首批需要新建的模块（不在旧 dtool 中）

| 模块 ID | 用途 | 模板 | 优先级 |
|---------|------|------|--------|
| `json-format` | JSON 格式化/美化 | JSON 格式化模板 | P1 |
| `string-replace` | 字符串搜索替换 | 字符串替换模板 | P1 |
| `url_decode` | URL 解码 | 未来解编码类模板 | P2 |
| `base64_encode`/`base64_decode` | 旧 dtool 已有，直接移植 | — | P0 |
| `loop`（特殊模块） | 循环容器 | — | P0（引擎内置） |

---

## 模块注册名规范建议

旧 dtool 模块 ID 使用 **snake_case**（如 `base64_encode`、`html_entity_decode`）。
建议 dtool Studio 沿用此规范，保持一致性。

涉及本文档的模板中使用的模块 ID，已按此规范修正。如有异议可另行统一命名。

---

## 附录：旧 dtool 注册源码

从 `src/modules/index.ts` 提取的注册顺序（供移植参考）：

```
encoding:     urlEncode, base64Encode/decode, hexEncode/decode,
              htmlEntityEncode/decode, unicodeEscape/unescape
wrapping:     jsonToQueryString, queryStringToJson, formUrlEncode,
              wrapJsonRpc, backtickWrap, trimWhitespace
injection:    sqlComment, sqlCommentBlockAll, spaceBypass,
              caseObfuscate, nullByteInject, hexEscape
transformation: jwtDecode, caseConvert, stringReverse,
              charcodeEncode, combine, constant, repeatPad
```

> 注：`trimWhitespace` 源代码在 `wrapping/utils.ts` 中，但分类为 `transformation`。
