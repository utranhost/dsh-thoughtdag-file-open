# @local/dsh-thoughtdag-file-open

让 ThoughtDAG 画布里的**文件链接**在**当前页面弹窗**里打开，而不是把画布 iframe
导航到 `/thoughtdag/docs/...` 这种画布渲染不了的地址；也不切换主视图、不跳页。

## 背景

ThoughtDAG 插件把画布 SPA 挂在同源 iframe（`/thoughtdag/`）里。画布节点里的
Markdown 链接是普通 `<a href="docs/product/status.md">`，浏览器会相对 iframe 的
基址解析成 `/thoughtdag/docs/product/status.md`，SPA 无法渲染该路径，于是画布
看起来“跳走/空白”。

本插件拦截画布 iframe 里的**文件链接**，用 DSH 自己的 UI 组件
（`@deepseek-ai/dsh-client-ui-primitives`：Modal、MarkdownText、CodeBlock 等，
与聊天界面同一套渲染）在画布上方弹出一个模态框显示文件内容。

## 行为

- 点击画布 iframe 内的文件链接：拦截默认导航 → 解析真实路径 → 在**当前页面**弹出
  文件预览。画布保持原样，不切面板、不换会话。
- **普通 HTTP(S) 超链接完全不处理**：不拦截、不 `preventDefault`、不 `window.open`，
  浏览器/画布原有行为保持原样（这是 2.0 的明确要求）。
- `#/...` 画布内部路由、`mailto:` 等 scheme、无扩展名的普通路由：一律放行。
- 链接判定：非 HTTP(S) 的相对/绝对路径，且带扩展名（字母开头，如 `md`/`py`/`png`），
  或是常见无扩展名文件名（`Dockerfile`、`Makefile`、`README` 等），或是 `file://`、
  `/绝对路径`。
- 行号定位：链接末尾的 `#L92`（GitHub 风格，支持 `#L92-L99` 区间取首行）和 `:48`
  （编辑器风格，也支持 `:48:7` 的 line:column）都识别为**同一文件 + 目标行**；
  路径解析时会去掉行号后缀，打开后在代码视图里跳到该行，并在弹窗标题栏显示“第 N 行”。
- 解析/打开失败：底部弹 toast 提示；无法预览的格式在弹窗里给出
  “在文件窗口打开”按钮（点击后才切到 DSH 文档窗口，作为兜底）。

### 渲染支持

| 类型 | 扩展名 | 渲染方式 |
|---|---|---|
| Markdown | `md markdown mdown mkd mkdn mdwn` | `MarkdownText`（GFM + TeX，同聊天渲染；本地图片经 `/api/file` 显示；文档内相对链接可继续在弹窗中打开） |
| 代码 / 文本 | 其它可读文本（`py ts js json yaml toml csv log …` 以及未知扩展名的文本） | `CodeBlock`，按 `languageForPath` 高亮，带行号/复制工具栏；超长只显示前部并提示 |
| 图片 | `png jpg jpeg gif webp bmp ico svg avif apng tif tiff` | Blob URL `<img>` |
| PDF | `pdf` | Blob URL `<iframe>`（浏览器内置 PDF 阅读器） |
| HTML | `html htm xhtml` | Blob URL `<iframe sandbox>`（禁脚本） |
| Office | `doc docx xls xlsx ppt pptx` | 宿主 `officeToPdf.render` 转 PDF 后在弹窗内显示 |
| 其它二进制 | — | 说明 + “在文件窗口打开”兜底 |

### 路径解析顺序（相对路径）

1. 弹窗内当前文档所在目录（文档内相对链接）；
2. 画布当前项目的工作目录（从嵌入 SPA 的持久化 store 读活动项目的 `agentCwd`）；
3. DSH 会话列表里的各 workspace 目录；
4. ThoughtDAG 宿主桥 `/thoughtdag/api/disksessions` 返回的磁盘会话 `cwd`；
5. 持久化 store 里其它目录值。

