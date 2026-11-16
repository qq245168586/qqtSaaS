# 第二期云端服务

独立 TypeScript / NestJS 11.2.5 / TypeORM / MySQL 8 后端。成本核算与现有业务共用服务器MySQL，通过独立成本表隔离。使用 `strict` 类型检查，禁止显式 `any` 和跳过类型检查。全部业务 API 前缀 `/api`。不读取、不修改第一期 SQLite；迁移原数据由总仓库工具负责。

## 启动

运行环境 Node.js 22，MySQL 8.0，单服务实例。

```sh
npm ci
cp .env.example .env
# 填写 DB_*、JWT_SECRET（至少32字节随机值）、INITIAL_ADMIN_PASSWORD（12–72字节）
npm run db:migrate
npm run db:seed
npm run build
npm start
```

生产 `HOST=127.0.0.1`，Nginx 负责 HTTPS，`COOKIE_SECURE=true`。数据库会话默认时区应配置 `+08:00`；连接池上限10，关闭 synchronize。首次种子为 tri/tmy 分别新增 admin（boss），强制修改密码；已存在账户不覆盖。账户密码不写入源码、终端日志或仓库。

部署同时保留 `dist/`、`resources/delivery-template.xlsx`、`package*.json` 和运行依赖。`npm run build` 复制迁移 SQL 到 dist。生产建议 systemd 单实例管理；这是与参考文档 PM2 方案的部署差异，不支持直接开启多实例恢复服务。

## 协议和鉴权

正常 JSON 为 `{code:0,message:'ok',data:T}`，失败为非2xx及 `{code:HTTP状态,message,data:null}`。文件下载直接返回 XLSX 二进制。所有 BIGINT ID 在 API 中使用字符串。

- `POST /auth/login`：`{company_code,username,password,client:'desktop'|'web'}`；返回 `{access_token,user,refresh_token?}`。
- `POST /auth/refresh`：`{client,refresh_token?}`；web 从 HttpOnly/Secure/SameSite=Strict Cookie 读取。刷新令牌只有 SHA256 摘要落库，每次刷新事务轮换；旧令牌不可复用。
- `GET /auth/me`：当前用户。
- `POST /auth/logout`：Bearer access + `{client,refresh_token?}`，撤销当前刷新凭证。
- `POST /auth/change-password`：`{current_password,new_password}`，bcrypt cost12，撤销全部刷新令牌；客户端应重新登录。新密码至少8字符、最多72 UTF-8字节。
- `GET/POST /users`、`PUT /users/:id`：仅 boss；员工账户明确关联 `employee_id`，不按姓名猜测账号归属。

Access 有效2小时，refresh 30天。每次 API 都查询用户当前启用状态和公司；body 不允许注入 company_id。初次改密前仅可访问 me/change-password/logout。登录失败5次冷却30秒（单进程内存限流，还需 Nginx 限流）。boss/admin 管理业务；employee 仅能查看和推进自己分配的任务，不能新建、改分配或删除任务。员工账号不能访问全公司送货单、财务汇总、资料管理列表或打印模板。

## 主要端点

