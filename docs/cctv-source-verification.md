# 央视公开点播接入与验证

验证时间：2026-10-09。环境：本机 Node 24.4.1、Next.js 生产构建、独立临时 DATA_DIR、127.0.0.1:18082。没有部署到服务器，也没有改动现有站点配置。

## 接入范围

- 内置一个「央视公开点播」Node 适配源，使用固定地址 `https://search.cctv.com/ifsearch.php` 识别。
- 搜索读取官方公开 API，详情 ID 只能还原成 `https://tv.cctv.com/YYYY/MM/DD/VIDE*.shtml` 视频页。
- 从视频页提取 guid，调用 `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=...`，使用公开 `hls_url`。权限受限、缺少 guid 或 HLS 时明确失败。
- 沿用现有配置、源启停、后台测活、分享链接和播放器；不增加依赖，不执行订阅提供的远程代码。
- 原 TVBOX 央视 JAR/Python 条目的 ext 与搜索开关语义仍由原配置保留，没有将它们标为已运行。
- 统一目录当前为 64 个 CMS 点播源 + 1 个央视适配源、23 个直播源。CMS 计数来自之前的订阅解析，并非本次逐一播放验证。
- 四天刷新保留内置源，旧持久化目录在读取时加入；保留管理员停用选择，已保存为空的站点配置仍保持为空。
- 搜索最多处理 100 个源，与配置允许的点播源数量一致；回归测试覆盖排在第 51 位的央视源。

## 真实验证结果

1. `/api/status` 返回 65 个点播源、23 个直播源，其中包含央视源。
2. 仅选择央视源搜索「新闻联播」，`/api/search` 返回 100 条结果，failures 为空。
3. `/api/detail` 返回节目标题、封面及公开 HLS 地址。样例节目为《新闻联播》20261008 21:00。
4. 管理员 `/api/source/test` 返回 `ok: true`，搜索命中 20 条。
5. Playwright 浏览器通过首页输入、搜索、点击结果进入播放页；页面显示「央视公开点播」线路与实际节目画面。
6. 视频第一次读取：currentTime 15.399584、readyState 4、paused false、已解码 388 帧。
7. 后续读取：currentTime 35.946965、readyState 4、paused false、已解码 902 帧，没有 video.error；视频尺寸 480×270，时长 1799.16 秒。

最终校验：39 个测试文件、383 项测试通过；类型检查、相关 ESLint、生产构建及 Git 空白差异检查通过。

播放截图：`output/playwright/cctv-spider-playback.png`。测试浏览器及隔离生产实例在验证结束后关闭。

## 暂未启用的 T4 候选

目录中的「金鹰」配置包含以下 T4 接口。本次搜索及首页请求全部出现 `getaddrinfo ENOTFOUND catbox.n13.club`，因此没有加入启用列表：

- `https://catbox.n13.club/t4/heihu.php`
- `https://catbox.n13.club/t4/cntv.php`
- `https://catbox.n13.club/t4/bili.php?id=bMTV`
- `https://catbox.n13.club/t4/tangdou.php`
- `https://catbox.n13.club/t4/qingting.php`

本次没有接入通用 Android/JAR、远程 JavaScript 或 Python 运行引擎。
