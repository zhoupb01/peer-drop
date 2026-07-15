# PeerDrop

浏览器里点对点传文件、聊天。发起方生成 4 位连接码，接收方输入即连——数据走 WebRTC DataChannel 直连，不经过服务器；打不了洞的网络（TUN 代理、对称 NAT）自动降级到自建 TURN 加密中继，保证一定能连上。

在线使用：<https://peer-drop.zhoupb.com>

## 特性

- **单文件前端**：全部逻辑在 [data/index.html](data/index.html)，无构建、无依赖、无框架
- **4 位连接码**：SDP 压缩到 ~150–250 字符（只传 ice-ufrag/pwd、DTLS 指纹、候选地址，其余按模板重建），信令只存这点握手信息，10 分钟过期
- **直连优先**：自建 + 国内 + 国外 STUN 多路探测（挂代理时国内 STUN 命中 DIRECT 规则才能拿到真实出口）；IPv6 双栈就绪，双方都有 IPv6 时免 NAT 直连
- **TURN 兜底**：coturn + REST 时效凭据（信令服务用共享密钥签 HMAC，有效期 12h），打洞失败 ICE 自动走中继，流量仍是 DTLS 端到端加密
- **大文件传输**：16KB 分块 + `bufferedAmount` 背压控制

## 架构

```
浏览器 A ── HTTPS ──┐
                    ├── Nginx ──> signal（Node：房间存取 + TURN 凭据签发）
浏览器 B ── HTTPS ──┘
        │
        A <══ WebRTC DataChannel（直连，或经 coturn 中继）══> B
```

| 文件 | 作用 |
|---|---|
| `data/index.html` | 前端，全部业务逻辑 |
| `signal/server.mjs` | 信令：`/room/<码>/<offer\|answer>` 存取握手，`/turn` 签发时效凭据 |
| `turnserver.conf` | coturn 配置（含防跳板的 denied-peer-ip 清单） |
| `docker-compose.yml` | nginx + signal + coturn 编排 |

## 部署

前提：有公网 IP 的服务器；域名**直连解析**到服务器（TURN 流量不能走 CDN 代理）；外层 HTTPS 反代（本仓库用 Traefik label，可换成任何反代）。

```bash
# 1. 生成 TURN 共享密钥
echo "TURN_SECRET=$(openssl rand -hex 24)" > .env

# 2. 按你的环境改 docker-compose.yml：
#    - coturn 的 --external-ip=公网IP/内网IP（云厂商 NAT 场景必须；网卡直接持有公网 IP 则删掉此行）
#    - --relay-ip=内网IP；服务器有公网 IPv6 时再加一行 --relay-ip=<IPv6>
#    - TURN_URLS 与 Traefik label 里的域名

# 3. 云安全组/防火墙放行：TCP+UDP 3479（TURN），UDP 49160-49200（中继端口段）

docker compose up -d
```

> 端口用 3479 而非标准 3478，是因为部署机上 headscale 占了 3478。没有冲突可改回 3478（`turnserver.conf`、compose 的 `TURN_URLS`、`index.html` 的 `stun:` 三处同步改）。

构建、本地验证与部署验收的完整命令见 [AGENTS.md](AGENTS.md)。

## 连接路径

连上后会话里会显示本机实际出口，从优到劣依次可能是：

1. **局域网直连** —— 同一内网
2. **公网直连（免打洞）** —— 双方有 IPv6 或公网 IP
3. **NAT 打洞** —— 经 STUN 探测后的 UDP 直连
4. **TURN 中继** —— 打洞失败的兜底，流量经服务器转发（仍端到端加密）

## 为什么开了 TUN 模式的代理就打不了洞？

TUN 在 IP 层接管全部流量：STUN 按域名分流可能直连、发往对端的裸 IP 包却按 GEOIP 进了代理，两条路一分裂，探测出的公网映射就作废了；UDP 经代理又常被丢弃或呈对称 NAT 行为。所以这种场景无解，只能靠 TURN 中继兜底——浏览器到 TURN 的 TCP 连接能正常穿过代理。

## License

[MIT](LICENSE)
