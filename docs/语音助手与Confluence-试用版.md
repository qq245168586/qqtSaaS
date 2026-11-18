# 语音助手与 Confluence 试用版

日期：2026-11-17。当前为开发预览，不提升 App 安装包版本。

## 使用

- App 全局 AI 助手、网页 AI 页：点击语音输入开始录音，显示真实声音波形和时长；结束后转成可编辑文字，再点击识别生成业务草稿。原有模块保存前仍须人工确认。
- 网页补充待办草稿：可编辑标题、起止时间、一次性/月度及备注，默认未完成。结束时间必填。保存期间禁止重复点击。
- Confluence：点击「页面」新建，或已有页面 Edit，在正文上方展开「语音／口述整理为文档」。可以录音、导入短录音、粘贴文字；选择备忘录或正式文档，预览后确认加入正文。也可不调用模型，直接把原文加入正文。结果追加到现有内容，标题非空时不覆盖标题，用户最后点击保存。
- 录音仅作临时输入/回听，不作为长期音频附件存入文档。这期不做长会议录音、说话人分离、自动关联客户、向量检索。

## 接口和权限

- `GET /api/ai/voice/status`：查询可用状态。
- `POST /api/ai/voice/transcribe`：multipart file，客户端转为16kHz单声道16位PCM WAV，服务端校验头部、长度和120秒限制。
- `POST /api/ai/voice/document`：`{text, style: 'memo' | 'document'}`，返回 `{title, sections:[{heading,text}]}`，只生成草稿，不写数据库。
- 当前 AI 配置为 `api.deepseek.com` 时，复用现有加密保存的 Key，调用 `https://api.deepseek.com/v1/tools/asr`，不会将密钥传给客户端。可通过 ASR_TRANSCRIPTION_URL / ASR_API_KEY / ASR_MODEL 显式接入其他兼容服务。
- DeepSeek ASR 按音频时长计费，整段识别而非流式识别，单次最多120秒。客户端约119秒自动停止，为录音封装留出时间余量。导入文件需浏览器可解码且不超过120秒/20MB。
- 同时最多处理2个语音/文档请求，每IP每阶段每分钟最多6次。日志只记录阶段、请求编号、耗时和结果，不记录密钥、录音或全文。
- Electron 仅允许主窗口可信页面请求音频权限，上传白名单仅放行 WAV 到转写接口；Windows/macOS 提供麦克风隐私设置入口。Mac 安装包声明麦克风用途。网页必须HTTPS并由用户授予站点权限。
- Confluence 专用会话只额外允许三个语音草稿接口，仍不能调用订单、备份或模型设置接口。

## 验证

- 服务端111项、桌面端99项、网页18项测试通过；三端类型检查与构建通过。
- Electron 隔离测试使用虚拟麦克风：录音、转写回填、Confluence 整理预览与插入正文通过，未触发业务写入。
- 已使用现有服务器 DeepSeek 配置发送3.742秒合成测试音频；ASR HTTP200，正确识别「明天下午五点之前完成二楼物料盘点。」未使用真实客户录音。
- 仍需真实 Windows 麦克风、系统拒绝/允许权限及手机 Safari/微信内置浏览器的设备验收，不能以 Mac 虚拟设备测试代替。
- 2026-11-18 经用户明确授权，服务端、H5、Confluence 已发布生产；App 仅本地运行，未发布安装包。
- 上传包 SHA256：`5c3db3b1d5b706911fb5c31614811d7d179bda8f058ba364bc07d328b6b9b247`。
- 回滚备份：`/srv/tmy-phase2/server/dist.before-voice-20261118`、`/srv/tmy-phase2/web.before-voice-20261118`、`/srv/tmy-phase2/wiki.before-voice-20261118`。
- 上线后通过公网业务接口验证：ASR 正确识别合成音频；待办草稿包含起止时间、默认未完成；Confluence 专用会话可生成文档草稿，但访问任务接口仍为403；H5、Wiki页面及脚本资源均为200。没有保存测试任务或文档。
- API、Nginx、MySQL 运行正常；Windows `latest.yml` 哈希发布前后一致，仍为2.1.31。

参考：[DeepSeek ASR 官方说明](https://api-docs.deepseek.com/guides/asr/)。
