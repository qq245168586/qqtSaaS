# Windows 2.1.21 发布记录

日期：2026-10-12。

## 变更

- 解除过去日期的排班编辑限制：历史、今天、未来的有效日期均可新增、修改和清除。日历不再将历史格显示为不可编辑，编辑窗保留保存与清除按钮，AI预填日期不再设当天为最小日期。
- 服务器 PUT / DELETE 排班接口解除历史日期限制；真实日期校验、员工离职日期资格、并发版本、事务及审计记录保留。日期范围仍为既有2000至2099年。
- 全局AI的排班提示词允许历史补录，解析不再生成“过去不可修改”提示；最终仍由用户确认保存。
- 修改或清除历史排班后，小时余额按明细重算并影响后续月期初。例休在既有累计起始月范围内重算；未来计划仍到当天才计入累计，不直接修改余额或工资。

## 验证

- 桌面89项、服务端86项单元测试通过，strict构建和Windows NSIS打包成功。
- 控制器事务测试覆盖历史新增、修改、清除、跨月小时余额重算、历史例休扣减及清除恢复、并发冲突、非法日期拒绝与离职保护；AI解析回归覆盖历史日期保持原日期且不提示不可修改。
- 隔离Electron界面测试：2026-10-04在服务器测试日期2026-10-05之前，完成新增、再次修改、清除；当天分钟输入保存和未来例休仍通过。全部使用本地模拟API，不改变生产排班。
- 安装包内版本、renderer和Electron核心文件与构建一致；更新清单SHA512及文件大小与安装包一致。无Windows实机，未验证原生安装/升级。
- 生产HTTPS验证：历史月排班GET成功；向不存在的员工ID提交过去日期PUT/DELETE，返回员工404，不再先被历史日期400拒绝。未保存或删除真实排班；健康检查正常。

## 服务器

仅替换 employee-schedules.js、external.js、ai-assistant.js，无数据库迁移。旧文件备份于 /srv/tmy-phase2/server/dist.backup-schedule-20261012-2.1.21。

新SHA256：

- employee-schedules.js：2bee17c76b82dcdcc3c82f89b13498192dad4849d6ba05285cb6b97e68efa9f4
- external.js：00aa588880cc7fe22625b4c45aea9f00744e09c730493c402cb1c1fcff24eaae
- ai-assistant.js：35f2369656599b8256b04ade24caceb7451b68ffc27ccbfc996aa040f37ab5d6

## 安装包

TMY-TRI-Manager-2.1.21-x64-Setup.exe，111820726字节，SHA256：91dc3d5240a565081ff3305d5ed5681abb9417ebd1944d19723bc63337efebf3。

已发布至既有Windows stable更新源，更新清单备份为 latest.yml.bak-2.1.20-20261012-to-2.1.21。服务器校验整包哈希后原子切换清单；公网HTTPS清单、安装包HEAD/首尾Range、完整blockmap及API健康均通过。详细结果记录在 release/publish-2.1.21.json。

下载：<https://114.215.185.184/updates/windows/stable/TMY-TRI-Manager-2.1.21-x64-Setup.exe>。
