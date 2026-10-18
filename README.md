# dsh-thoughtdag-file-open

让 ThoughtDAG 画布里的**文件链接**在**当前页面弹窗**里打开，而不是把画布 iframe
导航到 `/thoughtdag/docs/...` 这种画布渲染不了的地址；也不切换主视图、不跳页。

3.0.0 在 2.2.0（只读预览）的基础上重做弹窗：

- **多标签页**：每次点击文件链接开一个标签，重复点击同一文件只切换并定位行号；
  Markdown 正文里的相对链接也在新标签中打开。标签支持中键关闭、悬停关闭、脏标记。
- **最大化**：右上角按钮（或 `Ctrl/⌘+Shift+M`）让弹窗铺满视口，再点还原；
  关闭弹窗后恢复默认尺寸。
- **更精致的弹窗**：不再沿用 Modal 的 28px 面板圆角，改为 `--dsw-radius-lg`（16px）
  + 0.5px 描边 + 标签栏，整体由 DSH 主题 token 与 UI primitives 构成，和聊天/设置
  等原生界面同一套观感；亮/暗主题自动跟随。
- **文件编辑**：默认始终是**预览模式**；文本类文件（Markdown、代码/文本）右上角有
  「编辑」按钮，进入编辑后出现「取消 / 保存」。编辑器是 **vendored 的 CodeMirror 6**
  （首次点「编辑」才懒加载，约 700 KiB），带语法高亮（复用 DSH 聊天的 `--shiki-*`
  配色）、行号、当前行、括号匹配、自动补全、搜索（`Ctrl/⌘+F`）、多光标、折叠、
  完整 undo/redo；Markdown 自动换行，代码不换行。保存走 Host 半边的认证路由，带
  **版本号乐观锁**：磁盘上的文件被别人改过会弹出冲突条（重新加载 / 仍然保存），
  不会静默覆盖。截断读取的大文件、图片/PDF/HTML/Office 不提供编辑。
- **多文件模块化**：入口 `client.js` + 7 个按需加载的包内 chunk（见下）。

## 行为

- 点击画布 iframe 内的文件链接：拦截默认导航 → 解析真实路径 → 在**当前页面**弹出
  文件预览（新标签）。画布保持原样，不切面板、不换会话。
- **普通 HTTP(S) 超链接完全不处理**：不拦截、不 `preventDefault`、不 `window.open`。
- `#/...` 画布内部路由、`mailto:` 等 scheme、无扩展名的普通路由：一律放行。
- 链接判定：非 HTTP(S) 的相对/绝对路径，且带扩展名（字母开头，如 `md`/`py`/`png`），
  或是常见无扩展名文件名（`Dockerfile`、`Makefile`、`README` 等），或是 `file://`、
  `/绝对路径`。
- 行号定位：`#L92`（支持 `#L92-L99` 取首行）与 `:48`（也支持 `:48:7`）都识别为
  **同一文件 + 目标行**；预览时跳到该行，编辑时把光标放到该行。
- 解析/打开失败：底部 toast；不可预览格式在弹窗内给「在文件窗口打开」兜底。

### 渲染支持

| 类型 | 扩展名 | 渲染方式 |
|---|---|---|
| Markdown | `md markdown mdown mkd mkdn mdwn` | `MarkdownText`（GFM + TeX，同聊天渲染；本地图片经 `/api/file` 显示） |
| 代码 / 文本 | 其它可读文本 | `CodeBlock`，按 `languageForPath` 高亮，行号/复制/换行工具栏 |
| 图片 | `png jpg jpeg gif webp bmp ico svg avif apng tif tiff` | Blob URL `<img>` |
| PDF | `pdf` | Blob URL `<iframe>` |
| HTML | `html htm xhtml` | Blob URL `<iframe sandbox>`（禁脚本） |
| Office | `doc docx xls xlsx ppt pptx` | 宿主 `officeToPdf.render` 转 PDF 后显示 |
| 其它二进制 | — | 说明 + 「在文件窗口打开」兜底 |

### 快捷键

