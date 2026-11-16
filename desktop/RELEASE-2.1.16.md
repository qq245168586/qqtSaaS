# Windows 2.1.16 发布记录

2026-10-06 21:41（北京时间）按用户要求发布到现有 Windows stable 更新渠道。

## 本版内容

- 供应链送货汇总增加客户销售明细对账、公司与跨公司客户筛选和完整结果 CSV 导出；金额使用送货单保存值，单据金额只计一次。
- BOM 配方按整蛋折算蛋黄、蛋白，默认整蛋 50g、蛋黄 17g、蛋白 33g，不要求额外重量确认，保留损耗说明。
- 送货单列表与预览之间允许拖动调宽，本机记住宽度；送货日期及录入时间完整显示并允许换行。
- 本轮核对补齐的九月送货单已写入生产数据库，客户端刷新即可读取，不包含在安装包中。

## 验证与发布

- 71 项单元测试、TypeScript strict 检查、Vite 与 Electron 构建通过。
- Windows NSIS x64 包生成成功；包内版本 2.1.16，renderer、主进程和更新器与本次构建一致。
- 安装包大小 107467508 字节；SHA-512：`eFVr/2pgfQp/Fysa5wq8sYpGDDpuZjo5Wkgx5xldjANqw2cfvpuPvKRUwqeu5J3WuLPFOXuNE/VyezSnezgiLg==`。
- 先上传安装包、blockmap 与版本清单，服务端全部校验一致，再备份旧清单并原子切换 latest.yml。
- 公网 HTTPS HEAD 返回 200，长度正确；安装包首尾分段请求返回 206，与本地内容一致；blockmap 校验通过。
- 公网整包下载检查超过 120 秒超时，未将它计作整包下载验证通过；完整文件哈希已在服务器验证。
- 公网 latest.yml 返回 2.1.16，Cache-Control 为 no-store/no-cache；API 健康检查返回 200。
- 沿用既有 Windows 更新器；本次未在 Windows 实机执行安装或打印机出纸验收。Mac 自动更新不在发布范围。

下载：<https://114.215.185.184/updates/windows/stable/TMY-TRI-Manager-2.1.16-x64-Setup.exe>

服务器上一版清单备份：`/srv/tmy-phase2/updates/windows/stable/latest.yml.bak-2.1.15-20261006`，2.1.15 安装包仍保留。
