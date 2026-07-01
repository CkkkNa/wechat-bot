# PROGRESS - wechat-bot

已完成：
- 本地项目已初始化并提交，代码已成功推送到 GitHub：https://github.com/CkkkNa/wechat-bot
- 实现 Express 回调服务（index.js），监听 3001，支持接收 JSON 与 XML（企业微信明文模式）并解析文本消息
- 收到文本消息后调用本机命令 `copilot -p "消息内容"` 并将输出通过企业微信 API 主动回复
- 集成 programmatic localtunnel/localtunnel 库尝试创建公网隧道（在本环境未成功），并记录错误日志
- README.md、deploy-guide.md、.env.example 已生成并包含部署与 Token/EncodingAESKey 生成说明
- 服务已在后台启动（查看 /tmp/wechat-bot.pid 与 /tmp/wechat-bot.log 确认）

部署与公网地址：
- 自动部署到 Railway 未在本环境完成（需要 Railway 账户与 GitHub 授权）。请在 Railway 控制台根据 deploy-guide.md 手动部署仓库。
- 部署成功后，请将返回的 HTTPS 服务域名例如 `https://xxx.up.railway.app` 写入仓库的 `.env` 中 `CALLBACK_URL` 字段，并在企业微信后台配置回调 URL 为 `https://xxx.up.railway.app/wechat/callback`。

本地服务状态：
- 后端监听：http://localhost:3001
- 后端日志：/tmp/wechat-bot.log
- 后端 PID 文件：/tmp/wechat-bot.pid

我需要您在回来后完成的手动步骤：
1. 在 Railway 上新建项目，选择 Deploy from GitHub，连接仓库 `CkkkNa/wechat-bot` 并部署主分支（见 deploy-guide.md）。
2. Railway 部署成功后复制 Service URL 并更新 `.env` 的 CALLBACK_URL，重启服务或使用环境变量在服务器上配置。
3. 在企业微信后台的应用设置中填写回调 URL、Token 与 EncodingAESKey（可按 deploy-guide.md 的生成方法创建），并在本服务的 `.env` 中填入 CORPID/AGENTID/SECRET/TOKEN/ENCODING_AES_KEY。
4. 若希望我继续自动化部署，请提供 Railway/GitHub OAuth 授权（我会尝试基于您授权继续推进）。

