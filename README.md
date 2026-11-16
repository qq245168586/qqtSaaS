# 天美意趣趣特管理系统（qqtSaaS）

当前源码版本：桌面端 **2.1.31**。包含零售订单、送货单、BOM、成本核算、员工排班、待办事项和 Confluence 文档管理。

这是完整源码仓库，`server`、`desktop`、`web` 是普通目录，不依赖 Git submodule。2026-11-16 从现有业务工程的最新提交整合，原始提交来源见 [SOURCE_SNAPSHOTS.md](SOURCE_SNAPSHOTS.md)。本次提交保存当前源码快照；原仓库和原有提交历史保留在原位置。

## 目录

| 目录 | 内容 |
| --- | --- |
| `server/` | NestJS、TypeORM、MySQL API，AI解析，数据库迁移 |
| `desktop/` | Electron + React + Ant Design 桌面 App，Windows 自动更新 |
| `web/` | 手机任务管理网页与 Confluence 页面 |
| `api-docs/` | FastAPI Swagger 文档服务与路由扫描工具 |
| `tools/`、`tests/` | 工程检查、部署与迁移工具及测试 |
| `infra/`、`docs/` | 部署说明、业务与技术文档 |

## 克隆

```sh
git clone git@github.com:qq245168586/qqtSaaS.git
cd qqtSaaS
```

## 开发

各子项目单独安装依赖，不能只在根目录安装后就直接启动所有服务。

```sh
cd server
npm ci
cp .env.example .env
# 填写本地 MySQL、JWT 等配置；勿提交 .env
npm run db:migrate
npm run dev
```

```sh
cd desktop
npm ci
npm run dev
```

```sh
cd web
npm ci
npm run dev
```

各子项目提供 `npm run typecheck`、`npm test`、`npm run build`。桌面打包见 [desktop/README.md](desktop/README.md)，本版说明见 [desktop/RELEASE-2.1.31.md](desktop/RELEASE-2.1.31.md)。Swagger 启动步骤见 [api-docs/README.md](api-docs/README.md)。根目录的依赖用于 `tools/` 和工程级测试。

## 数据与部署

- 业务数据以服务端 MySQL 为准。员工和部门全局共享，公司用于订单/送货单归属。
- 本仓库包含数据库结构、迁移和配置样例，**不包含生产数据库、真实环境配置、SSH私钥、账号密钥、依赖目录或发行安装包**。
- 服务器信息及历史部署路径保留在相关文档和现有默认配置中；开发/测试前确认 API 地址与权限，避免误操作生产数据。
- 旧部署工具及历史文档可能仍引用原服务器的独立 Git 仓库；这些是迁移前的部署记录，不是本仓库的克隆依赖。不要直接对新服务器运行引导脚本而不检查参数。
- 本次整合不改动正在运行的服务，也不改动原本地工程的 Git 远程地址。