| 功能                       | 路由与规则                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 任务列表                   | `GET /tasks`；page/page_size（默认20、最大200）、month、department_id、assignee_employee_id、category_id、status、priority、keyword；返回 `{items,total,page,page_size}` |
| 任务统计                   | `GET /tasks/stats`，返回6个状态计数，遵守用户及筛选范围                                                                                                                  |
| 任务详情、新建、修改、删除 | `GET/PUT/DELETE /tasks/:id`、`POST /tasks`；删除任务会清理图片，关联送货单保留已删除来源摘要                                                                             |
| 批量创建                   | `POST /tasks/batch {items:[...]}`，最多200，单事务全成全败                                                                                                               |
| 状态推进                   | `PATCH /tasks/:id/status {status}`，逐步推进或取消；取消不可重开                                                                                                         |
| 图片                       | `GET/POST /tasks/:id/images`；POST multipart `file`；`DELETE /tasks/images/:imageId`；GET标准分页对象，url/thumbnail_url为5分钟签名                                      |
| AI解析                     | `POST /ai/parse {text}` → `{items:[draft]}`；仅返回建议，不能自动保存或分配执行人/状态                                                                                   |
| 基础资料                   | `GET/POST /departments,/employees,/categories,/customers,/customer-categories,/products,/personnel`；`PUT/DELETE /资源/:id`                                              |
| 送货单                     | `GET/POST /delivery-notes`、`GET/PUT/DELETE /delivery-notes/:id`；列表亦附带items                                                                                        |
| 任务转单                   | `POST /delivery-notes/from-task/:taskId`；待发货/已发货可转，任务行锁+唯一约束幂等返回同一草稿                                                                           |
| 打印成功记录               | `PATCH /delivery-notes/:id/printed`；仅正式单据，客户端真实打印成功后调用                                                                                                |
| 汇总                       | `GET /delivery-summary?start_date=&end_date=&mode=customers                                                                                                              | categories | products | notes` |
| 模板                       | `GET/POST /print-templates`、`PUT/DELETE /print-templates/:id`；config_json为完整19元素模板对象；复用旧模板物理边界/重叠校验                                             |
| 任务Excel                  | `GET /tasks/export`，沿用列表筛选，最多10000条，不嵌入图片                                                                                                               |
| 原版送货Excel              | `GET /delivery-notes/export?id=` 或 `/export-template?id=`；`POST /delivery-notes/export-batch {ids:[...]}` 最多2张                                                      |
| 送货明细报表               | `GET /delivery-notes/export?start_date=&end_date=`，最多50000明细行                                                                                                      |
| 备份                       | `GET /backup/export`（boss），当前公司的业务数据JSON，不含登录账户/密码/刷新令牌                                                                                         |
| 恢复                       | `POST /backup/restore {backup,confirm_company_code}`（boss），详见下文                                                                                                   |
| 健康                       | `GET /health`，真实查询数据库                                                                                                                                            |
| 成本原料                   | `GET/POST /cost/materials`、`PATCH /cost/materials/:id`；Decimal128价格版本，通用/趣趣特/天美意范围                                                                      |
| 成本资料导入               | `POST /cost/materials/import/parse` 或 multipart `/file` 只生成草稿；`POST /cost/materials/import/confirm` 确认后写入                                                    |
| 成本SOP                    | `POST /cost/sops/parse` 只预填，`POST /cost/sops` 保存价格快照，`GET /cost/sops` 汇总                                                                                    |

任务请求字段：title/content/source_text/category_id/department_id/assignee_employee_id/status/priority/expected_delivery_at/task_type/note。content/note 对应数据库 detail/remark。预计时间必须 `YYYY-MM-DD HH:mm` 或 null，不能编造日期缺失的具体时间。月份先按预计交付，否则按创建时间。创建必须有效部门和部门内在职员工；历史离职员工原关联可保留。部门/员工存在任意非取消任务（包括已交付）禁止删除或调部门。任务使用软删除；删除时原子清理服务器图片，已有送货单继续显示“来源任务已删除”的历史摘要。

送货单请求使用数据库文档 snake_case：delivery_date、customer_id、customer_*_snapshot、maker_name/warehouse_name/sales_name/deliverer_name、is_draft、items。明细 product_name/spec/unit/quantity/unit_price/remark。数量和金额接受十进制字符串，最多两位小数，禁止负数；每单最多5行，逐行 decimal.js 四舍五入到分再求和。正式单据必须客户及至少一行；草稿不生成正式单号。原版 Excel 沿用公司模板行列、合并单元格和打印页面设置，金额读取已计算的十进制结果。资源模板已清除非打印模板中的原始业务数据。

## 数据库与迁移差异

18表保留数据库文档字段与索引。初始 migration 是明确DDL，不自动同步或覆盖现有表：

- users 增加 employee_id 和 must_change_password，用于严格员工权限及首次改密。
- delivery_notes.note_number 允许 null，对应无正式号草稿。
- `(company_id,source_task_id)` 唯一，转单幂等；已经删除的关联单据不会默默再生成新单。
- BIGINT保留字符串；金额DECIMAL(12,2)；逻辑外键由服务校验。
- 软删除名称保持原名，因此同公司同名资料删除后暂不可直接重建（数据库唯一索引仍占用），历史展示不被改名后缀污染。
- seed 公司全称当前为简称，请上线前核对正式主体抬头；打印模板资源保留原App抬头，不能替代企业资料核实。

## 图片与AI

