# 项目约定

遵循简洁、实用、可验证的原则。修改后先本地验证，再部署。不要增加框架、构建系统或项目级 Wrangler 依赖。

## 部署目标

- 站点：`https://drop.clse-ai.com`
- Worker：`peer-drop`
- Cloudflare 账户：`2e481bb6133d64d883c5515efe3edaa5`
- 静态页面：`data/index.html`
- API：同域 `/api`
- 房间状态：SQLite-backed Durable Object `Room`，10 分钟过期
- TURN：Cloudflare Realtime TURN，凭据有效期 12 小时
- Secret：`TURN_KEY_ID`、`TURN_KEY_API_TOKEN`，只用 `wrangler secret put` 写入

## 工具规则

使用已经登录的全局 Wrangler 4.x：

```bash
wrangler --version
wrangler whoami
```

不要添加 `package.json`、锁文件或本地 Wrangler。`wrangler.jsonc` 是部署配置的唯一事实来源。Secret 不写入配置、源码、命令参数或日志。

## 本地验证

每次修改后运行：

```bash
./scripts/smoke.sh
wrangler deploy --dry-run
git diff --check
```

`scripts/smoke.sh` 会启动本地 Worker，验证健康检查、offer/answer 写读、404、405、413 和房间过期，然后停止它启动的进程。

## TURN key

在 Cloudflare Realtime TURN 创建名为 `peer-drop-production` 的 key。创建响应里的 `uid` 是 `TURN_KEY_ID`，只显示一次的 `key` 是 `TURN_KEY_API_TOKEN`。

交互式写入，禁止把值放进命令行：

```bash
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_API_TOKEN
wrangler secret list
```

## 部署

只有本地检查全部通过后才能部署：

```bash
wrangler deploy
```

记录 Wrangler 输出的 Version ID。部署失败或验收失败时使用：

```bash
wrangler rollback
```

不要执行 `wrangler delete`，不要删除 Durable Object namespace。

## 公网验收

基础接口：

```bash
curl -fsSI https://drop.clse-ai.com
curl -fsS https://drop.clse-ai.com/api/healthz
curl -fsS -X POST --data 'deploy-test' \
  https://drop.clse-ai.com/api/room/TEST/offer
curl -fsS https://drop.clse-ai.com/api/room/TEST/offer
curl -fsS https://drop.clse-ai.com/api/turn
```

必须确认：

- TLS 验证通过，不能使用 `curl -k`
- `/api/turn` 返回 `urls`、`username`、`credential`，且包含 UDP、TCP、TLS TURN 地址
- 两个浏览器可以直连聊天并传文件
- 受限网络下显示 Cloudflare TURN 中继，并成功传输至少 10 MiB 文件
- Worker 日志没有意外 5xx，也没有 Secret 内容

## 旧服务

旧阿里云容器已退出服务。服务器 `/root/peer-drop` 和旧镜像仅用于紧急恢复，不再部署或启动。`peer-drop.zhoupb.com` 不提供跳转。
