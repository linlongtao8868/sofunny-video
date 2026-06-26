# Seedance Studio 接口参考

## 接口总览

### `POST /api/generate`

通过本地 Seedance Studio 服务提交一个视频生成任务。

请求体示例：

```json
{
  "apiKey": "sk-xxx",
  "prompt": "15秒电影感教室纯爱短片",
  "duration": 15,
  "aspectRatio": "16:9",
  "resolution": "1080p",
  "apiUrl": "https://your-newapi-host",
  "model": "ep-20260618182255-cxtc2",
  "imageUrl": "data:image/png;base64,...",
  "videoUrl": "data:video/mp4;base64,..."
}
```

重点响应字段：

- `task_id`：优先使用的任务编号
- `id`：仅在没有 `task_id` 时兜底使用
- `model`：最终实际使用的上游模型或 `ep-id`

### `GET /api/task/:taskId`

通过本地服务轮询任务状态。

查询参数：

- `apiKey`：必填
- `apiUrl`：可选，用于覆盖默认上游地址

成功时需要关注的字段：

- `data.status` 或 `status`
- `data.progress` 或 `progress`
- `data.result_url` 或同类上游结果地址
- `data.local_result_url`：优先交付的服务器本地下载链接
- `data.ftp_result_url`：如果启用了 FTP 镜像，对应 FTP 链接
- `data.ftp_result_path`：FTP 服务器上的实际路径

当前已识别的成功状态：

- `COMPLETED`
- `SUCCESS`
- `SUCCEEDED`
- `DONE`
- `completed`

需要继续轮询的状态：

- `PENDING`
- `IN_PROGRESS`

### `GET /api/task-debug/:taskId`

当普通轮询结果不明确时，用这个接口查看原始返回。

返回字段：

- `statusCode`
- `contentType`
- `body`

这个接口最适合排查：

- `ep-id` 不匹配
- 上游返回 HTML 报错页
- 非标准 JSON 结构

### `GET /api/history`

读取 `history/records.json` 中最近保存的历史记录。

每条记录可能包含：

- `id`
- `createdAt`
- `prompt`
- `duration`
- `aspectRatio`
- `resolution`
- `model`
- `taskId`
- `remoteUrl`
- `localUrl`
- `localPath`
- `ftpUrl`
- `ftpPath`

### `GET /api/history/:taskId`

读取某个任务对应的一条已落盘历史记录。

适用场景：

- `/api/task/:taskId` 已成功，但暂时没有 `local_result_url`
- 客户端超时，但服务端可能已经保存好了视频
- 需要稳定的服务器下载地址，而不是重新拉全量历史

### `GET /api/validate`

快速检查凭证和上游联通性。

查询参数：

- `apiKey`：必填
- `apiUrl`：可选

## 结果返回优先级

返回结果时，优先顺序如下：

1. `/api/task/:taskId` 中的 `local_result_url`
2. `/api/history/:taskId` 中的 `localUrl`
3. `ftp_result_url` 或 `ftpUrl`
4. 上游 `result_url` 或其他远程视频地址

## 上游渠道检查

在怀疑本地服务或技能逻辑之前，先确认上游 `NewAPI` 主机是否真的具备目标视频模型的可用渠道。

推荐检查顺序：

1. `GET /v1/models`
2. 搜索结果里是否存在目标 `Seedance` 模型或 `ep-id`
3. 用同一把 Key 和同一模型做一次人工 `POST /v1/video/generations` 验证

如果上游出现以下错误：

- `model_not_found`
- `No available channel`
- `无可用渠道（distributor）`

通常说明根因在上游模型或渠道配置，而不是本地历史保存逻辑。

## 持久化行为

视频生成成功后，服务端会把结果下载到：

- `history/videos/`

如果启用了 FTP 镜像，同一个文件还会复制到：

- `FTP_MIRROR_DIR`，例如 `/data/ftp/seedance-studio`

任务元数据会写入：

- `history/records.json`

需要注意：

- 服务端是异步保存历史记录的
- 因此任务刚成功时，`local_result_url` 可能会比上游成功状态稍晚出现
- 这种情况下，应先等待片刻，再查 `/api/history/:taskId`

## 脚本入口

优先使用的跨平台脚本：

- `scripts/generate-video.js`

包装脚本：

- `scripts/generate-video.ps1`
- `scripts/generate-video.sh`

默认情况下，脚本还会在调用方当前项目下额外下载一份文件到：

- `seedance-downloads/`

## 参数解析规则

技能脚本按以下顺序解析参数：

1. 命令行参数
2. 环境变量
3. 对仍然缺失的字段发起交互式补问
4. 对非敏感可选项使用内置默认值，例如 `duration`、`aspectRatio`、`resolution`

只有在真实 TTY 终端中，交互式补问才会触发。

当前支持的环境变量包括：

- `SEEDANCE_STUDIO_API_KEY`
- `SEEDANCE_STUDIO_PROMPT`
- `SEEDANCE_STUDIO_SERVICE_URL`
- `SEEDANCE_STUDIO_API_URL`
- `SEEDANCE_STUDIO_MODEL`
- `SEEDANCE_STUDIO_DURATION`
- `SEEDANCE_STUDIO_ASPECT_RATIO`
- `SEEDANCE_STUDIO_RESOLUTION`
- `SEEDANCE_STUDIO_IMAGE_URL`
- `SEEDANCE_STUDIO_VIDEO_URL`
- `SEEDANCE_STUDIO_DOWNLOAD_DIR`
- `SEEDANCE_STUDIO_TIMEOUT_SECONDS`
- `SEEDANCE_STUDIO_POLL_INTERVAL_MS`
- `SEEDANCE_STUDIO_SKIP_PROJECT_DOWNLOAD`

## 超时处理

如果客户端看起来超时，但上游实际上已经消费：

1. 保留原始 `taskId`
2. 查询 `/api/task/:taskId`
3. 如果状态不明确，再查 `/api/task-debug/:taskId`
4. 最后再查 `/api/history/:taskId`

在完成这些检查前，不要重新提交第二个生成任务。

## Opencode 使用约束

当这个技能被 `opencode` 或其他代理式终端调用时：

1. 优先使用 `http://10.20.3.69:3001` 这个 Seedance Studio 服务地址，而不是 `localhost`
2. 如果服务端在还没拿到 `taskId` 之前就返回错误，应直接暴露错误，不要继续自动重试
3. 不要自动退回去直接调用上游 `POST /v1/video/generations`，否则会产生重复计费