图片保存到服务器私有目录 `ATTACHMENT_DIR=/var/lib/tmy-phase2/attachments`，不使用OSS或RAM。每个文件以公司/任务/UUID组织，目录0700、文件0600；PNG/JPEG/WebP输入经验证转换PNG，≤10MiB、≤2400万像素、每任务≤12张。原子排他创建，禁止路径穿越、软链接与覆盖不同内容。数据库失败清理本次新建文件。

读取只通过 `/api/files/image` 的5分钟HMAC签名URL；签名绑定完整key、原图/缩略图用途及到期时间，并使用JWT_SECRET派生的专用签名密钥。未签名、过期、篡改或任意路径均拒绝。响应为image/png、nosniff、private缓存。Nginx **不得**将附件目录alias公开。`BASE_URL` 配置实际HTTPS站点（当前为IP地址）。数据库暂保留历史字段名 `oss_key/oss_url`，分别保存本地受限key与`disk://`引用，不代表使用OSS。

AI从服务环境变量获取密钥，不返回客户端；60秒超时，无自动重试；校验JSON字段、当前公司分类部门名称，不信任模型返回任意ID。仅把用户粘贴文本和有效分类部门名称发送至模型；不发送账户密码、图片。暂未启用 ai_configs 公司级模型偏好界面，当前共用服务配置。

## 备份恢复

恢复仅影响当前公司15张业务表；不恢复 companies/users/refresh_tokens。JSON版本2，表集合完整、ID与关联有效、任务字段与送货金额等校验，跨公司ID冲突直接拒绝。恢复前在 BACKUP_DIR 写入权限0600安全快照，快照失败不改库；随后单个MySQL事务删除当前公司业务行并恢复。当前进程在恢复期间拒绝其他业务写入；发现已有写入时拒绝开始恢复。故必须单服务进程，不能与其他直写SQL任务并发恢复。

备份JSON包含磁盘附件引用而非图片二进制，必须同时备份私有附件目录；恢复JSON不自动删除磁盘文件。恢复有10MiB请求上限、单表20000行限制，较大数据应由运维离线恢复。当前不支持跨公司克隆或第一期JSON直接导入。恢复数据库之前仍应进行mysqldump/云快照以保留账户和全实例灾备。

## 验证与边界

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

本地验证包含状态矩阵、分钟时间、十进制、company_id注入、5行约束、19元素模板、两家公司1/2张Excel结构导出。云端真实MySQL联调结果由总仓库验证记录统一记录，不能把纯单元测试当作真实部署测试。

仍需后续完成或验证：任务批量状态接口、客户资料自动补齐、拼音服务器检索、公司级AI配置管理、定时数据库/附件备份调度、大批量迁移性能、服务器磁盘容量与附件备份恢复演练、真实大模型识别效果、Windows打印机实机测试。后台没有任务自动推送或离线写入队列。暂无账号密码重置端点；账号生命周期当前仅新增/修改/禁用。

## 依赖安全升级记录

2026-09-22 生产依赖审计发现原 Nest10 的 Multer、sharp 高风险，以及 core/file-type/uuid/qs 中风险。没有执行 `npm audit fix --force`：

- Nest common/core/platform-express 同步升至11.2.5（没有跳到12），修复 core 与 file-type；Express随上游升级为5。服务要求Node22满足运行时要求。
- Nest11仍固定旧Multer2.2，因此仅对 `@nestjs/platform-express > multer` 定向覆盖2.4.0。现有FileInterceptor/memoryStorage API保持兼容，类型升级 `@types/multer` 2。
- sharp 升0.35.4，修复图片解码库漏洞。
- ExcelJS仅调用 `uuid.v4()`，对 `exceljs > uuid` 定向覆盖11.1.1（保留CommonJS导出）。不采用审计建议的ExcelJS降级。
- 升级后 `npm audit --omit=dev` 为0项漏洞；该结果仅表示查询时已知依赖公告，不能替代应用安全测试。
- 重新验证严格构建、备份字段与公司隔离纯测试、原版Excel导出、Nest实际路由注册、sharp图像转换、ExcelJS条件格式及UUID兼容性。云端最终回归由总仓库记录。

## 旧系统数据迁移 CLI

必须使用已导出的 SQLite **备份副本**；源库通过 Node22 `DatabaseSync({readOnly:true})` + `query_only` 打开，不升级、不改表、不迁移原密码/API密钥。任务库全部归入用户确认的 **tmy**，送货库按原 tri/tmy 公司区分。

