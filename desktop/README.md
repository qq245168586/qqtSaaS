# 天美意 / 趣趣特第二期桌面端

独立 Electron 桌面工程，将任务管理、送货单和基础资料合并；所有业务写入走 REST API；公开模式两家公司共享数据，单据选择公司归属，密码模式保留公司隔离，不访问第一期 SQLite。源代码快照：2026-09-22。

## 当前状态与必须完成的事项

- 已实现下表列出的桌面模块，并保留第一期真实打印 DOM 与 19 元素模板编辑器。
- 用户已确认使用“RxJS 和 reducer”。共享会话、任务、筛选、分页、加载错误与看板状态使用真实 RxJS 7 的 `Subject → scan(reducer) → shareReplay(1)`，React 通过 `useSyncExternalStore` 订阅；局部表单保留组件状态。没有使用等待流完成才发出的 `reduce` 算子，也没有自造同名库。
- 服务端 HTTPS 必须有被系统信任的证书。当前服务器 `https://114.215.185.184` 已部署公开可信的 Let's Encrypt 证书，使用系统 CA 正常验证；代码不关闭证书校验。开发可通过 `http://127.0.0.1:<port>` 连接本地测试或安全隧道。
- Windows 实机安装、针式打印机出纸、真实服务器附件上传和真实 AI 解析质量仍需联调验收。
- 老数据迁移由总仓库迁移工具负责，桌面没有擅自导入或删除第一期数据。

## 功能清单

| 模块 | 当前能力 |
| --- | --- |
| 登录 | 公司选择、账户密码、首次改密、退出、访问令牌内存保存、并发 401 单次刷新 |
| 安全存储 | 主进程调用登录/刷新；刷新凭据通过 Electron safeStorage 加密文件保存，绑定服务器，不返回 renderer；安全存储不可用则拒绝保存 |
| 任务 | 月份、分类“全部”、部门、执行人、状态、关键词筛选；分页表格和当前分页看板；新建、编辑、删除、六状态流转 |
| 任务字段 | 分类、部门、执行人、优先级、任务类型独立；预计交付为分钟级 datetime-local |
| 全局 AI | 顶部入口或 Ctrl/⌘+K，在任意模块识别零售订单、送货单与排班；打开原有填写页预填，由操作人员核对后创建；识别接口只读 |
| 图片 | 文件选择或表单内 Ctrl+V / ⌘V；PNG/JPEG/WebP、10 MiB、2400 万像素、最多12张；缩略图及原图预览；删除；上传失败保留待重试文件 |
| 流转 | 待发货/已发货任务一键调用幂等接口生成送货草稿，打开草稿补全 |
| 送货单 | 新建、编辑、删除、日期查询、客户产品资料带出、最多5行、Decimal 金额、署名、关联任务 |
| 打印 | 原版打印 DOM；系统打印机列表；预览、静默提交、成功后记录打印时间；最多2单合打，内置模板A4双单，自定义模板逐页打印 |
| 模板 | 原19固定元素、拖拽缩放、纸张与参考线、字号间距、边界/重叠校验、撤销重做、云端保存删除、默认模板 |
| 导出 | 任务Excel、单张/最多两张送货单原版Excel、汇总CSV；原生保存对话框 |
| 汇总 | 客户/客户分类/产品/单据四维度，日期范围，CSV |
| 基础资料 | 部门、员工、业务分类、客户、客户分类、产品、署名人员；按服务器分页完整加载 |
| 账号 | 仅boss可创建/编辑公司账号、角色、关联员工、停用；新账户强制改密 |
| 备份 | 仅boss导出JSON；恢复文件限10MiB，超限需运维离线恢复；需选择文件、手输公司代码、最终确认；服务端先生成安全备份；恢复后清理本地缓存 |
| 离线 | IndexedDB按公司+用户隔离、最长7天的成功GET只读缓存；断网阻止写请求；打印前主进程再次验证云端会话 |
| Windows 更新 | 正式安装版启动10秒后及每4小时检查；有新版时显示蓝色圆形下载按钮；后台下载完成后由用户确认重启安装 |

React 19 入口加载 Ant Design 5 官方兼容补丁，确保删除确认框和消息提示真实挂载。任务删除会清理附件并从汇总中移除；已有送货单保留“来源任务已删除”的历史摘要。任务、送货单和基础资料删除失败时显示服务器返回的具体原因。

缓存不保存账号密码、访问令牌、刷新令牌或图片实体。图片签名地址不缓存。应用冷启动必须先在线认证；离线缓存仅供已登录会话断网后继续查看已有页面，不支持离线登录。看板只展示当前分页任务，界面明确说明；完整数据通过分页切换。

## 公开共享模式

