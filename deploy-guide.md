
## Token 与 EncodingAESKey 生成示例
- Token（建议 8-16 字符，ASCII）：
  - 生成命令：`openssl rand -hex 8`
- EncodingAESKey（必须为 43 字节）：
  - 生成命令：`openssl rand -base64 32 | tr -d '\n' | cut -c1-43`

将 Token 与 EncodingAESKey 填写到企业微信后台，且在本项目 `.env` 中记录：
```
TOKEN=your_token_here
ENCODING_AES_KEY=your_43_char_key_here
CALLBACK_URL=https://your-deployed-domain/wechat/callback
```