```sh
# 默认仅检查源库并输出数量/风险，不连接MySQL、不写附件目录
node dist/import-legacy.js --delivery /secure/delivery.sqlite --tasks /secure/orders.sqlite
# 云库先完成独立快照；停止其他写入；确认dry-run后才执行
node dist/import-legacy.js --delivery /secure/delivery.sqlite --tasks /secure/orders.sqlite --source-key initial-v1 --execute
# 以送货 SQLite 为唯一基准：事务内清空送货单、关联和送货基础资料后完整重建；任务与全局打印模板保留
node dist/import-legacy.js --delivery /secure/delivery.sqlite --tasks /secure/orders.sqlite --source-key initial-v1 --replace-delivery --execute
```

先校验两库完整性、关联、分钟时间、5行金额、模板和图片，再连接MySQL。存在图片时先检查私有附件目录与签名配置，不可用则在任何MySQL写入前失败。每条 UUID/integer旧ID在app_meta维护新BIGINT映射与内容指纹；同一source-key重跑跳过已完成行，源内容变更拒绝覆盖。同名种子部门/分类复用并保留原历史属性；没有迁移标记的其他同名云资料或历史单号冲突拒绝覆盖，需人工核查。缺失旧创建时间使用本次迁移首次时间（记录持久标记以保证重跑稳定）；旧任务仅日期则预计时间设null，原日期写入备注，不伪造午夜。

`--replace-delivery` 仅用于用户明确指定 SQLite 为送货数据唯一基准的维护窗口。送货单、明细、任务关联、客户/产品/人员/客户分类、送货纠正样本和对应迁移映射会与完整导入处于同一个 MySQL 事务；任一步失败全部回滚。任务、任务图片、部门、员工、业务分类和云端全局打印模板不会删除或覆盖。

关系与映射处于同一个MySQL事务。图片逐张读取，写入服务器私有目录；失败回滚关系并清理本次新建文件，清理失败明确报错。迁移不创建账号，不复制旧settings或启动密码；AI配置由运维单独配置，不输出密钥。原单号/客户快照/人员署名/历史打印时间/打印模板保留。已有账号仍需由管理员显式绑定新员工ID。

用户已明确选择只使用服务器存储，因此不配置OSS、RAM角色或任何对象存储凭据。迁移CLI与API使用同一个DiskStorage provider。附件文件与MySQL不是分布式事务；进程意外终止仍可能留下孤儿文件，需根据数据库引用定期对账，不能直接按文件年龄删除。

## 用户授权的公开共享模式

`PUBLIC_ACCESS=true` 开启用户明确授权的公网免密共享工作台；任何可访问站点者均可查看、修改两家公司的业务数据。默认false，原密码账号仍按公司隔离。

- `GET /auth/access-mode` 返回 `{public_access:boolean}`；`POST /auth/enter {client:'web'|'desktop'}` 返回标准 `{access_token,user}`，无需选公司。
- 公开身份基于tmy现有管理员，JWT与user带public_access:true，2小时有效，无refresh、无Cookie；默认身份公司不是业务权限边界。关闭开关立即使公开token失效。
- `GET /companies` 为标准分页列表。任务、送货单、目录、模板返回company_code/company_name。公开写入用company_code选择归属，创建默认tmy，编辑省略则保留；禁止传company_id。批量任务各items可分别携带company_code。
- 所有业务列表、详情、修改和删除跨公司；目录可跨公司关联。任务换公司同步图片归属并保留原私有文件位置。正式送货单换公司重新分配目标公司单号并同步明细；来源任务转单全局幂等。
- 公开身份禁止整个/users、整个/backup和/auth/change-password。完整备份由运维执行主机备份工具。正常密码账号保留原行为。
- 客户端清空旧refresh凭证，过期重新调用enter；携带公开Bearer的refresh请求拒绝。首次改密标记只在公开身份响应中屏蔽，不修改账号。

### 网页固定密码入口

生产由运维在服务器环境配置 `WEB_ACCESS_PASSWORD`（不写入源码或客户端）。`GET /auth/access-mode` 同时返回 `web_password_required:boolean`。配置非空时，网页调用 `POST /auth/enter {client:'web',password}`；错误或缺失密码返回401中文提示，同IP在15分钟内失败10次后返回429，成功清除该IP失败记录。限流为当前API进程内存，重启清空。密码SHA-256摘要后进行常量时间比较，不返回客户端、不写日志。