启动通过 GET `/auth/access-mode` 检查模式；公开模式自动 POST `/auth/enter` `{client:"desktop"}` 进入，不显示登录或公司选择页，顶栏显示共享工作台。任务、送货单表单默认天美意，编辑保留原公司，列表显示归属。GET `/companies` 返回标准分页公司列表。模板按公司编辑；打印和两单合打依据每单归属选择抬头及默认模板，自定义模板纸张尺寸不同需分别打印。

公开模式隐藏账号、密码、全部备份及退出入口。主进程清除旧加密凭据，访问令牌只放内存，不保存刷新凭据；401 并发请求共享一次自动重入。上表账号、备份、安全存储与退出能力只适用于密码模式，仍保留旧权限规则。

## 技术栈与结构

- React 19、Ant Design 5、Electron 39、TypeScript strict、Vite、Axios、Zod、decimal.js、RxJS 7 + reducer。
- `src/store.ts`：类型化 Action、纯 reducer、RxJS 状态流与 React 订阅。
- `src/contracts.ts`：运行时 API 校验与字符串 ID；金额API按字符串传输。
- `src/api.ts`：统一信封、认证头、刷新单飞、错误处理、完整分页加载与文件导出；Axios adapter 使用白名单主进程 HTTP 代理，不依赖 file:// CORS 豁免。
- `src/cache.ts`：只读缓存，`company_id:user_id:role:url` 键，7天TTL，退出/恢复清理。
- `src/Tasks.tsx`：任务、AI、图片表单与列表。
- `src/Deliveries.tsx`：送货单、转换打印快照、合打与汇总。
- `src/Catalog.tsx`：统一基础资料。
- `src/Admin.tsx`：老板账号管理与业务备份恢复。
- `src/PrintTemplate*.tsx`、`src/TemplatePaper.tsx`、`src/DeliveryPrint.tsx`：移植的打印编辑与渲染。
- `electron/print-template-model.ts`：纯TS模板模型及严格几何校验。
- `electron/main.ts`：受信任主frame IPC、安全存储、认证HTTP、文件保存、系统打印。
- `electron/windows-updater.ts`：Windows 更新状态机、重复检查保护与安装前置校验。
- `electron/preload.cts`：最小白名单桥，无任意IPC、shell或文件路径访问。

安全设置：`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`；拦截窗口导航与新窗口；CSP禁远程脚本；主进程检查IPC来源主frame。无本地业务数据库。

## API 合同

统一 `/api`，成功 `{code:0,message:'ok',data:T}`；错误非2xx；列表 `{items,total,page,page_size}`。JSON ID为string。公开模式任务、送货单、模板读写使用 company_code，列表含 company_code/company_name；任务转送货保留公司，已编号单据改公司由服务器重新分配编号。目录跨公司共享。密码模式仍按认证上下文限制公司。

| 功能 | 路由 |
| --- | --- |
| 会话 | POST `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`；GET `/auth/me` |
| 任务 | GET/POST `/tasks`；PUT/DELETE `/tasks/:id`；PATCH `/tasks/:id/status` |
| 图片 | GET/POST `/tasks/:id/images`，multipart字段 `file`；DELETE `/tasks/images/:id` |
| AI | POST `/ai/parse` `{text}` → `{items}` |
| 资料 | GET/POST `/<resource>`；PUT/DELETE `/<resource>/:id` |
| 模板 | GET/POST `/print-templates`；PUT/DELETE `/:id`；`config_json`为完整模板对象 |
| 送货单 | GET/POST `/delivery-notes`；GET/PUT/DELETE `/:id`；POST `/from-task/:taskId`；PATCH `/:id/printed` |
| 导出 | GET `/tasks/export`；GET `/delivery-notes/export?id=`；POST `/delivery-notes/export-batch` `{ids}` |
| 汇总 | GET `/delivery-summary?start_date=&end_date=&mode=` |
| 账号 | GET/POST `/users`；PUT `/users/:id` |
| 备份 | GET `/backup/export`；POST `/backup/restore` `{backup,confirm_company_code}` |

任务正向状态为 `todo → doing → waiting_ship → shipped → delivered`；非取消可取消，取消不可重开。客户端只提供合法下一状态，服务器仍必须独立校验。图片上传在任务保存后逐张进行，不与任务创建构成分布式事务；部分失败会留在当前编辑窗口供重试。

## 开发与运行

```sh
npm ci
npm run dev
npm run build
npm start
npm run typecheck
npm test
npm run format:check
npm run test:ui
npm run test:ui:public
```

