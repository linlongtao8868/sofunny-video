---
name: sofunny-video
description: 通过 Seedance Studio 服务提交 Seedance 视频生成任务并返回服务器可访问的下载链接。适用于需要避免直接调用上游 NewAPI、需要轮询长任务、需要从历史记录中恢复超时任务、或需要同时返回服务器本地链接与 FTP 链接的场景。配置优先级为命令行参数 > 进程环境变量 > ~/.sofunny-video.env。
---

# sofunny-video 视频生成技能

当视频生成必须统一经过 Seedance Studio 服务时，使用这个技能。

## 使用流程

1. 先确认服务地址。除非用户或环境明确指定，否则默认使用 `http://10.20.3.69:3001`。
2. 在构造请求、判断任务状态、排查超时之前，先阅读 [references/api.md](references/api.md)。
3. 默认使用跨平台脚本 `scripts/sofunny-video.js` 完成提交与轮询。
4. 在 Windows PowerShell 下需要壳层包装时，使用 `scripts/sofunny-video.ps1`。
5. 在 macOS 或 Linux 下需要壳层包装时，使用 `scripts/sofunny-video.sh`。
6. 如果上游报模型不可用，先检查 NewAPI 主机是否真的挂载了可用的 Seedance 视频渠道。
7. 返回结果时优先给服务器本地下载链接。先取 `/api/task/:taskId` 的 `local_result_url`，没有再回退到 `/api/history/:taskId`。
8. 如果启用了 FTP 镜像，同时返回 FTP 链接，保证服务器本地副本与 FTP 副本一起交付。
9. 除非调用方明确关闭，脚本默认还会把视频下载一份到调用方当前项目的 `sofunny-video-downloads/` 目录。
10. 参数解析顺序固定为：命令行参数优先，其次进程环境变量，再次 `~/.sofunny-video.env`，最后只对缺失字段发起交互补问。

## 配置来源

脚本按以下顺序读取配置：

1. 命令行参数
2. 当前 shell 的进程环境变量
3. `~/.sofunny-video.env`

如果没有检测到 `~/.sofunny-video.env`，脚本会在缺少 API Key 时提示你创建该文件并写入所需变量模板。

优先使用这些变量：

- `SOFUNNY_API_KEY`
- `SOFUNNY_PROMPT`
- `SOFUNNY_SERVICE_URL`
- `SOFUNNY_API_URL`
- `SOFUNNY_MODEL`
- `SOFUNNY_DURATION`
- `SOFUNNY_ASPECT_RATIO`
- `SOFUNNY_RESOLUTION`
- `SOFUNNY_IMAGE_URL`
- `SOFUNNY_VIDEO_URL`
- `SOFUNNY_DOWNLOAD_DIR`
- `SOFUNNY_TIMEOUT_SECONDS`
- `SOFUNNY_POLL_INTERVAL_MS`
- `SOFUNNY_SKIP_PROJECT_DOWNLOAD`

默认期望值：

- `SOFUNNY_SERVICE_URL=http://10.20.3.69:3001`

## 必填项

- `apiKey`（`SOFUNNY_API_KEY`）
- `prompt`（`SOFUNNY_PROMPT`）

## 可选项

- `serviceUrl`
- `apiUrl`
- `model`
- `duration`
- `aspectRatio`
- `resolution`
- `imageUrl`
- `videoUrl`
- `downloadDir`
- `skipProjectDownload`
- `timeoutSeconds`
- `pollIntervalMs`

当脚本运行在可交互终端中时，只会询问仍然缺失的字段。

补问顺序：

1. `apiKey`
2. `prompt`
3. `apiUrl`
4. `model`
5. `duration`
6. `aspectRatio`
7. `resolution`

## 恢复规则

1. 出错或超时后，不要自动切换模型重试。
2. 如果上游已经扣费但客户端超时，先检查 `/api/task-debug/:taskId` 和 `/api/history/:taskId`，再判断任务是否失败。
3. 如果轮询已经成功但还没有 `local_result_url`，先短暂等待，再查询 `/api/history/:taskId`，因为服务端是异步落盘。
4. 如果同时拿到了服务器链接和上游链接，两个都可以返回，但服务器链接必须作为主交付地址。
5. 如果启用了 FTP 镜像，把 FTP 链接作为次级交付方式一起返回。
6. 如果上游返回 `model_not_found`、`No available channel` 或同类错误，优先按 NewAPI 渠道或模型配置问题排查。

## 说明

1. 除非用户明确要求直连上游，否则始终把这个技能指向 Seedance Studio 服务，而不是直接调用提供方接口。
2. 后续轮询优先使用 `task_id`，不要依赖泛化的 `id`。
3. 端点字段、响应结构和排障细节统一以 [references/api.md](references/api.md) 为准。
4. 默认行为会在调用方当前项目下的 `sofunny-video-downloads/` 里额外保留一份本地文件。
5. 对 opencode 或其他代理客户端来说，上游 API Key 和主机本身必须已经具备可用的 Seedance 视频渠道，这个技能不会绕过上游权限限制。
6. 如果服务调用失败，不要自动回退成第二次直接 `POST /v1/video/generations` 测试，否则会造成重复计费。应优先使用 `/api/task-debug/:taskId`、`/api/history/:taskId` 或一次人工验证来排障。
