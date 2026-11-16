# Windows 2.1.17 发布记录

2026-10-07 11:14（北京时间）按用户要求发布到既有 Windows stable 自动更新渠道。

## 本版内容

- 客户对账改为 Excel 导出：天美意、趣趣特各自独立文件，每份包含「汇总」「明细」两张 Sheet，保留精简字段并对齐原对账文件格式。
- 按筛选后的完整送货单数据导出，不读金蝶商品库；单据金额每张只计一次，数量按单位分别统计。
- 排班增加独立例休余额：每月四天、已休扣减、未休跨月结转；加班调休小时仍单独计算，增加「按计划执行后余额」。
- 保留 2.1.16 的 BOM 整蛋默认折算、送货列表拖动宽度及完整日期显示等功能。

## 验证与发布

- 75 项桌面测试通过；TypeScript strict、Vite 和 Electron 构建通过。
- App 实际操作导出九月天美意/趣趣特各自的御牛纪和意未共四份文件，两张 Sheet、明细和金额逐项核对一致。
- Windows NSIS x64 包版本为 2.1.17；包内 renderer、主进程、更新器与本次构建一致，Excel 导出分块和例休界面均已包含。
- 安装包大小 111810323 字节，SHA-256：`f2d53f51a05e7f4ecc1e86b0f19730239b43ca00a09004a6d1f163b0ff22bea1`。
- SHA-512：`ICVVvoYr2m6xuofNQgzq1/eaNOJjbMa8e9oUo5KQRB54qTWt8okjZDavMcv5KNgYamH1Os80kr4SyfHMTgKzmQ==`。
- 安装包、blockmap 和版本清单先上传，服务端完整大小和哈希校验通过后，备份旧清单并原子切换 latest.yml。
- 公网 HTTPS latest.yml 返回 2.1.17，禁止缓存；安装包 HEAD 返回 200、长度正确，首尾分段与本地一致；blockmap 完整哈希一致；API 健康检查正常。本轮未另做公网整包下载验证。
- 例休服务端功能此前已部署，本次无需重启服务器或修改生产数据。
- 沿用既有 Windows 更新器；未在 Windows 实机执行安装或打印机出纸验收。Mac 自动更新不在本次发布范围。

下载：<https://114.215.185.184/updates/windows/stable/TMY-TRI-Manager-2.1.17-x64-Setup.exe>

上一版清单备份：`/srv/tmy-phase2/updates/windows/stable/latest.yml.bak-2.1.16-20261007`；2.1.16 安装包仍保留。
