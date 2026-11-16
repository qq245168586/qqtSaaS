# 服务器完整备份与恢复

本方案配套 `tools/backup-host.ts`，仅为部署准备，编写期间**没有在云端执行备份、停服务或安装定时任务**。使用服务器本地存储，不依赖 OSS。

## 覆盖范围与权限

一次备份生成一个独占创建的 `.tar.gz`，包含：

- `database.sql`：完整 `tmy_tri_manager` 数据库，包括账户、刷新令牌、业务数据与迁移映射。
- `attachments/`：`/var/lib/tmy-phase2/attachments` 全部私有附件。
- `git/`：`/srv/tmy-phase2/git` 下四个裸仓库 phase2/server/desktop/web。
- `manifest.json`：快照时间、源路径、数据库名、服务原状态和一致性说明。

备份目录必须由 root 拥有，脚本设为0700；临时文件、SQL、最终备份0600。目标文件存在即拒绝，不覆盖、不自动轮换删除任何历史备份。脚本只输出备份路径、SHA256、字节数，绝不输出数据库内容、密码、环境配置或子命令stderr。

**数据库完整备份本身包含敏感数据。** 不要把归档放入Git仓库、Nginx静态目录或公开下载页。此归档没有自动加密；跨机保存应走受控加密通道与受限存储。`/etc/tmy-phase2/server.env`、Git认证配置、TLS私钥及交接密码文件不在此归档中，应另行保存在密码保险库/受限配置备份中，不应输出到日志。

## 一致性和维护窗口

脚本先记录 `tmy-api.service`、`tmy-git.service` 是否运行；仅停止原本active的服务。API和Git均确认停止后才进行 `mysqldump`、裸仓库fsck及附件/Git归档，最后校验tar与SHA256。这样数据库与附件处于同一静止窗口，Git推送不会在归档中途改变引用。

`finally` 尝试恢复原本运行的服务，不会擅自启动原先inactive/failed的服务。异常、超时、SIGINT/SIGTERM均进入恢复流程；服务恢复失败会明确返回失败，即使备份文件已成功保存。服务器断电、内核崩溃或SIGKILL无法执行finally，必须人工检查并恢复服务。

注意：维护窗口内网页API暂不可用，Git克隆/推送暂不可用；停止Git可能中断正在进行的推送。应安排在无操作的凌晨时段，并确保没有独立SQL写入、迁移CLI、直接附件修改或Git命令在运行。数据库用户不能提供给其他应用同时写入。单实例服务方案下，这是比“仅mysqldump单事务然后复制附件”更可靠的简单一致性方案。

## 手工首次部署和演练

服务器要求：Node22、MySQL8 `mysqldump`、GNU tar、Git、systemd。先完成TypeScript严格编译，将脚本编译为 `/srv/tmy-phase2/infra/tools/backup-host.js`，由root拥有，普通服务用户不可修改。

首次建议由root手动执行，确认业务和Git恢复后再启用定时：

```sh
/usr/bin/node /srv/tmy-phase2/infra/tools/backup-host.js \
  --output /var/backups/tmy-phase2/manual-20260922-01.tar.gz
```

默认数据库 `tmy_tri_manager`、附件路径 `/var/lib/tmy-phase2/attachments`、仓库路径 `/srv/tmy-phase2/git`。可通过 `--database`、`--attachments`、`--repositories` 显式配置；目标必须为专用备份子目录，不能位于被备份源目录内。

默认使用本机root Unix socket认证：`--no-defaults --protocol=socket --user=root`。若数据库要求密码，使用root拥有、权限0600的MySQL配置文件，并传 `--mysql-defaults /etc/tmy-phase2/backup-mysql.cnf`：

```ini
[client]
user=实际备份账号
password=由管理员在服务器安全填写
host=127.0.0.1
port=3306
```

不把密码放在命令参数、环境输出或本文件真实样例中。备份账号需有目标库SELECT、SHOW VIEW、TRIGGER、EVENT，以及导出例程所需权限；默认root本机模式已具备。工具使用 `--no-tablespaces`、`--set-gtid-purged=OFF` 和 `--single-transaction`，不修改数据库、不锁整实例其他库。

## 以后需要自动化时的 systemd 参考

当前仅建议用户在手动维护窗口运行，本轮不安装每日停机任务。以下两个单元仅供未来明确启用定时备份时参考，不会自动创建或启用。

`/etc/systemd/system/tmy-backup.service`：

```ini
[Unit]
Description=TMY consistent database attachments and Git backup
After=mysqld.service
Requires=mysqld.service

[Service]
Type=oneshot
User=root
Group=root
UMask=0077
# 时间戳用于唯一文件名；不会覆盖已有备份
ExecStart=/bin/sh -c 'exec /usr/bin/node /srv/tmy-phase2/infra/tools/backup-host.js --output /var/backups/tmy-phase2/host-$(date -u +%%Y%%m%%dT%%H%%M%%SZ).tar.gz'
TimeoutStartSec=2h
TimeoutStopSec=5min
KillMode=mixed
```

`/etc/systemd/system/tmy-backup.timer`：

```ini
[Unit]
Description=Daily TMY backup at 03:30 Asia Shanghai

[Timer]
OnCalendar=*-*-* 03:30:00 Asia/Shanghai
Persistent=true
AccuracySec=1min
Unit=tmy-backup.service

[Install]
WantedBy=timers.target
```

`Persistent=true` 表示错过计划后开机补跑，可能在营业时间造成维护窗口；如不能接受，改为false。首次演练成功后再由管理员 `systemctl daemon-reload`、`systemctl enable --now tmy-backup.timer`。通过 `systemctl status tmy-backup.service`、`journalctl -u tmy-backup.service` 和两个业务服务状态监控结果，接入失败告警。不要只凭备份文件存在判断服务已恢复。

脚本以 `/run/tmy-phase2-backup.lock` 排除并发备份，不自动删除已有锁。断电/强杀后如发现锁，先检查记录PID及所有备份/迁移进程，确认无任务运行并恢复服务，再由管理员手动移除锁；不要盲目重复运行。

## 恢复演练

1. 在隔离测试服务器确认SHA256及tar可读取，并检查manifest和归档条目；禁止直接将不可信归档解包到 `/`。
2. 备份恢复前先保留当前实例快照，停止API/Git及其他所有写入作业。
3. 将归档解包到root私有临时目录。完整SQL会恢复目标数据库，导入前核对数据库名与环境，禁止误导入生产库。
4. 同时恢复MySQL、attachments目录、四个Git裸仓库，不混用不同快照时间的数据库与附件。
5. 修正附件归属为 `tmy-app:tmy-app`（目录0700、文件0600）；裸仓库归属 `tmy-git:tmy-git`；核对SELinux、systemd ReadWritePaths及服务器配置秘密已安全恢复。
6. 对四仓库运行git fsck；核对任务、送货单、图片行数及迁移映射，抽样确认签名原图/缩略图可访问，旧签名应因短时有效而自然失效。
7. 启动服务，验证登录、任务、送货单、Excel、图片以及认证Git推拉，记录恢复所需时间与结果。

单机磁盘损坏会同时损坏原数据和同机备份。本脚本负责一致性快照，不代表已具备异地灾备。另行复制到受控的独立磁盘/服务器，并定期恢复演练。没有配置任何自动清理，必须监控剩余磁盘容量；空间不足时备份会失败并尝试恢复原服务。