每个候选目录拼出绝对路径后用 `remote.workspaceFiles.stat` 验证真实存在，取第一个
命中的。因此“画布工作目录”优先于外层会话 workspace，不会把嵌套项目解析错。
绝对路径链接直接 stat。

## 安装状态

- 作为 profile bundle 安装进 `web` profile：依赖
  `file:/data/dsh/home/聊天/dsh-thoughtdag-file-open/local-dsh-thoughtdag-file-open-2.2.0.tgz`，
  行 id `thoughtdag-file-open`，客户端模块 `immediately: true`。
- 依赖 `@deepseek-ai/dsh-client-ui-primitives`（DSH 平台模块表里的共享 UI 组件库），
  已写入 `dsh.client.external`。它随页面启动就绪，无需额外安装。
- Host 半边是空 `apply()`，只为了让模块系统有行可挂；浏览器 bundle 由
  client-modules 从安装目录读取，更新包后浏览器侧会热替换（Host 模块代际要求重启
  只是形式上的，因为 Host 代码为空）。
- 页面若未自动更新，刷新一次（F5）。

## 修改与重新安装

```bash
cd "/data/dsh/home/聊天/dsh-thoughtdag-file-open"
# 1. 改 client.js
# 2. 升版本号（package.json 与 client.js 里的 VERSION）
npm pack                       # 产出 local-dsh-thoughtdag-file-open-<ver>.tgz
```

然后通过 `plugin_manager` 工具（或 GUI 的 Plugins 页面）安装新的 tgz：

```
plugin_manager(action: "install_bundle",
               target: "<abs path>/local-dsh-thoughtdag-file-open-<ver>.tgz")
```

旧的 tgz 要等新版本安装成功后再删：profile 的依赖声明在安装完成前仍指向旧 tgz。

## 测试

`test/` 下两个 Node 脚本不依赖浏览器（假 window/document/React/Remote）：

```bash
node test/logic.mjs   # 各格式渲染状态、路径解析优先级、失败与截断
node test/click.mjs   # iframe 点击拦截：文件链接开弹窗，HTTP/哈希/邮件/中键放行
```

## 调试

页面 devtools 里可用手动入口（不经过点击）：

```js
await __dshThoughtdagFileOpen.open('docs/product/status.md')
__dshThoughtdagFileOpen.state()   // 当前弹窗状态
__dshThoughtdagFileOpen.close()
```

## 平台支持

- **Windows**：✅ 已在真实 Windows 主机上实测正常（画布内点击文件链接 → 弹窗预览、路径解析、行号跳转均可用）。
  路径层覆盖盘符路径 `C:\dir\file.md` / `C:/dir/file.md`、UNC `\\server\share\...`、`file:///C:/...`、
  `file://server/share/...`、反斜杠相对链接 `docs\a.md:12`；解析时统一转成 DSH 使用的正斜杠形式
  再交给宿主读取，以上写法均有单测覆盖。
- **Linux / macOS**：POSIX 路径。Linux 为当前部署环境，已实测；macOS 路径逻辑一致，但尚未在真实 Mac
  上做过端到端点击验证。
- 弹窗、Markdown/代码/图片/PDF/HTML/Office 渲染全部由 DSH 的浏览器组件完成，与操作系统无关；
  窗口标题栏/安全区交给 DSH 的 `Modal`，macOS（`data-platform=darwin`）与 Windows 标题条均由其处理。
- DSH Desktop（macOS/Windows 应用）下 Markdown 内嵌本地图片按 `document.baseURI`（`dsh-app://app/`）拼 `api/file`，
  已按此实现但未实测；其余预览走同源 blob URL，不依赖协议。

## 已知限制

- 依赖 ThoughtDAG 的 DOM 约定 `[data-dsh-thoughtdag] iframe` 与持久化 store
  （`keyval-store`/`keyval`）。插件升级若改变这些，本插件需同步调整。
- Excel 文件走 Office→PDF 转换显示（排版与 DSH 的交互式表格预览不同）；需要原始
  体验时用弹窗里的“在文件窗口打开”兜底。
- 不拦截无扩展名、且不在常见文件名清单里的相对链接（避免误伤画布自身路由）。
