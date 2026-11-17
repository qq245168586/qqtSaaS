# 阿里云实例部署与运维

指定实例 `i-bp1gy4to0n4dh5gk7tuw`，公网 IP `114.215.185.184`，内网 IP `172.24.231.114`。实例与 IP 关系已由 Workbench ECS 查询核实。远程运维使用已配置的 Workbench：

```sh
workbench exec -i i-bp1gy4to0n4dh5gk7tuw -c 'systemctl status tmy-api nginx mysqld'
```

运行环境为阿里云 Linux 4，Node.js 22 / MySQL 8.0 / Nginx，使用 systemd 守护；不套用原输入文档的 Ubuntu/apt/PM2 命令。

## 位置与网络

| 路径 | 用途 |
| --- | --- |
| `git@github.com:qq245168586/qqtSaaS.git` | 唯一源码仓库，main 分支，server/desktop/web 为普通目录 |
| `/srv/tmy-phase2/infra/` | 编译后的部署与备份工具 |
| `/srv/tmy-phase2/server/` | API 部署 |
| `/srv/tmy-phase2/web/` | H5 静态产物 |
| `/srv/tmy-phase2/updates/windows/stable/` | Windows 自动更新安装包、blockmap 与 `latest.yml` |
| `/etc/tmy-phase2/` | 权限保护的服务器凭据与服务环境 |
| `/var/lib/tmy-phase2/attachments` | 私有附件，环境变量 `ATTACHMENT_DIR` |
| `/etc/nginx/conf.d/tmy-phase2.conf` | HTTPS、API、H5、Wiki 与更新下载转发 |
| `/etc/my.cnf.d/tmy-phase2.cnf` | MySQL 本机绑定、内存与北京时间配置 |
| `/etc/letsencrypt/live/tmy-phase2-ip/` | 当前公开可信 IP 证书与私钥 |

2026-11-17 停用自建 Git。`tmy-git.service` 停止、禁用并 mask，7001 不再监听，`/git/` 返回 HTTP 410。旧仓库和 Git 专用配置移至 `/var/backups/tmy-phase2/git-retired-*/`，父目录权限 0700，仅用于历史恢复，不再接收推送。

以后从 GitHub 克隆、提交和推送：

```sh
git clone git@github.com:qq245168586/qqtSaaS.git
cd qqtSaaS
git push origin main
```

代码在开发机按提交构建，经 Workbench 上传构建产物后激活。生产服务器不需要 GitHub 写入密钥，也不通过旧 Git 推送钩子部署。GitHub 托管源码；`/api/`、`/h5/`、`/wiki/` 和安装包下载仍由当前 ECS 提供。`tools/retire-host-git.ts` 是本次一次性退役工具，默认仅检查，`--apply` 才执行；不能在退役后重复运行。

Windows 正式安装版从 `https://114.215.185.184/updates/windows/stable/` 读取更新。Nginx 只允许 GET/HEAD，不列出目录；版本化安装包和 blockmap 使用长期缓存，`latest.yml` 禁止缓存。发布顺序必须是：先上传安装包和 `.blockmap`，核对 `latest.yml` 中的文件名、大小和 SHA-512，再最后原子替换 `latest.yml`。这样正在检查更新的客户端不会读到半套文件。更新文件是公开下载物，目录中不得放凭据、源码或业务数据。

`2.1.0` 是第一版具备自动更新能力的 Windows 基线包，旧版需要手动安装一次。此后应用启动 10 秒后检查，每 4 小时再次检查；发现新版会后台下载，由用户点击“重启安装”。Apple 版本不初始化自动更新。

## 公开可信 IP 证书与续期

用户明确选择直接使用 IP。Let's Encrypt IP 证书已签发并上线，Nginx 读取 `fullchain.pem` / `privkey.pem`；无需域名、无需导入旧自签证书，不关闭浏览器、Node 或 Git 的证书验证。

`tools/ip-certificate.ts` 的 activate 流程安装：

