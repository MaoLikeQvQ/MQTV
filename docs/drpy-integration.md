# 项目内 Node drpyS 引擎

主站保留 Next.js Node 后端，新增同项目的 drpyS Node 解析进程。公开 T4 接口也通过相同桥接处理。源的 `type` 为 `drpy` 或 `t4`，CMS 源不需要这个字段；点播和直播仍分别保存。

## 安装与运行

推荐 Node 22。当前固定的上游引擎声明 Node `>17 <24`。主站可以继续使用 Node 24，通过 `DRPY_NODE_BIN` 单独指定引擎的 Node 22。

```sh
npm run drpy:install
npm run dev:drpy
```

生产构建后的启动：

```sh
npm run build
npm run start:drpy
```

本机已有 Node 22 时，可在启动前设置：

```sh
export DRPY_NODE_BIN=/Users/maolike/.nvm/versions/node/v22.17.1/bin/node
npm run start:drpy
```

联合启动命令先启动引擎、检查健康状态，再启动主站，并统一处理退出。默认引擎监听 `127.0.0.1:5757`，主站监听 `8080`；主站端口可通过 `PORT` 设置。没有指定 `DRPY_API_KEY` 时，联合启动会生成仅供这次运行使用的随机密钥，传给两个进程，不写入源配置或浏览器。

安装器需要 `curl`，下载固定提交的预构建 core 与 SQLite WASM，有界分段下载并验证完整文件 SHA-256，放入忽略的 `.runtime/drpy`。已有正确文件时不会重新下载。核心约 14 MB，首次下载时间取决于 GitHub 连通性；失败会明确退出，可以重新执行安装命令。没有向主站增加 npm 运行依赖。

也可以独立运行引擎：`npm run drpy:start`。这时主站和引擎必须配置相同的 `DRPY_API_KEY`，主站还需 `DRPY_ENABLED=1`、`DRPY_BASE_URL=http://127.0.0.1:5757`。联合启动命令会自动设置这些值。

## Docker 同项目部署

当前源码一键部署：

```sh
bash scripts/deploy-docker.sh
```

首次创建 `.env` 时，脚本自动设置 `DRPY_ENABLED=1`、`COMPOSE_PROFILES=drpy` 和独立随机 `DRPY_API_KEY`，同时构建主站与引擎。已有 `.env` 需自行确认这三项配置。服务器默认 `18080` 映射主站的 `8080`；也可传入其他端口，例如 `bash scripts/deploy-docker.sh 19080`。

`Dockerfile.drpy` 固定 Node 22 并安装引擎。主站连接 Compose 内部的 `http://drpy:5757`，引擎端口不发布到宿主机。手动从源码构建可使用 `docker compose -f docker-compose.yml -f docker-compose.build.yml --profile drpy up -d --build --wait`；关闭引擎时不启用该 profile，并设置 `DRPY_ENABLED=0`。生产镜像与自动部署方式见 [部署说明](deployment.md)。

## 当前支持范围

- 首批注册 `cctv-public` 规则，通过真正的 drpyS「搜索」「二级」「lazy」执行链读取央视公开内容。
- 启用引擎后，统一资源目录增加「央视公开点播（drpy）」。原有内置央视源保留；管理员可按需要关闭其中一个。只有服务器配置了私有目录或快照时才加入适配源，新增源停用选择会被后续刷新保留；镜像本身没有默认数据源列表。
- 已保存的空配置或其他独立订阅仍保持原状；需要使用目录时在后台「资源目录」导入自动更新目录并保存。
- TVBOX `type=4` HTTP 接口可作为 `t4` 导入，保留 URL 查询参数。自动目录收集的未验证 T4 默认停用，管理员检测后再启用。
- 插件视频 ID 与剧集引用采用不透明标识。选集后 `/api/play` 根据服务端详情取得 token 和 flag，执行解析，校验公网媒体地址与响应后交给播放器。
- 不支持的网页嗅探、`parse=1`、专用媒体请求头会明确报错。当前使用 Spider 详情中的第一条有效内部播放线路，未展开所有内部 flag。
- Android JAR、任意远程 `.js` / `.py` 不会自动下载执行。安装 drpyS 不代表所有 TVBOX 插件都兼容。
- 上游预构建 core 的可选 `simplecc` 字转换助手当前未加载；首批规则不依赖它。新规则如依赖额外 helper、浏览器、代理或数据库能力，需要逐条验证。

## 增加本地规则

把已检查的 drpyS 规则放到 `services/drpy/rules/<module>.js`，模块名只允许英文字母、数字、下划线和连字符；在 `DRPY_MODULES` 逗号列表中注册，重启引擎。主站源配置示例：

```json
{
  "key": "drpy-custom",
  "name": "已验证的规则",
  "url": "https://drpy.libretv.invalid/api/custom-module",
  "type": "drpy",
  "enabled": true
}
```

这个 URL 是源身份，不是访问地址。真实引擎地址和密钥仅在服务端使用；未注册的模块、用户提供的内网地址或引擎重定向不能绕过允许列表。完整备份与源列表导入导出保留 `type`。

## 验证记录

2026-10-09，在本机 Node 22.17.1 实际加载固定版本 drpyS core；未授权 `/health` 返回 401，授权请求返回引擎与模块列表。

主站隔离生产实例中，默认目录下发了 66 个点播源、23 个直播源。「央视公开点播（drpy）」搜索「新闻联播」返回 100 条结果且无失败；详情返回不透明剧集引用，`/api/play` 经引擎 lazy 解析并确认 HLS 媒体内容，返回公开 HLS 地址。

浏览器通过首页搜索结果进入播放页，实际显示节目画面和「央视公开点播（drpy）」线路。两次读取的视频进度为 28.93979 秒、112.355677 秒，解码帧数从 727 增至 2812，readyState 为 4，没有 video.error；样例尺寸 480×270、时长 1801.88 秒。截图：`output/playwright/drpy-engine-playback.png`。

校验：41 个测试文件、398 项测试通过，类型检查和生产构建通过。

联合启动 `start:drpy` 使用本次生成的内部随机密钥，在隔离主站端口 18084 验证了健康检查、66/23 的目录下发与真实央视搜索（100 条、无失败）。发送 Ctrl-C 后主站与引擎一起退出，18084 和 5757 均无残留监听。

这是本地运行证据。Docker Compose 配置可解析，当前本机 Docker daemon 未运行，未完成镜像构建或容器运行验证；未部署到服务器。
