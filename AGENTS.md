# 项目约定

遵循简洁、实用、可验证的原则。修改后先在本地验证，再部署；不要把构建工作转移到生产服务器。

## 部署目标

- 站点：`https://peer-drop.zhoupb.com`
- SSH：`root@aliyun-dns.zhoupb.com`
- 服务器目录：`/root/peer-drop`
- 服务器架构：`linux/amd64`
- 静态页面：`data/index.html`
- 信令接口：同域 `/api`，由 Nginx 反代到 `peer-drop-signal` 容器
- TURN 中继：coturn（`peer-drop-turn` 容器，host 网络），`turn:peer-drop.zhoupb.com:3479`，配置在 `turnserver.conf`
  （3478 被同机 headscale 的 STUN 占用，不能用）
- 密钥：`TURN_SECRET` 存放在项目目录 `.env`（本地与服务器各自维护，不入 git），信令与 coturn 共用，用于签发/校验 TURN 时效凭据
- 阿里云安全组需放行：TCP 3479、UDP 3479、UDP 49160-49200（中继端口段）

## Docker 镜像发布规则

信令镜像必须在本机 Docker 中构建、测试并导出，然后上传服务器执行 `docker load`。禁止在服务器上执行 `docker build`、`docker compose build` 或 `docker compose up --build`。

`docker-compose.yml` 中必须保留：

```yaml
signal:
  platform: linux/amd64
  build:
    context: ./signal
  image: peer-drop-signal:latest
```

本机 Docker 未启动时，先启动 OrbStack：

```bash
open -a OrbStack
docker info
```

构建并确认镜像架构：

```bash
docker compose config --quiet
docker compose build signal
docker image inspect peer-drop-signal:latest \
  --format '{{.Os}}/{{.Architecture}} {{.Id}}'
```

架构输出必须是 `linux/amd64`。随后运行镜像，验证健康检查和信令读写：

```bash
docker run --rm -d \
  --name peer-drop-signal-test \
  -p 127.0.0.1:13000:3000 \
  -e TURN_SECRET=localtestsecret \
  -e 'TURN_URLS=turn:peer-drop.zhoupb.com:3479?transport=udp' \
  peer-drop-signal:latest

curl -fsS http://127.0.0.1:13000/healthz
curl -fsS -X POST --data 'test-offer' \
  http://127.0.0.1:13000/room/TEST/offer
curl -fsS http://127.0.0.1:13000/room/TEST/offer
curl -fsS http://127.0.0.1:13000/turn   # 应返回 urls/username/credential JSON

docker stop peer-drop-signal-test
```

改动 `turnserver.conf` 后，本地验证 coturn 配置可用（allocation 成功即通过；
`-y` 回环的 channel bind 会被 denied-peer-ip 拦成 403，属预期）：

```bash
docker run --rm -d --name peer-drop-turn-test \
  -v "$PWD/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn:alpine --log-file=stdout --static-auth-secret=localtestsecret

docker exec peer-drop-turn-test turnutils_uclient \
  -y -W localtestsecret -p 3479 127.0.0.1

docker stop peer-drop-turn-test
```

coturn 用公共镜像 `coturn/coturn:alpine`，服务器直接 `docker pull`；若服务器拉取失败，
本机 `docker pull --platform linux/amd64 coturn/coturn:alpine` 后照信令镜像的方式 save/load。

测试通过后导出并上传镜像：

```bash
docker save -o /tmp/peer-drop-signal.tar peer-drop-signal:latest
gzip -f /tmp/peer-drop-signal.tar

ssh root@aliyun-dns.zhoupb.com 'mkdir -p /root/peer-drop/data'
scp /tmp/peer-drop-signal.tar.gz \
  root@aliyun-dns.zhoupb.com:/root/peer-drop/
scp docker-compose.yml nginx.conf turnserver.conf \
  root@aliyun-dns.zhoupb.com:/root/peer-drop/
scp data/index.html \
  root@aliyun-dns.zhoupb.com:/root/peer-drop/data/index.html
```

服务器 `.env` 只需创建一次（换密钥会使已发出的 TURN 凭据失效）：

```bash
ssh root@aliyun-dns.zhoupb.com \
  'test -f /root/peer-drop/.env || \
   echo "TURN_SECRET=$(openssl rand -hex 24)" > /root/peer-drop/.env'
```

服务器只加载镜像并启动：

```bash
ssh root@aliyun-dns.zhoupb.com '
  cd /root/peer-drop &&
  docker load -i peer-drop-signal.tar.gz &&
  docker compose config --quiet &&
  docker compose up -d --remove-orphans &&
  docker compose ps &&
  rm -f peer-drop-signal.tar.gz
'
```

部署后必须验证：

```bash
curl -kfsS https://peer-drop.zhoupb.com/api/healthz
curl -kfsS -X POST --data 'deploy-test' \
  https://peer-drop.zhoupb.com/api/room/TEST/offer
curl -kfsS https://peer-drop.zhoupb.com/api/room/TEST/offer
curl -kfsS https://peer-drop.zhoupb.com/api/turn
curl -kfsSI https://peer-drop.zhoupb.com
```

TURN 公网连通性（从本机验证，`<secret>` 取服务器 `.env` 里的值；
UDP/TCP 各测一遍，allocation 成功即通过）：

```bash
docker run --rm coturn/coturn:alpine turnutils_uclient \
  -W '<secret>' -p 3479 -e 8.148.66.181 peer-drop.zhoupb.com        # UDP
docker run --rm coturn/coturn:alpine turnutils_uclient \
  -t -W '<secret>' -p 3479 -e 8.148.66.181 peer-drop.zhoupb.com     # TCP
```

当前机器的 `curl` CA 存储无法验证站点证书链，因此公网连通性检查使用 `-k`；这只能验证路由和内容，不能作为 TLS 证书链验证结果。

## 仅更新静态页面

如果只修改了 `data/index.html`，不需要重新构建信令镜像。直接上传页面并验证即可：

```bash
scp data/index.html \
  root@aliyun-dns.zhoupb.com:/root/peer-drop/data/index.html
curl -kfsSI https://peer-drop.zhoupb.com
```