- `Ctrl/⌘ + E`：在预览 / 编辑之间切换（仅文本类文件）。
- `Ctrl/⌘ + S`：保存当前标签的编辑内容。
- `Ctrl/⌘ + Shift + M`：弹窗最大化 / 还原（右上角也有按钮）。
- `Ctrl/⌘ + F`：编辑器内搜索（编辑器内 `Esc` 先关搜索面板，不会误关弹窗）。
- `Esc`：有未保存修改时先弹出确认卡；否则关闭弹窗。
- 中键点击标签：关闭该标签。

### 编辑器（CodeMirror 6，vendored）

- **懒加载**：vendor chunk 只在第一次点「编辑」时请求，之后由浏览器模块表缓存；
  预览模式零成本。
- **主题**：chrome 全部用 DSH token（背景、行号槽、当前行、选中、搜索面板、
  补全浮层、折叠占位）；语法颜色直接复用 DSH 主题里的 `--shiki-token-*` CSS 变量，
  所以编辑器和聊天里的代码块是同一套配色，亮/暗主题切换即时跟随。
- **语言**：Markdown(GFM)、JS/JSX/TS/TSX、JSON、Python、HTML、CSS/SCSS/Less、
  XML/SVG、YAML、SQL、Shell；其它文本按纯文本编辑。
- **兜底**：vendor chunk 加载失败时自动退回 textarea + 行号槽编辑器，保存/冲突流程不变。
- **性能**：CodeMirror 6 的虚拟化滚动与增量解析，大文件也比 textarea 流畅；草稿文字
  以 180ms 防抖回写标签状态，保存/切标签/关闭时 `flush()` 取实时文档，不会丢键。
- **体积**：`client.codemirror.js` 约 696 KiB（gzip ~248 KiB），仓库内提交；
  运行时无 npm 依赖，也没有写进 `dsh.client.external`。

### 未保存修改

关闭脏标签、关闭弹窗、编辑态点「取消」都会弹确认卡：取消 / 放弃修改 / 保存并关闭
（关闭弹窗时会把所有脏标签逐个保存后再关闭）。

## 结构（多文件模块化）

浏览器侧是一个入口 + 七个包内动态 chunk，用
`require.async("./client.<name>.js")` 按需加载（DSH client-modules 原生支持的
`client.<name>.js` 分包约定，同一个包可以有多份 chunk）：

```
client.js             入口：标签状态、对话框骨架、画布点击桥、编辑/保存/冲突流程、i18n
client.util.js        纯函数：路径/href/行号/文件类型判定（无 React、无 Host 访问）
client.remote.js      远端：workspace 读、画布目录解析、能力探测、保存路由调用
client.styles.js      仅主题 token 的样式表（含 CodeMirror 宿主的布局）
client.tabs.js        标签栏、未保存修改确认卡
client.preview.js     只读预览体：Markdown / 代码 / 图片 / PDF / HTML / Office
client.editor.js      CodeMirror 6 编辑器：挂载、语言、主题、草稿/脏标记/光标定位
client.codemirror.js  vendored CodeMirror 6 打包产物（生成文件，见下）
```