- `tmy-certificate-renew.service`：执行 `/opt/tmy-certbot/bin/certbot renew --quiet`，成功部署后先 `nginx -t` 再 reload。
- `tmy-certificate-renew.timer`：每日 00、06、12、18 时检查，随机延迟最多 300 秒，`Persistent=true`。
- HTTP-01 验证目录 `/var/lib/tmy-acme/http/.well-known/acme-challenge/` 由 80 端口提供，其余 HTTP 请求跳转 HTTPS。

每 6 小时是**检查续期频率**，不是承诺每次重新签发。IP 短有效期证书尤其需要监控定时器、续期失败与证书剩余时间。已配置续期不等于已经观察到下一周期的成功续签；该项保留运维验收。

```sh
systemctl status tmy-certificate-renew.timer
systemctl list-timers tmy-certificate-renew.timer
journalctl -u tmy-certificate-renew.service
nginx -t
```

`infra/trust/114.215.185.184.crt` 是早期自签证书留档，不用于当前信任。旧工作副本如仍配置局部 `http.sslCAInfo` 指向它，应撤掉该过期配置，使用系统可信根；禁止 `http.sslVerify=false`。

## 私有磁盘附件

附件不使用 OSS、RAM 或其他对象存储。`ATTACHMENT_DIR` 指向服务器私有目录，目录权限 0700、文件 0600。`BASE_URL` 使用实际 HTTPS IP 站点。

- 文件按公司/任务/UUID 组织；上传校验格式、体积、像素及任务张数。
- 原图和缩略图通过 `/api/files/image` 的短时 HMAC 签名 URL 读取；原有任务图片列表仍提供 `url` / `thumbnail_url`。
- Nginx **不得**为附件目录配置公开 alias；不直接暴露磁盘路径。
- 数据库保留 `oss_key/oss_url` 历史字段名，仅承载本地 key 与 `disk://` 引用。
- JSON 业务备份不含附件文件本体，恢复数据库时须核对磁盘引用与实际文件。

本地文件系统和 MySQL 不构成分布式事务。程序处理正常错误时回滚并清理本次文件，但进程意外退出可能留下孤儿文件；需要按数据库引用对账，不可按文件年龄任意清理。

## 部署升级

当前r8使用 `PUBLIC_ACCESS=true` 共享业务模式；App自动进入，网页由 `/etc/tmy-phase2/web-access.env` 中的 `WEB_ACCESS_PASSWORD` 校验固定访问密码（root:tmy-app 0640）。该文件通过 `web-password.conf` systemd覆盖配置载入，不随Git分发。公共会话不开放账号/改密/备份接口；源码权限由GitHub管理。API仅绑定loopback，Express只信任loopback反向代理，Nginx追加真实来源IP供网页密码失败限流。

新主机初始化工具 `tools/bootstrap-host.ts` 遇到已有文件拒绝覆盖，不能当作任意重跑的升级脚本。后续升级采用新版本构建、验证、迁移和受控切换；迁移失败不能继续启动假成功服务。旧 SQLite 与第一期程序保持原状。

部署需要分别记录源码提交、构建验证、服务器激活和健康检查。已经上传静态文件，不代表桌面发行包或所有外部服务已经验收。完整证据见 [验证记录](../docs/VALIDATION.md)。

## 备份与迁移

GitHub 源码、MySQL、附件目录、服务器环境密钥须分别备份并核对恢复能力。服务器业务备份不再依赖旧 Git 服务或裸仓库；业务 JSON 不包含用户密码或附件本体。应为 MySQL 使用一致性备份，备份附件时协调写入窗口，定期演练成套恢复。

旧数据迁移已完成：送货保留原公司，旧任务全部归 tmy；只读取 SQLite 备份副本，不改原库。289 张送货单的公司数量、369 行明细、金额汇总及 1 张图片的 SHA-256 已与源快照核对一致；重复执行无新增。迁移前备份位于 `/var/backups/tmy-phase2/before-legacy-r2.sql`。

完整维护窗口备份工具和恢复流程见 [备份说明](../docs/BACKUP.md)。工具已通过类型检查，但本轮未执行全实例恢复演练、未开启自动停机备份。日常定时备份及容量告警仍需安排。
