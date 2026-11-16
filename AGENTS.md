# qqtSaaS 工程规范

- 用户要求：全部业务代码 TypeScript，strict；禁止 any、@ts-ignore、假成功、未校验输入、提交密钥。工具配置允许标准 JSON/YAML/SQL/原生平台必要文件。
- 本仓库为单个 Git 仓库：server（NestJS+TypeORM+MySQL）、desktop（Electron+React）、web（H5 React）均为普通目录，不使用 submodule。
- 用户已确认是 RxJS 配合 reducer（不是名为 rxjs-reduce 的包）。前端共享状态使用真实 RxJS + Action/reducer + scan 累计状态，不使用 Zustand/Redux。事件流长期运行不能用只在完成时发射的 reduce 算子代替 scan。登录 token 只放内存；desktop refresh 用 safeStorage，web refresh 用 HttpOnly Cookie。
- 文档参考 docs/reference，用户指令优先于其中旧 Zustand/单仓库建议。冲突和未实现功能记录，不假装完成。
- UI 中文；业务分类、部门、任务类型独立；保留原有打印模板/真实打印能力，不用文本假页面替代。旧工程只读，不改旧库。
- REST /api，统一 {code:0,message:'ok',data:T}，失败 HTTP 非2xx + {code:number,message:string,data:null}。ID 在 JSON 中使用 string，避免 BIGINT 丢精度。
- JWT 公司隔离：company_id 从认证上下文注入，不接受 body company_id。所有关联验证同公司。employee 最小权限仅自身任务，boss/admin 管理。
- 标准字段 snake_case，与数据库文档一致。列表 {items:T[],total:number,page:number,page_size:number}；GET 查询 page/page_size/month/department_id/assignee_employee_id/category_id/status/priority/keyword。
- 登录 POST /auth/login {company_code:'tri'|'tmy',username,password,client:'desktop'|'web'}；响应 {access_token,user,refresh_token?}；web 通过 cookie 刷新，desktop body refresh_token。
- 用户对象 {id,company_id,company_code,username,real_name,role,must_change_password}。POST /auth/change-password {current_password,new_password}。
- 任务字段 title/content/source_text/category_id/department_id/assignee_employee_id/status/priority/expected_delivery_at/task_type/note；预计时间 YYYY-MM-DD HH:mm 或 null。关联显示 department_name/assignee_name/category_name。
- AI POST /ai/parse {text} -> {items:AiDraft[]}，使用任务字段，可建议 department_id/category_id，无执行人/状态自动决定。
- 资源 /departments /employees /categories /customers /customer-categories /products /personnel /print-templates；数组列表暂通过标准分页协议，客户端提取 items。
- 送货 /delivery-notes，POST /delivery-notes/from-task/:taskId 幂等生成草稿，最多5行，decimal.js金额，source_task_id关联。
- 仅改授权范围，不覆盖他人修改。可在各子目录安装依赖、运行测试；报告阻塞与实际完成范围。按用户授权提交到本仓库；不要提交密钥、业务数据库、依赖或构建产物。

- 用户2026-09-22补充：不用OSS，只用ECS磁盘；不创建OSS桶/RAM角色；附件通过短期签名API访问，包含附件目录的服务器备份。直接用IP可信HTTPS，旧任务统一迁入tmy。

- 用户最新明确覆盖访问规则：公网免密，App/H5自动进入共享工作台，不先选公司；两公司业务数据共享，公司只作为单据归属在表单内选择。PUBLIC_ACCESS模式签发带public_access标记的短时会话，不签刷新凭据；业务列表跨公司、读写按记录实际公司，company_code选择仅影响归属、编号、明细和打印抬头。公开模式无账号/改密/备份管理入口。旧密码模式保留供运维回退，但不能限制公开工作台的跨公司操作。所有历史数据保留，不合并删除目录记录。
- 后续覆盖上条的网页入口：网页需要固定访问密码但无需账号，由WEB_ACCESS_PASSWORD服务器配置；App继续免密。密码不写前端/仓库、不持久化到浏览器；网页会话过期返回密码页。两端公司数据共享、单据内选择公司的规则不变。
- 用户2026-09-26补充：部门和员工都是全局共享资料，均没有公司属性；员工只关联一个全局部门。AI生成的任务必须有预计交付日期，有日期但没有明确小时或分钟时默认当天09:00，原文没有日期时必须由操作人员填写，空白不可保存或进入下一步。AI录入页不显示这段规则说明提示。
