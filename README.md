# PeerDrop

浏览器里点对点传文件、聊天。发起方拿到 4 位连接码，接收方输入即连。数据优先走 WebRTC DataChannel 直连；打不了洞时自动使用 Cloudflare TURN 加密中继。

在线使用：<https://drop.zhoupb.com>

## 特性

- **单文件前端**：全部界面和传输逻辑在 [data/index.html](data/index.html)，无框架，发布时原样复制
- **短期信令**：Durable Object 只保存压缩后的 WebRTC 握手信息，10 分钟过期
- **防抢连**：连接码由 Worker 分配，offer 和 answer 各只能写一次，读写接口按 IP 限流
- **直连优先**：Cloudflare、国内和 Google STUN 多路探测
- **TURN 兜底**：Cloudflare Realtime TURN 临时凭据，只发给有效房间，有效期 12 小时，支持 UDP、TCP 和 TLS
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
| `cloudflare.config.ts` | Worker、域名、限流、Secret 和 Durable Object 配置 |
| `vite.config.ts` | 打包设置：静态资源目录、本地端口 |
| `scripts/smoke.sh` | 本地 API 与过期行为检查 |

## 本地验证与部署

用 Cloudflare CLI `cf`（beta）开发和部署，依赖用 npm 安装：

```bash
npm install
./scripts/smoke.sh
cf dev
cf deploy --dry-run
cf deploy
```

TURN key 只需创建一次。写入 Worker Secret 的方法、完整发布与验收步骤见 [AGENTS.md](AGENTS.md)。

## 连接路径

1. **局域网直连**
2. **公网直连**：双方有 IPv6 或公网 IP
3. **NAT 打洞**：通过 STUN 建立 UDP 直连
4. **TURN 中继**：直连失败时通过 Cloudflare 转发，内容仍由 DTLS 端到端加密

## License

[MIT](LICENSE)
