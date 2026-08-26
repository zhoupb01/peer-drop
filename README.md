# PeerDrop

浏览器里点对点传文件、聊天。发起方生成 4 位连接码，接收方输入即连。数据优先走 WebRTC DataChannel 直连；打不了洞时自动使用 Cloudflare TURN 加密中继。

在线使用：<https://drop.clse-ai.com>

## 特性

- **单文件前端**：全部界面和传输逻辑在 [data/index.html](data/index.html)，无构建、无框架
- **短期信令**：Durable Object 只保存压缩后的 WebRTC 握手信息，10 分钟过期
- **直连优先**：Cloudflare、国内和 Google STUN 多路探测
- **TURN 兜底**：Cloudflare Realtime TURN 临时凭据，有效期 12 小时，支持 UDP、TCP 和 TLS
- **大文件传输**：16 KiB 分块和 `bufferedAmount` 背压控制

## 架构

```text
浏览器 A ── HTTPS ──┐
                    ├── Cloudflare Worker ── Durable Object（临时信令）
浏览器 B ── HTTPS ──┘          │
                               └── Cloudflare Realtime TURN（按需签发凭据）

浏览器 A <══ WebRTC DataChannel（直连或 TURN 中继）══> 浏览器 B
```

| 文件 | 作用 |
|---|---|
| `data/index.html` | 前端和 WebRTC 传输逻辑 |
| `src/worker.js` | API、TURN 凭据和 Durable Object 房间状态 |
| `wrangler.jsonc` | Worker、静态资源、域名、限流和 Durable Object 配置 |
| `scripts/smoke.sh` | 本地 API 与过期行为检查 |

## 本地验证与部署

项目直接使用全局 Wrangler，不安装项目依赖：

```bash
./scripts/smoke.sh
wrangler deploy --dry-run
git diff --check
wrangler deploy
```

TURN key 只需创建一次。将 Cloudflare 返回的 key ID 和 API token 分别写入 Worker Secret：

```bash
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_API_TOKEN
wrangler deploy
```

完整发布与验收步骤见 [AGENTS.md](AGENTS.md)。

## 连接路径

1. **局域网直连**
2. **公网直连**：双方有 IPv6 或公网 IP
3. **NAT 打洞**：通过 STUN 建立 UDP 直连
4. **TURN 中继**：直连失败时通过 Cloudflare 转发，内容仍由 DTLS 端到端加密

## License

[MIT](LICENSE)
