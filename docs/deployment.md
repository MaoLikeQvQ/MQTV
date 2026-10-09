# MQTV 自动构建与部署

代码仓库：<https://github.com/MaoLikeQvQ/MQTV>。工作流位于 `.github/workflows/docker-publish.yml`，不再向上游 Docker Hub 仓库发布或同步镜像。

## 当前源码一键部署与端口

将当前源码放到服务器部署目录，在该目录运行：

```bash
bash scripts/deploy-docker.sh             # 服务器 18080 → 容器 8080
bash scripts/deploy-docker.sh 19080       # 指定其他服务器端口
```

需要 Docker Engine、支持 `up --wait --wait-timeout` 的 Compose v2 和 Bash，不需要宿主机 Node/Python。脚本使用 `docker-compose.yml` 与 `docker-compose.build.yml` 构建当前源码；不依赖 GHCR 已发布镜像，首次引擎构建仍需访问 GitHub。

首次自动生成 `.env`、三个不同的随机密钥，并开启 drpy；已存在的 `.env` 不会被模板覆盖，指定端口时只更新 `HOST_PORT`。默认 `HOST_BIND=0.0.0.0`、`HOST_PORT=18080`。可通过编辑 `.env` 改为其他端口或仅监听 `127.0.0.1`。后台登录直接访问 `/admin`，密钥从服务器 `.env` 的 `ADMIN_KEY` 获取。空密钥、Docker 不可用或健康等待失败均返回非零退出码。

该脚本不会读取或更新自动部署的 `.env.release`，不执行自动镜像回退。源码构建与下文固定镜像部署是两种部署方式；使用源码方式时后续继续运行本脚本，使用 Actions 时继续按下文管理 `.env.release`。

默认持久卷为 `mqtv-data`。迁移前确认 `MQTV_DATA_VOLUME` 指向原卷，首次部署的空卷需由管理员导入源配置。数据卷不随重建删除，解析端口不发布到服务器；所选服务器端口若被占用，Docker 报错且脚本报告失败，不终止占用它的其他服务。需要公网访问时在服务器防火墙及云安全组放行对应 TCP 端口，脚本不操作防火墙。