开发Vite端口5176。Electron启动入口为 `dist-electron/electron/main.js`，预加载为同目录 `preload.cjs`。打包：`npm run package:win` / `npm run package:mac`。生产appId：`com.tmytri.manager`，不会复用第一期appId。Windows 使用 NSIS x64 和 electron-updater generic HTTPS 源；构建会生成安装包、blockmap 与 `latest.yml`。`2.1.0` 是自动更新基线，旧版需手动安装一次；以后每次发布必须递增版本。Mac、开发版和未打包程序不初始化更新器。构建产物不提交Git。

Electron ESM 主模块不可在模块顶层等待 `app.whenReady()`，否则可能与Electron模块加载形成等待循环；当前通过 `app.whenReady().then(start)` 启动。Mac开发测试使用独立Electron进程，未制作本次正式签名安装包。

## 本地数据

- 发行版内置服务器 `https://114.215.185.184/api`，登录页不要求填写地址，也不采用旧连接配置覆盖。开发版允许在独立测试目录使用 `connection.json`；加密凭据仍保存在 `session.encrypted`。
- renderer IndexedDB：`tmy-tri-phase2-readonly`，只读缓存。
- 测试可设 `TMY_PHASE2_TEST_DIR` 隔离profile，仅开发构建接受该变量。
- 退出登录撤销服务器刷新会话、清空内存令牌和当前用户缓存、删除本机加密凭据。
- 附件存放在服务器私有磁盘目录，图片通过短期签名 API URL 访问，不使用 OSS。备份应同时保留业务 JSON 和服务器附件目录；JSON 不包含图片本体，不能单独替代完整灾备。

## 打印约定与已知边界

- 打印回调成功表示作业交给系统队列，不代表物理出纸成功。
- 超时30秒会提示先检查队列；不会自动重试导致重复出纸。
- 自定义模板尺寸使用毫米，传给Electron时转为微米；主进程验证尺寸80–400×60–600mm和份数1–9。
- 真实打印保留旧送货单布局和模板编辑器。开单表单已接回旧模板文本容量限制；手工输入会按实际空间限制，历史客户、产品、人员若完整内容放不下会拒绝选择，不会截断资料。
- 送货单打印与“记录已打印”是两个系统操作。若作业已提交后网络断开，服务器可能没有打印时间；应核对系统队列，不能直接重打。
- 当前模板预览公司抬头/地址/电话沿用第一期静态配置；正式上线前核对，不从用户输入HTML渲染。
- 生产bundle存在大包提示，可进一步按路由拆分；不是类型/构建失败。

## 验证记录

- `npm run typecheck`：通过，renderer及Electron strict。
- `npm run build`：通过。
- `npm test`：合同、状态、令牌白名单、模板边界、缓存隔离/TTL/清理、纯 reducer 与实时 RxJS 状态流检查。
- Electron UI冒烟：运行脚本 `tests/smoke.ts`，使用不提供任何CORS许可的本地临时API、独立profile、生产file://页面，覆盖登录、任务、分钟时间、AI草稿、真实模板编辑器及员工权限；2026-09-22 通过；同时发现并修复了无历史单据时模板示例对象不稳定造成的渲染循环。
- 公开共享 Electron UI 冒烟 `tests/public-smoke.ts`：2026-09-22 通过自动进入、旧凭据清除、隐藏账号/备份入口、跨公司列表/表单、401 自动重入及双公司打印抬头；11 个单元测试通过。使用本地 mock API，未写入云端业务。
- 暂未证明：Windows安装与设备驱动、针式机实际出纸、真实服务器附件上传、真实AI模型质量。历史数据迁移核对结果见总工程验证记录。

### 本轮 Mac 测试包

2026-09-22 已完成生产构建与 `electron-builder --mac dir --arm64`，产物为 `release/mac-arm64/天美意趣趣特管理.app`（约359MB，Bundle ID `com.tmytri.manager`）。应用已启动，主进程及 renderer 进程正常存在；未自动使用真实账号登录。原生界面自动检查工具卡住，未能视觉确认该打包版本登录页。此前独立 profile 下的生产 file:// 桌面冒烟通过。

这是本机测试用 .app，未做开发者签名、公证或 DMG 发布；没有生成或实测 Windows 安装包。

### 公开共享模式 Mac 测试包

2026-09-22 完成共享模式严格类型构建、11 个单元测试、公开与密码模式两套 Electron UI 冒烟，并生成独立产物 `release/public-shared/mac-arm64/天美意趣趣特管理.app`。此产物尚未启动，等待云端同步部署；未覆盖此前运行的测试包。仍未签名、公证或制作 DMG，尚未进行 Windows 实机及打印机出纸验收。

共享模式后续真机验收：2026-09-22，云端 r7 部署后，已将新包同步至既有 `release/mac-arm64/天美意趣趣特管理.app` 路径。Playwright 启动此打包版并使用系统正常 TLS 连接真实服务器，确认自动显示“共享工作台”和“本月任务”，无账户登录、公司入口或账号管理。全程未创建或修改业务记录。截图保存于 `release/public-shared/shared-workspace.png`。结束验证进程后已正常打开 canonical .app 留给用户使用。

