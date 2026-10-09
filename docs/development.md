# 开发与发行

## 环境和目录

项目使用 TypeScript、Vercel AI SDK、Zod、Vitest 和 esbuild。Node.js 要求为 22.18 或更新版本，包管理器为 `package.json` 指定的 pnpm 11.19.0。

| 路径 | 内容 |
| --- | --- |
| `src/core` | 协议、答案校验、任务编排、预算、计时和队列 |
| `src/web` | 网页组件、媒体、结果、页面映射及框架坐标 |
| `src/provider` | 配置、模型目录、能力、分批及模型请求 |
| `src/extension` | 后台、页面脚本、弹窗、设置页和任务面板 |
| `static` | Manifest、HTML、样式、图标和名称翻译 |
| `tests` | 本地检查源码；默认执行集合由 `vitest.logic.config.ts` 指定 |
| `scripts` | 构建、发行核验、人工记录及自有浏览器工具 |
| `docs` | 当前项目说明、开发说明、验证要求和未完成事项 |
| `dist` | 用户加载的正式扩展，Git 忽略 |
| `.browser-regression-runtime` | 构建暂存、隔离浏览器资料及原始报告，Git 忽略 |

根目录 `README.md` 面向扩展使用者。项目内部说明放在 `docs`。`AGENTS.md` 和 `AGENT.md` 属于本地工作规则，Git 忽略。

## 安装和检查

在项目根目录执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm verify:release
```

`pnpm check` 连续执行类型检查、默认逻辑检查和构建。`pnpm verify:release` 单独核对发行文件。默认逻辑检查使用 `vitest.logic.config.ts`，不代表 `tests` 中所有浏览器组件文件均被执行。

文档变更核对目录、引用、说明与当前源码及发行文件的一致性。涉及程序行为的变更执行类型及相关逻辑检查，并重新构建和核验发行文件。真实课程验证使用实际网站、模型和公开平台记录，状态见 [验证要求](verification.md)。

## 构建

`scripts/build.mjs` 先在 `.browser-regression-runtime/build-*` 创建独立构建，再将完整产物放到 `dist`。前一份发行文件保存在该场 `previous` 目录，构建报告保存于该场根部。

正式构建生成 `background.js`、`content.js`、`popup.js`、`options.js` 和 `tasks.js`，并复制 `static` 中的 Manifest、界面、翻译和图标。esbuild 压缩发行脚本。

`dist/build-info.json` 保存源码指纹、构建时间、正式标记和五份脚本的 SHA256。指纹包括 `src`、`static`、依赖文件和相关构建脚本；文档与测试源码不参与发行指纹。正式标记为 `test_build=false`。

## 发行核验

`scripts/verify-release.mjs` 检查：

- `package.json` 与 Manifest 版本一致，Manifest 版本为 3。
- 发行指纹与当前参与构建的源码一致。
- 五份脚本的 SHA256 与构建信息一致。
- Manifest 引用文件存在，静态资料与当前文件一致。
- 发行标记为正式构建，文件路径满足项目边界。

交付同一个 `dist` 目录后，用户重新加载浏览器中的现有扩展。Provider、凭据、浏览器资料和原始验收报告继续保留。

## 人工记录工具

`Start-VV-Acceptance.cmd` 调用 `scripts/manual-acceptance.mjs`，用于用户自行记录隔离浏览器中的操作。连接和原始报告保存在 `.browser-regression-runtime`，使用前检查工具实际配置及自有浏览器身份。

`scripts/course-tools.mjs` 提供 `status`、`inspect` 和 `verify`，用于自有课程浏览器的状态读取、页面资料采集及构建核对。执行这些工具仍需符合当前测试授权；文档整理不启动浏览器或真实模型请求。