常用检查命令：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml ps
docker compose -f docker-compose.yml -f docker-compose.build.yml logs --tail=100
```

## 触发规则

| 操作 | 检查 | 发布镜像 | 更新服务器 |
| --- | --- | --- | --- |
| 向 `main` 发起 PR | 类型检查、单元测试、部署脚本测试 | 否 | 否 |
| 推送 `main` | 同上 | 主站和 drpy | 配置 `DEPLOY_ENABLED=true` 后执行 |
| 推送 `v*` 标签 | 同上 | 主站和 drpy，增加该标签 | 否 |
| Actions 手动运行 | 同上 | 主站和 drpy | 选择 `main` 且启用部署时执行 |

本地 `git commit` 不触发 Actions；需要把代码推送到这个仓库。镜像默认构建 `linux/amd64`，适用于常见 x86_64 Linux 服务器。当前工作流不发布 ARM64 镜像；ARM 服务器需要另加原生 ARM 构建与 manifest 合并，不能直接拉取本方案的镜像运行。

发布地址：

```text
ghcr.io/maolikeqvq/mqtv:sha-<完整提交SHA>
ghcr.io/maolikeqvq/mqtv-drpy:sha-<完整提交SHA>
```

`main` 构建还会更新两者的 `latest`。自动部署使用这次构建返回的 `@sha256:...` digest 固定两份镜像，不依赖可变化的 `latest` 或 SHA 标签。两个镜像均发布成功后，CI 拉取确切 digest，在无外网、无私有数据挂载的临时容器中检查主站与 drpy 健康，以及主站三类默认数据源列表为空；检查通过后才开始 SSH 部署。未通过的镜像仍可能已经上传到 GHCR，但不会更新服务器。

## 服务器首次准备

服务器需安装 Docker Engine、Docker Compose 插件（支持多个 `--env-file`、`config --environment`、`up --wait` 的当前 v2 版本）、Bash 和 `flock`（Linux `util-linux` 包）。SSH 用户需要有部署目录写权限和 Docker 使用权限。

首次只需上传仓库的生产编排文件 `docker-compose.prod.yml`（在服务器上重命名为 `docker-compose.yml`）和从 `.env.example` 填写的 `.env`。仓库另有本地开发编排文件；自动部署必须使用这个生产版本：

```text
/opt/mqtv/
├── docker-compose.yml
└── .env
```

无需上传源码、Dockerfile、Node 环境或私有数据源。部署脚本每次由 Actions 经 SSH 标准输入传到服务器执行，自动生成只含两份镜像地址的 `.env.release`。它不会覆盖服务器 `.env`。

服务器上收紧环境文件权限：

```bash
cd /opt/mqtv
chmod 600 .env
```

填写后台密钥、代理签名密钥、端口等实际配置。若使用 drpy，在 `.env` 配置：

```dotenv
DRPY_ENABLED=1
COMPOSE_PROFILES=drpy
DRPY_API_KEY=<独立随机密钥>
```

`COMPOSE_PROFILES=drpy` 让手动 Compose 命令也启动引擎。自动部署脚本还会通过 Compose 读取 `DRPY_ENABLED=1` 并主动启用该 profile；不会用 `source .env` 执行文件内容。drpy 端口只在容器网络内开放。

如果 GHCR 包为公开包，服务器无需登录。GHCR 新包可能默认为私有；在 GitHub 个人账号的 Packages 中将两份包设为公开，或在服务器一次性用具有 `read:packages` 权限的 GitHub classic PAT 登录：

```bash
docker login ghcr.io -u MaoLikeQvQ
```

在交互提示中输入 token，不把 token 写进命令、仓库或服务器 `.env`。登录必须由运行部署脚本的同一服务器用户执行（使用 root 与普通用户的 Docker 凭据目录不同）。Actions 发布使用内置 `GITHUB_TOKEN`，无需另外设置镜像发布 token。

## 配置 GitHub Actions

在 MQTV 仓库 `Settings → Secrets and variables → Actions` 添加：

| 类型 | 名称 | 内容 |
| --- | --- | --- |
| Variable | `DEPLOY_ENABLED` | 先保留为 `false` 或不设置；服务器准备后设为 `true` |
| Variable | `DEPLOY_PATH` | 服务器绝对目录，默认 `/opt/mqtv`；限字母、数字、斜杠、下划线和连字符 |
| Secret | `DEPLOY_HOST` | 服务器 IPv4 或域名，不含协议、用户名、路径 |
| Secret | `DEPLOY_USER` | SSH 用户名 |
| Secret | `DEPLOY_PORT` | SSH 端口，未配置时为 `22` |
| Secret | `DEPLOY_SSH_KEY` | 专用 SSH 私钥；对应公钥安装到该服务器用户的 `authorized_keys` |
| Secret | `DEPLOY_KNOWN_HOSTS` | 已核验的服务器 SSH 主机公钥行（known_hosts 格式） |

主机公钥需从服务器控制台或可信渠道核验。非 22 端口的 known_hosts 主机部分必须是 `[主机]:端口`。工作流严格校验主机身份，未配置或不匹配时直接失败，不使用 `StrictHostKeyChecking=no`，也不把未核验的在线扫描结果自动加入信任。

确保仓库 Actions 已启用，并允许工作流使用 `GITHUB_TOKEN` 写入包。如果同名 GHCR 包已存在且属于其他仓库，需要先将包关联到 MQTV，授予本仓库 Actions 写权限。

首次建议先只启用构建：推送 `main`，查看 `verify`、`publish` 成功及两份包可拉取，再设 `DEPLOY_ENABLED=true`，从 Actions 页面选择 `main` 手动运行。之后每次推送 `main` 就会自动检查、构建并更新服务器。

## 更新、健康检查与回退

部署脚本使用服务器目录的 `flock` 排他锁，工作流不会中断正在进行的部署。先拉取指定 digest，再执行：

```bash
docker compose --env-file .env --env-file <本次临时版本文件> up -d --no-build --wait --wait-timeout 120
```

Compose 在镜像变化时替换容器，等待主站与启用的 drpy 健康检查通过后，将两份镜像地址记录到 `.env.release`。更新可能有短暂中断。健康检查失败时，脚本使用上次 `.env.release` 恢复镜像并再次等待；Actions 仍报告本次部署失败。若首次部署失败，还没有上个版本，脚本会明确报告无法自动回退。

仅回退程序镜像，不回退数据或 `.env` 配置。未来涉及数据格式不兼容的版本，需额外设计兼容与备份。脚本不执行 `down -v`、数据卷删除或镜像清理。

部署后手动查看状态时，使用记录的镜像文件：

```bash
cd /opt/mqtv
docker compose --env-file .env --env-file .env.release ps
```

手动重建或更新也应传入 `.env.release`，避免默认 `latest` 覆盖固定版本。只执行 `docker compose restart` 不会拉取新镜像或升级程序。

已有运行中的服务器第一次切换到这套脚本前，应把当前主站和 drpy 的完整镜像 digest 写入 `.env.release`，这样第一次自动更新失败时也能恢复原版本。可用 `docker image inspect <当前镜像> --format '{{json .RepoDigests}}'` 查询已拉取镜像的 registry digest；未确认前不编造 digest。

## 私有数据与已有数据卷

实际数据源、订阅地址、解析快照、同步报告与环境文件不能提交到仓库或作为 CI 产物。程序运行时从服务器数据目录读取私有配置；全新数据卷为空，由管理员导入。CI 使用虚构测试数据，镜像中不包含本地 `data/`、源 JSON 或验证截图。检查阶段还用 `scripts/check-release-files.mjs` 拒绝已被 Git 跟踪的已知私有文件路径，防止有人强制加入被忽略的文件；它检查路径，不读取或输出文件内容。这个检查不能识别任意改名后藏在源码中的私有地址。

主站数据卷保存后台配置和访客数据，发布只替换程序容器。迁移已有部署时先查清原卷名和 Compose 项目名，沿用原数据卷；更改项目名或部署目录可能创建一个新空卷，看起来像配置丢失。先备份并确认挂载，再启用自动部署。不要执行 `docker compose down -v`。

新部署的默认数据卷名是 `mqtv-data`。已有部署需要在服务器 `.env` 中设置 `MQTV_DATA_VOLUME=<已确认的原卷名>`，例如原卷确实叫 `libretv_libretv-data` 时才填写这个值。可通过 `docker inspect <原主站容器> --format '{{json .Mounts}}'` 查看 `/app/data` 的原挂载；如果原先是宿主机目录绑定，需要将 Compose 挂载调整为该目录或在停机备份后迁移数据，不能用目录路径冒充卷名。

环境文件和数据目录单独在服务器管理，不通过 CI 上传。普通代码更新不需要重传 Compose 或 `.env`；修改部署结构时，由管理员同步 Compose 后再部署。

## 验证边界

`node --test scripts/deploy-docker-check.mjs` 验证源码一键部署的首次密钥生成、环境文件权限、重复部署、端口修改、禁用引擎、无效端口及失败保留行为，使用模拟 Docker，不运行真实容器。Compose 的生产镜像和源码构建两种配置均可解析，默认 `18080:8080` 及自定义 `19080:8080` 已检查。当前本机 Docker daemon 未运行，尚未验证真实镜像构建、容器启动或服务器端口连通性。

`node --test scripts/deploy-check.mjs` 用模拟 Docker/锁验证部署顺序、失败回退、首次失败、配置失败、profile 选择与环境文件保留。它不连接服务器，不推送镜像，也不能证明 GitHub 包权限、SSH 网络、真实 Docker 健康检查或现有数据卷迁移成功。发布 job 的容器检查只在实际 GitHub Actions 运行时执行；不能把本地脚本测试算作容器验证。首次实际 Actions 运行与服务器更新成功后，才算部署链路验证完成。