桌面仍使用 `{client:'desktop'}` 免密进入共享工作台。这是用户要求的网页入口密码，不改变桌面/API免密访问能力；客户端类型不是受信任安全边界。空环境值保留之前网页免密行为，密码账号模式独立保留。

## 全局通用打印模板

打印模板现在为两家公司共用，`/print-templates` 列表/详情/写入不再按公司隔离，也不返回或接受 `company_id/company_code`。已有密码管理员同样使用全局模板；员工权限不变。模板 `config_json.companyId` 旧字段可读取兼容，验证后剥离；8列/9列配置均保留，由列数决定规格列的合并/分开，抬头由实际送货单公司决定。新建模板默认9列。

模板存在时始终保留一个全局默认；首个模板自动默认，选择新的默认替换原默认，删除默认后选择最近更新的剩余模板。新建/修改非默认不会清空现有默认。全局同名模板允许共存，防止迁移不同公司同名模板时丢失；界面使用ID辨别。

`GlobalTemplates1790091000000` 迁移需在已完成主机完整快照的维护窗口执行（停止旧API写入后运行 `dist/migrate.js`，再启动新版API）。迁移保留每个模板ID、名称、布局和原更新时间；有旧默认时优先其中最近更新者，否则选择最近更新者。旧company_id变为NULL，不再代表权限归属；旧公司索引移除；生成列 `global_default_slot` 的唯一索引从数据库层确保最多一个未删除默认。MySQL DDL会自动提交，每步支持失败后重跑；不支持自动向下迁移，需恢复快照回退。新库也经同一迁移链初始化。

公司级JSON备份的print_templates保留空数组以兼容格式，恢复遇到非空旧公司模板备份明确拒绝，避免覆盖全局模板；全局模板随主机MySQL全量备份保留。旧SQLite导入仍按原映射标记/指纹实现重跑幂等，新导入模板写入全局，不覆盖既有默认。

## 公司建议与人工纠正学习

`POST /company-suggestions {text}` 与每个AI草稿均返回 `{company_code,company_match}`。匹配信息包含 `source: learned/default/fallback`、中文 `reason`、0～1的 `confidence`（规则强度而非统计校准概率）、`keyword:string|null`、`sample_count:number`、`agreement:number`。主营规则：蛋糕、定制蛋糕、茶歇、月饼、糕点、蛋黄酥、饼干、曲奇、甜品、点心→趣趣特；意大利面、意面、方包、吐司、面条、制面、鲜面、面包→天美意。混合主营或未知商品暂选天美意并明确低置信、需要确认。所有建议均可由人修改。

只在任务/正式送货单保存事务内、显式提交company_code且与服务端当时建议不同才采样。编辑还要求公司实际改变；保存前先删除该记录旧票再算建议，避免自我影响。接受建议、AI识别、草稿送货单、导入旧记录不会增加学习样本。任务从标题和详情（详情空时用原文）提取已知商品关键词；送货单还学习明确商品名称。每记录/关键词唯一，反复编辑不会刷票；改回建议会撤回旧票，删除记录撤回样本；事务失败回滚。近180天至少3条纠正样本且一家公司占比至少70%才覆盖主营默认，优先更具体的长关键词。公司级备份恢复清除被替换记录的票，不把恢复操作算人工纠正；全量主机备份含学习表。

任务/送货单创建未提交公司时服务端应用建议，编辑未提交公司时保留原归属。AI按建议公司匹配同名部门/分类，该公司不存在该名称返回null，不拿另一家公司同名ID代替。

## 一项任务关联多张送货单

`POST /delivery-notes/from-task/:taskId {request_id:UUID}` 创建新草稿。同一任务同一request_id重试返回原单，不重复创建；换新request_id可创建另一张。无body旧调用兼容返回最早已有单；已删除请求对应单据明确报错，不偷偷重建。任务必须待发货或已发货才可新增，已完成请求重试不受随后状态变化影响。

