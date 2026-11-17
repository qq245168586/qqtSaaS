# 自建 Git 退役记录

执行日期：2026-11-17（北京时间）。唯一工作仓库：`git@github.com:qq245168586/qqtSaaS.git`，分支 `main`。

## 已执行

- ECS `i-bp1gy4to0n4dh5gk7tuw` 上的 `tmy-git.service` 已停止、禁用并 mask；7001 端口不再监听。
- Nginx 移除 Git 代理及专用限流区，`/git/` 返回 410；配置校验通过，仅 reload，业务 API 未重启。
- 原四个裸仓库通过 `git fsck --full`，整体移至 `/var/backups/tmy-phase2/git-retired-2026-11-17T08-31-46-715Z/repositories`，未删除提交历史。
- 同一私有目录保存原 Nginx 配置、Git 服务单元、Git 专用认证配置及服务程序；目录权限 0700，不在静态下载目录中。
- 移除源码中的 Git HTTP 服务和密码 helper；初始化工具不再创建 Git 服务，服务器备份工具仅处理 MySQL 和附件。两项编译后的工具已上传到生产运维目录；未运行数据库备份或新主机初始化。
- GitHub 当前源码为 2.1.31 快照，旧分仓库完整历史仅保留作档案，不拼接到 main。开发使用 `qqtSaaS` 工作目录，不再使用旧 `第二期` 分仓库提交业务修改。

## 验证

- 根目录 TypeScript 检查、构建通过；`node --import tsx --test tests/*.test.ts` 通过（1 项）。
- 退役工具在服务器只读预检查通过后才执行 `--apply`。
- `tmy-git`：inactive / masked；`tmy-api`、`nginx`、`mysqld`：active。
- 公网 `/git/server.git/info/refs?service=git-upload-pack`：410。
- 公网 `/api/health`：200 / status ok；`/h5/`、`/wiki/`：200。
- `/updates/windows/stable/latest.yml`：正常返回 2.1.31，安装包路径保持不变。本次未发布新 App。

## 后续部署

在 GitHub 仓库提交并推送，经检查的构建产物通过 Workbench 上传 ECS 后激活。源码托管和业务部署是两件事：GitHub push 本身不会自动发布 API 或 App。服务器无须持有 GitHub 写入密钥。

如需检索退役前历史，管理员在私有备份中使用 `git --git-dir=<仓库> log`，不要恢复公网 Git 服务。业务恢复流程见 `docs/BACKUP.md`，旧 Git 档案不参与日常业务备份。