Host 侧 `host.js` 只做一件浏览器做不到的事：在 `/api` 的浏览器认证栅栏内注册两个
精确路由：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/thoughtdag-file-open` | GET | 能力探测（是否有保存能力） |
| `/api/thoughtdag-file-open.save` | POST | `{ path, content, expectedVersion?, force?, sessionId? }` → `{ ok, version, operation, bytes }` |

写入经 `ctx.fs.writeText`（原子写 + 版本号），并按调用会话的 `sandboxPolicy`
（无会话时用部署默认）执行沙箱检查；`expectedVersion` 不匹配返回 `409 FS_STALE_VERSION`。

### CodeMirror 的 vendoring

CodeMirror 6 的 npm 产物是裸说明符 ESM，浏览器不能直接加载，所以仓库里做**一次性**
预构建，把结果提交为包根的单文件 chunk：

```
vendor/codemirror/package.json     钉死的 18 个 @codemirror/@lezer 版本
vendor/codemirror/entry.js         esbuild 入口（只导出编辑器用到的 API）
vendor/codemirror/package-lock.json
vendor/codemirror/LICENSES.md      自动生成的第三方许可证（MIT）
scripts/vendor-codemirror.mjs      预构建脚本
client.codemirror.js               产物：IIFE + ModuleLoader 包装（运行时不需构建）
```

因此：**运行时零依赖、不写 `dsh.client.external`、不依赖 DSH 打包流程**；升级
CodeMirror 时在仓库内重跑一次脚本即可（见“修改与重新安装”）。

### 关于 `@deepseek-ai/dsh-client-ui-primitives`

本插件沿用 v2 的共享平台模块依赖（写在 `dsh.client.external` 里），因为
Markdown（GFM/TeX）、代码高亮（Shiki）与 Modal/Toast 必须和聊天界面同源；自己复制
一份会立刻和 DSH 的渲染漂移。代价是 DSH 升级若重命名这些导出，插件需要同步：
入口在 `apply` 开头校验必需导出，缺失时只打一条 `console.warn` 并停用（不会让
`shell.overlay` 的 slot entry 抛错）。样式只引用 `--dsw-*` / `--ds-*` token，没有
任何字面颜色。

## 安装状态

- 已作为 profile bundle 安装进 `web` profile：
  - 包 `@local/thoughtdag-file-open`（目录名是 `dsh-thoughtdag-file-open`），版本
    `3.0.0`，行 id `thoughtdag-file-open`；
  - profile 依赖是指向本目录的 `link:`，所以**修改本目录的客户端文件即热更新**；
  - 旧的 `@local/dsh-thoughtdag-file-open@2.2.0` bundle 已移除（其 profile 依赖指向
    一个已不存在的 tgz，会阻塞 pnpm 安装）。
- 包名与目录名不同是有意为之：DSH 的 Loader 按**模块说明符**缓存 Host 模块代际，
  同一个包名在进程内不会重新 import。升级需要让 Host 半边（保存路由）立刻生效时，
  换一个新包名（以及新的入口文件名 `host.js`）即可避免重启 dsh；纯客户端改动不需要。
- 客户端模块 `immediately: true`，`external` 只声明 `@deepseek-ai/dsh-client-ui-primitives`。
- 页面若未自动更新，刷新一次（F5）。

## 修改与重新安装

```bash
cd "/workspace/dsh插件开发/dsh-thoughtdag-file-open"
node test/logic.mjs    # 客户端逻辑 + 浅渲染（22 项）
node test/route.mjs    # Host 保存路由（8 项）
```

- **只改 `client*.js`**：`link:` 安装下由 client-modules / HMR 自动重载，刷新页面即可
  （任意 chunk 改动请同时 touch `client.js`，因为分包地址的 rev 来自入口文件元数据）。
- **改 `host.js`（Host）**：Host 模块是 Node 侧 ESM，代际不会热替换，需要重启 dsh
  进程；重启后 `plugin_manager` 里的 bundle 仍是启用状态。
- **升级 CodeMirror**：改 `vendor/codemirror/package.json` 里的钉死版本后重建产物
  （首次需要联网装包，`vendor/codemirror/node_modules` 已被 gitignore）：

  ```bash
  node scripts/vendor-codemirror.mjs           # 安装（如缺）+ esbuild + 许可证
  node scripts/vendor-codemirror.mjs --refresh # 强制 npm ci 后重建
  ```

- 改版本号时同步 `package.json` 与 `client.js` 里的 `VERSION` 字符串。

## 调试

页面 devtools 里：

```js
await __dshThoughtdagFileOpen.open('docs/product/status.md')  // 走一次链接解析
await __dshThoughtdagFileOpen.openAbsolute('/abs/path/file.md', { line: 12 })
__dshThoughtdagFileOpen.state()      // { tabs, activeId, confirm }
__dshThoughtdagFileOpen.active()     // 当前标签（含 draft / version / conflict）
__dshThoughtdagFileOpen.tabs()       // 精简标签列表
await __dshThoughtdagFileOpen.edit() // 当前标签进入编辑
__dshThoughtdagFileOpen.draft('...'); await __dshThoughtdagFileOpen.save()
__dshThoughtdagFileOpen.confirmDiscard?.()
__dshThoughtdagFileOpen.close()
// 编辑器诊断：mode 是 codemirror / fallback，附失败原因、文档行数、多光标开关、
// 以及最近 120 次按键从 keydown 到 update 的延迟分位
__dshThoughtdagFileOpen.editorDiagnostics()
```

## 测试覆盖

- `test/logic.mjs`（22 项）：chunk 分包与注册、vendor 产物自注册/版本/许可证头、
  链接分类、打开/去重/激活/关闭、预览→编辑→保存（含 expectedVersion）、冲突与 force、
  不允许保存时只读、脏标签关闭确认、保存并关闭、相对链接解析、浅渲染出的弹窗 DOM
  结构、编辑态 CodeMirror 宿主与脏标记。
- `test/route.mjs`（8 项）：路由注册、能力探测、版本锁、force、会话 sandbox 策略、
  409 stale、相对/缺失/非文件/超大拒绝、错误码映射。
- `scripts/smoke-editor.mjs`（可选，7 项）：jsdom + 真实 React + 真实 vendor/editor
  chunk 的集成冒烟——挂载、行号槽、DSH token 主题与 `--shiki-*` 语法色、TS 高亮、
  真实编辑触发的脏标记/防抖草稿/flush/baseline、冲突重载替换文档、Markdown 换行。
- `scripts/smoke-app.mjs`（可选，5 项）：从真实入口/Overlay 打开文件、点「编辑」，
  验证 CodeMirror 真的挂载（而非 fallback）、语法 token、多光标 facet + 多选区状态、
  打字出现脏标记、保存清脏、Markdown 换行。
  两个 smoke 依赖不在插件内，按脚本头部注释在临时目录装
  `jsdom react@18 react-dom@18` 后运行：

  ```bash
  EDITOR_SMOKE_DEPS=/tmp/dsh-editor-smoke node scripts/smoke-editor.mjs
  EDITOR_SMOKE_DEPS=/tmp/dsh-editor-smoke node scripts/smoke-app.mjs
  ```

## 已知限制 / 验证状态

- 依赖 ThoughtDAG 的 DOM 约定 `[data-dsh-thoughtdag] iframe` 与持久化 store
  （`keyval-store`/`keyval`）。插件升级若改变这些，本插件需同步调整。
- 保存在部署 `sandbox-policy` 为 `read-only`、或目标不在该会话 workspace 且模式为
  `workspace-write` 时会被拒绝（返回 403 `FS_SANDBOX_DENIED`，界面 toast 报错）——
  与 DSH 的沙箱语义一致，不是绕过。
- 本次会话已做：Node 单测（22+8）、Host 路由真实 POST 验证（成功/409/400/409 目录）、
  页面模块图与 7 个 chunk 可访问性、live Client slot 注册校验、jsdom + 真实 React
  的编辑器集成冒烟（7 项）。**没有浏览器控制权，编辑器的视觉/输入手感未经真机验证**；
  如观感或手感要再调（间距、行高、语法色、搜索面板样式），改 `client.editor.js` 的
  `editorTheme()` / `client.styles.js` 即可热更新。
- 编辑器已知取舍：编辑器内是纯文本源码（Markdown 不做所见即所得实时预览）；搜索/
  补全浮层按 DSH token 装饰但布局沿用 CodeMirror 默认；vendor 产物升级后需要
  touch `client.js` 让分包 rev 变化。
- **排障**：如果编辑态上方出现黄色提示条 `CodeMirror 没有启动成功…`，说明
  vendor chunk / 扩展集在浏览器里启动失败，提示条里带原因，同时 console 有
  `[thoughtdag-file-open]` 的 error。此时 `__dshThoughtdagFileOpen.editorDiagnostics()`
  会返回 `mode: 'fallback'` 与失败原因。正常情况下它返回 `mode: 'codemirror'`
  和按键延迟分位（p50/p95），可直接判断是不是编辑器本体慢。
- 源码就是本仓库（`/workspace/dsh插件开发/dsh-thoughtdag-file-open`），profile 以
  `link:` 指向它，所以本目录既是源码也是已安装包；改客户端文件即热更新。旧的 2.2.0
  代码已被本次改动替换，`local-dsh-thoughtdag-file-open-2.2.0.tgz` 是遗留构建产物
  （`.gitignore` 里的 `*.tgz`），可以删除。