送货列表和详情新增 `source_task:{id,title,status,company_code,company_name,deleted_at,deleted}|null`，保留历史已软删任务摘要。任务列表/详情新增 `delivery_note_count:number` 与 `delivery_notes` 摘要数组（id/source_task_id/note_number/delivery_date/is_draft/company_code/company_name）；另有 `GET /tasks/:id/delivery-notes` 同摘要分页结构，`GET /delivery-notes?source_task_id=...` 查完整关联单据。只计未删除的单据，每单一条，绝不按明细行数累计。删除任务不会删除已有关联送货单，送货单继续显示已删除来源摘要。

## 汇总空结果与部署

2026-09-23只读核查线上四种9月汇总均200且有数据；当时正式单290张、9月5张，其余主要在8月，未发现API把非空结果丢弃。汇总现在统一note_count/item_count/customer_count为number，保留金额/数量十进制值，支持company_code筛选；响应附filters、available_range（第一天/最后一天/正式单总数）及empty_reason，区分暂无正式单与日期/分类无匹配。草稿不计入汇总。

新增迁移 `CompanyLearningLinks1790100000000`：建立company_choice_samples，送货单新增conversion_request_id，移除旧一任务一单唯一索引，新增source_task查询索引及(task_id,request_id)唯一索引；旧记录/原关联不修改、不凭空生成纠正票。使用information_schema和原生DDL，支持重跑；先主机快照、维护窗口迁移后启动新版API。公司级备份不含全局学习表，主机全量备份包含。

2026-09-23 已在指定 ECS 的正式 MySQL 执行该迁移：先使用正式库一致性副本跑两次迁移并核对列/索引，再停止 API、完整导出正式库、切换 dist 后迁移。`tmy-api`、Nginx 与 MySQL 恢复 active，内网及公网健康端点均通过。回退库位于 `/var/backups/tmy-phase2/before-company-links-c5df765.sql`，旧程序位于 `/srv/tmy-phase2/server/dist.before-c5df765`。

## 全局 AI 草稿解析（2026-10-09）

新增 `POST /api/ai/assistant/parse`，入参 `{ text, module: 'auto'|'retail'|'delivery'|'schedule' }`。只查询现有目录和历史习惯并调用已配置模型，返回 `{ items: [{ module, source_text, warnings, value }], clarification }`；不包含写库、删除、打印或执行任意工具的能力。未知模块、无原文依据、指定模块不一致和同一资料同时解析成零售/送货单会拒绝。模型ID和未知字段被剥离，员工由服务端按现有姓名、离职日期及历史规则匹配，公司使用主营/已保存习惯及原文显式公司。

零售沿用任务字段和09:00缺时默认，渠道复用 `orderChannels`；送货商品不访问金蝶/BOM资料，缺失日期/数量/价格留空，交给原送货表单填写；排班保留日期范围、一人一天草稿、9小时班次、加班/调休分钟及独立例休天数的既有规则。无日期必须人工填写。操作人员在原有业务表单确认后，再调用原任务/送货/排班写接口；这些接口的日期、员工资格、并发版本等校验继续生效。旧 `/ai/parse` 兼容原网页与旧安装版。

新增 `tests/ai-assistant.test.ts` 验证模块边界、日期范围、离职员工、未填写字段与只读SQL；服务端84项测试及strict构建通过。生产升级仅替换 `dist/external.js`、新增 `dist/ai-assistant.js`，原文件备份在 `dist.backup-global-ai-20261009`；无需数据库迁移。

2026-10-10 全局 AI 生产实测补充：模型可能返回 null 默认枚举、日期仅到日/ISO时间和未提及的加班/调休分钟数 null；只在助手模型响应层归一化这些可默认值，原文日期规则和最终业务写入校验仍保持。新增两项回归后服务端86项测试通过。最终部署 ai-assistant.js SHA256 为 d4e094c110510207319448ecf9adea174a9f22c086a7acfe469de6a6179e4072，备份 dist.backup-global-ai-20261010-r4；生产模型和桌面三类预填均验收，无业务记录保存。

## 2026-10-12 历史排班日期限制解除

`PUT/DELETE /employee-schedules/:employeeId/:date` 不再限制日期必须为今天或未来；仍校验真实日期、员工离职资格、并发版本，事务更新并追加审计。历史修改实时影响小时累计，例休在既有起始月范围内重算。AI排班提示词及草稿警告同步解除历史日期限制。无数据库迁移，生产替换三个相关编译文件前备份到 `dist.backup-schedule-20261012-2.1.21`。
