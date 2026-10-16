# 项目约定

遵循简洁、实用、可验证的原则。修改后先本地验证，再部署。不要增加前端框架。Vite 只负责打包 Worker，并把静态页原样复制出去。

## 部署目标

- 站点：`https://drop.zhoupb.com`
- Worker：`peer-drop`
- Cloudflare 账户：`2e481bb6133d64d883c5515efe3edaa5`
- 静态页面：`data/index.html`，由 Vite `publicDir` 原样复制，不经过处理
- API：同域 `/api`
- 房间状态：SQLite-backed Durable Object `Room`，10 分钟过期
- TURN：Cloudflare Realtime TURN，只发给有效房间，凭据有效期 12 小时
- Secret：`TURN_KEY_ID`、`TURN_KEY_API_TOKEN`

## 工具规则

所有 Cloudflare 操作都用已经登录的全局 `cf`（Cloudflare CLI，beta），不用 `wrangler`：

```bash
cf --version
cf auth whoami
```

`cloudflare.config.ts` 是部署配置的唯一事实来源，构建设置在 `vite.config.ts`。依赖用 npm 管理，装最新版本。Secret 不写入配置、源码、命令参数或日志。

`cf` 还在 beta，命令会变。找命令用 `cf cli search "<要做的事>"`，再看 `<命令> --help`。搜索词只描述动作和资源类型，不带域名、ID 等具体值。

## 本地验证

每次修改后运行：

```bash
npm install
./scripts/smoke.sh
cf build
cf deploy --dry-run
git diff --check
```

`scripts/smoke.sh` 用 `cf dev --mode smoke` 启动本地 Worker（端口 18787，房间 TTL 5 秒），验证健康检查、建房、offer/answer 写读、404、405、409、413、429、TURN 的房间校验和房间过期，然后停止它启动的进程。平时开发用 `cf dev`，端口 8787。

## TURN key

在 Cloudflare Realtime TURN 创建名为 `peer-drop-production` 的 key。创建响应里的 `uid` 是 `TURN_KEY_ID`，只显示一次的 `key` 是 `TURN_KEY_API_TOKEN`。

`cf` 还不能交互式写入单个 secret，所以随新版本一起上传。值写进仓库外、只有自己可读的 `.env` 格式文件，部署完立刻删除：

```bash
umask 077
"$EDITOR" /tmp/peer-drop-secrets.env
cf deploy --secrets-file /tmp/peer-drop-secrets.env
rm /tmp/peer-drop-secrets.env
cf workers secrets list --worker peer-drop
```

文件内容是两行：`TURN_KEY_ID=…` 和 `TURN_KEY_API_TOKEN=…`。

## 部署

只有本地检查全部通过后才能部署：

```bash
cf deploy
```

记录输出的 Version ID。部署失败或验收失败时，把流量切回上一个版本：

```bash
cf workers versions list --worker-id peer-drop
cf workers deployments create --worker peer-drop --strategy percentage \
  --versions '[{"version_id":"<上一个 Version ID>","percentage":100}]'
```

不要删除 Worker，不要删除 Durable Object namespace。`cloudflare.config.ts` 的 `exports` 里的 `Room` 对应线上已有的 namespace，不要删除或改名。

## 公网验收

基础接口。房间由 Worker 分配连接码，每个 slot 只能写一次，所以每次验收都新建房间：

```bash
curl -fsSI https://drop.zhoupb.com
curl -fsS https://drop.zhoupb.com/api/healthz
code="$(curl -fsS -X POST https://drop.zhoupb.com/api/room)"
curl -fsS -X POST --data 'deploy-test' \
  "https://drop.zhoupb.com/api/room/$code/offer"
curl -fsS "https://drop.zhoupb.com/api/room/$code/offer"
curl -fsS "https://drop.zhoupb.com/api/room/$code/turn"
```

必须确认：

- TLS 验证通过，不能使用 `curl -k`
- `/api/room/$code/turn` 返回 `urls`、`username`、`credential`，且包含 UDP、TCP、TLS TURN 地址
- 两个浏览器可以直连聊天并传文件
- 受限网络下显示 Cloudflare TURN 中继，并成功传输至少 10 MiB 文件
- Worker 日志没有意外 5xx，也没有 Secret 内容

## 旧服务

`drop.clse-ai.com` 已停用，不提供跳转。

旧阿里云容器已退出服务。服务器 `/root/peer-drop` 和旧镜像仅用于紧急恢复，不再部署或启动。`peer-drop.zhoupb.com` 不提供跳转。