2026-09-23 已重新打包含公司建议、双向关联、汇总自动查询与附件原图本地缓存的 Mac arm64 版本，替换同一 canonical 路径并重新打开。旧 App 保留为 `release/mac-arm64/天美意趣趣特管理.before-company-links.app`。新版主进程、GPU/网络进程和 renderer 均运行，从本机验证正式 HTTPS API 与 H5 成功。验证时 Mac 处于锁屏，未进行可视点击验收；打包仍未签名/公证。

第一期兼容合并验收：2026-09-22，恢复原任务工作台导航与概览、AI 草稿批量确认、部门/员工管理、送货单表格录入、模板限字、连续纸打印兼容及完整送货汇总。15 项单元测试、三套 Electron UI 回归、生产构建及真实服务器只读打包验收通过。新包位于 `release/compat-r9/mac-arm64/天美意趣趣特管理.app`，并已覆盖到 canonical `release/mac-arm64/天美意趣趣特管理.app` 后打开；旧包保留为 `天美意趣趣特管理.before-compat-r9.app`。真实验收截图为 `release/compat-r9/live-summary.png`，未新建、修改或删除业务记录。仍未签名、公证或制作 DMG，Windows 与针式打印机物理出纸待实机验收。

### 公司建议、任务关联和附件缓存

AI 草稿显示服务器推荐公司及匹配理由。手工新任务填写标题/内容后自动查询建议，用户改选公司后不再自动覆盖；保存最终公司，由服务器判断是否学习人工纠正。任务汇总和送货列表提供双向真实关联入口；一次新的开单操作使用独立请求标识，失败重试复用标识。汇总页面首次打开及日期/模式/分类变化自动查询。

附件原图存入 Electron `userData/attachment-cache`，按服务器与不可变附件 ID 定位（服务器附件只能新增/删除，不原位替换）。列表缩略显示和放大均读取这一份本地图，不请求服务器缩略图；磁盘内容包含哈希校验，原子临时文件写入，并发读取合并。每次读取仍在线核验当前附件权限/是否删除，签名 URL 不入缓存键或磁盘。删除图片会等待进行中的下载完成后失效本地副本。Mac/Windows 使用各自标准应用数据目录；本轮没有 Windows 实机验证。


### 全局 AI 工作助手（2026-10-09）

移除零售内独立「AI订单录入」菜单，旧本机导航偏好自动迁到任务汇总。顶部 AI 助手跨页面可用，待确认内容使用 RxJS/reducer 在当前会话保留，退出清空。自动判断或手动指定零售、送货单、排班；不处理库存、部门修改、BOM、删除或打印指令。旧 `/ai/parse` 保留给现有网页和旧客户端。

`POST /ai/assistant/parse { text, module: 'auto'|'retail'|'delivery'|'schedule' }` 返回带模块、原文依据、预填值与缺项提示的草稿。原文必须真实包含引用片段；未知ID不能由模型决定。公司、执行人、渠道继续按现有历史习惯匹配。送货商品保持自由输入，不查询金蝶库；未知数量/单价、无明确日期留空。日期范围排班逐日预填；历史日期也支持预填并确认保存，离职资格和版本冲突由原排班接口再次校验。

识别不写业务表，不提供批量直接创建。每项打开对应 TaskForm、DeliveryForm 或共用 ScheduleEditor，由用户点击保存。创建成功卡片禁用再次创建；任务附件失败保留已创建ID以便重试；保存按钮有并发锁。当员工当天已有排班时，表单提示原班次并改为「确认修改排班」。单张送货单仍保留5行限制。

验证：两端 strict 类型检查/构建通过，各84项单元/控制器测试通过。新增测试使用模拟模型与只读SQL桩，不触碰生产业务记录；真实模型联调及本机UI检查的完成情况见当次交付说明。本次不生成或发布安装包。


Windows 2.1.20 恢复更新：更新确认采用受控 Modal，不依赖旧版静态弹窗。安装助手通过系统绝对路径启动并返回就绪信号后才退出；失败保留 App 并显示重试/手动下载入口。已下载更新不会在普通退出时重复安装。2.1.7 旧客户端的弹窗缺陷无法由服务器修复，需要一次手动安装本版，之后使用新版更新流程。详见 RELEASE-2.1.20.md。

## 2.1.21 历史排班编辑（2026-10-12）

历史、今天和未来日期均可通过排班编辑窗新增、修改或清除；AI也允许历史日期预填。离职资格、并发版本和真实日期校验保留；历史调整按明细重算小时余额及例休天数，未来计划不提前计入累计。见 `RELEASE-2.1.21.md`。
