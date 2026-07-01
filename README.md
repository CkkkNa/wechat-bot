# wechat-bot
企业微信回调服务（演示）

## 快速开始
1. 复制 `.env.example` 为 `.env` 并填写 CORPID、AGENTID、SECRET
2. 安装依赖：
   npm install
3. 启动服务：
   node index.js

服务会监听本地 3001 端口，并尝试使用 localtunnel 自动创建公网地址（在控制台打印 Tunnel URL）。

## 回调说明
- 回调路径：POST /wechat/callback
- 支持 JSON 或 XML（企业微信默认为 XML）；明文模式下直接解析 Content 字段
- 收到文本消息后会调用本机 `copilot -p "消息内容"` 命令，获取输出并通过企业微信发送接口回复给发送者

## 部署建议
- 若 localtunnel 无法使用，请将该服务部署到 Railway/Render/Vercel 等云平台，并将得到的 HTTPS 地址配置到企业微信回调 URL。

