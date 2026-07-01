# 详细部署指南：将 wechat-bot 部署到 Railway（或类似云）

本指南在 Railway 控制台手动部署步骤：如果 Railway CLI 在当前环境无法登录，请按此手工流程完成部署。

一、准备条件
1. GitHub 仓库（已存在）：https://github.com/CkkkNa/wechat-bot
2. Railway 帐号（或 Render/Vercel）
3. 企业微信管理员权限（后续配置需要）
4. 本项目需要以下环境变量（在 Railway 项目 Settings -> Variables 中配置）：
   - CORPID = 您的企业微信CorpID
   - AGENTID = 应用 AgentID（整数）
   - SECRET = 应用 Secret
   - TOKEN = 随机字符串（用于消息签名校验）
   - ENCODING_AES_KEY = 43 字节的 EncodingAESKey（用于解密）
   - DEFAULT_TOUSER = （可选）默认接收者，userid 或 @all
   - ALLOWED_USERS = （可选）允许下发命令的企业微信用户列表，逗号分隔

二、在 Railway 控制台手动部署（网页操作）
1. 登录 https://railway.app。点击 "New Project" → 选择 "Deploy from GitHub"。
   - 截图占位：[railway-1-new-project.png]
2. 授权 Railway 访问 GitHub（选择关联的账号并允许仓库访问）。
   - 截图占位：[railway-2-authorize-github.png]
3. 选择仓库 `CkkkNa/wechat-bot`，点击 Deploy。通常 Railway 会自动识别 Node.js 应用。
   - 截图占位：[railway-3-select-repo.png]
4. 部署设置：确保 Start Command 为 `node index.js`（或留空以使用自动检测）。Port 无需设置（应用监听 process.env.PORT 或 3001）。
   - 截图占位：[railway-4-deploy-settings.png]
5. 添加环境变量（Variables / Settings）：把前文列出的变量全部添加到 Railway 的变量面板。
   - 截图占位：[railway-5-env-vars.png]
6. 点击 Deploy 并等待构建与启动。部署成功后，Railway 会显示 Service URL，例如：
   `https://your-service.up.railway.app`
   - 截图占位：[railway-6-service-url.png]

三、在企业微信里配置回调 URL 与加密
1. 登录企业微信管理后台 → 应用管理 → 选择目标自建应用 → 接口权限与回调URL（或“应用回调”）。
2. 填写回调 URL：`https://{RAILWAY_URL}/wechat/callback`（示例：https://your-service.up.railway.app/wechat/callback）
3. 填写 Token（与 .env 中的 TOKEN 相同）和 EncodingAESKey（与 .env 中 ENCODING_AES_KEY 相同）。
4. 选择“加密模式”（推荐），保存并验证回调。
   - 验证后企业微信会发送测试消息到回调地址，请检查服务日志 /tmp/wechat-bot.log 是否有收到回调并成功验证。

四、测试流程（上线后的检查）
1. 在企业微信应用里向该应用发送消息（文本）：例如 `hello` 或 `/task {"command":"echo hi"}`。
2. 服务应返回确认："已接收任务 <id>，稍后开始执行。"
3. 服务将在任务执行的开始/中间/结束阶段主动推送文本消息到触达者（或 DEFAULT_TOUSER）。
4. 通过 Railway 控制台的 Logs 查看服务执行情况，或通过 GET https://{RAILWAY_URL}/tasks 查看任务状态。

五、Token 与 EncodingAESKey 生成示例
- Token: `openssl rand -hex 8` （输出示例：`a1b2c3d4e5f6`，取部分或全部作为 Token）
- EncodingAESKey（43 字节）: `openssl rand -base64 32 | tr -d '\n' | cut -c1-43`

六、如果 Railway 自动部署受阻（常见原因与排查）
- Railway CLI/login 需要网络外部访问，若受限请在可联网环境完成授权。
- 若构建失败，请在 Railway 的 Build Logs 中查看错误并按需安装缺失依赖。
- 如果无法使用 Railway，可选择 Render/Vercel，部署步骤类似：将仓库连接并设置 Start Command 与环境变量。

七、回滚与安全建议
- 在生产前，请实现 stricter command whitelist，避免执行任意 shell 命令。
- 保存并轮转 Secret（Secret 不要直接写入代码或暴露到公共仓库）。

---
生成时间：$(date -u)
