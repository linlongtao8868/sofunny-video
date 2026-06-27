# Sofunny AIKey 视频生成接口参考

本 skill 直连 `Sofunny AIKey`（一个 New-API 衍生项目），调用 `doubao-seedance` 系列视频生成模型。下述接口均以代理根地址 `BASE_URL`（默认 `https://llm-api-proxy.hnfunny.com`）为前缀。

## 接口总览

### `POST /v1/video/generations`

提交一个视频生成任务。请求体经代理转换为火山引擎 doubao-seedance 上游格式（`/api/v3/contents/generations/tasks`）。

请求头：

```
Authorization: Bearer <SOFUNNY_API_KEY>
Content-Type: application/json
```

请求体示例（文生视频）：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "5秒电影感教室纯爱短片",
  "seconds": "5",
  "duration": 5,
  "metadata": {
    "ratio": "16:9",
    "resolution": "1080p"
  }
}
```

请求体示例（图生视频，参考图以 base64 data URL 传递）：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "保持主体不变，镜头缓缓推近。",
  "seconds": "5",
  "duration": 5,
  "metadata": {
    "ratio": "16:9",
    "resolution": "1080p",
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,...." } }
    ]
  }
}
```

请求体示例（视频生视频，参考视频**必须是公网 URL**，上游不接受 base64 data URL）：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "按参考视频的运动节奏重绘场景。",
  "seconds": "5",
  "duration": 5,
  "metadata": {
    "ratio": "16:9",
    "resolution": "1080p",
    "content": [
      { "type": "video_url", "video_url": { "url": "https://example.com/motion-ref.mp4" }, "role": "reference_video" }
    ]
  }
}
```

请求体示例（参考图 + 参考视频 + 参考音频 + 让上游生成音频，对应官方 Ark `reference_image` / `reference_video` / `reference_audio` 用法）：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "prompt": "全程使用音频1作为背景音乐，第一人称视角果茶广告。",
  "seconds": "11",
  "duration": 11,
  "metadata": {
    "ratio": "16:9",
    "resolution": "1080p",
    "generate_audio": true,
    "content": [
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,...." }, "role": "reference_image" },
      { "type": "image_url", "image_url": { "url": "data:image/jpeg;base64,...." }, "role": "reference_image" },
      { "type": "video_url", "video_url": { "url": "https://example.com/motion-ref.mp4" }, "role": "reference_video" },
      { "type": "audio_url", "audio_url": { "url": "https://example.com/bgm.mp3" }, "role": "reference_audio" }
    ]
  }
}
```

提交成功响应（代理返回 OpenAI Video 对象）：

```json
{
  "id": "task-xxxx",
  "task_id": "task-xxxx",
  "object": "video",
  "model": "doubao-seedance-2-0-260128",
  "created_at": 1782000000
}
```

重点字段：

- `task_id`：任务编号，后续轮询与下载都依赖它；缺失时回退取 `id`

### `GET /v1/video/generations/:task_id`

轮询任务状态。

请求头：

```
Authorization: Bearer <SOFUNNY_API_KEY>
```

成功响应：

```json
{
  "id": "task-xxxx",
  "task_id": "task-xxxx",
  "object": "video",
  "model": "doubao-seedance-2-0-260128",
  "status": "completed",
  "progress": 100,
  "created_at": 1782000000,
  "completed_at": 1782000600,
  "metadata": {
    "url": "https://ark-project.tos-cn-beijing.volces.com/.../output.mp4"
  }
}
```

状态取值（`dto/openai_video.go` 中的 `VideoStatus` 常量）。注意 doubao 任务完成时代理回显的是 `SUCCESS`（小写 `success`），并非 OpenAI 风格的 `completed`；脚本把 `success` / `succeeded` / `completed` 统一视为完成。轮询响应实际包在 `{code, message, data:{...}}` 里，状态字段位于 `data.status`，脚本同时兼容顶层 `status`。

| status        | 含义         | 脚本处理       |
| ------------- | ------------ | -------------- |
| `queued` / `not_start` / `pending` | 排队中 | 继续轮询 |
| `in_progress` / `processing` / `running` | 生成中 | 继续轮询 |
| `success` / `succeeded` / `completed` | 生成完成 | 下载视频 |
| `failed`      | 生成失败     | 抛出错误       |
| `unknown`     | 未知/未识别  | 视为进行中继续 |

成功时需要关注的字段：

- `metadata.url`：上游视频直链（优先取这里）
- `url`：兼容兜底
- `progress`：进度百分比
- `error`：失败时的错误信息

### `GET /v1/videos/:task_id/content`

通过代理下载视频内容。代理会根据任务所属渠道回源取视频（OpenAI/Sora 走 `{baseURL}/v1/videos/{id}/content`，Gemini/Vertex 走对应回源逻辑，doubao 走任务存储的 `result_url`），并处理 `data:` URL 解码与 SSRF 校验，最后以 `200` 流式返回视频字节，带 `Cache-Control: public, max-age=86400`。

请求头：

```
Authorization: Bearer <SOFUNNY_API_KEY>
```

约束：

- 任务必须已处于 `success`（`completed`）状态，否则返回 `400 Task is not completed yet`

## 请求体字段细节

### `model`

固定为 `doubao-seedance-2-0-260128`（可通过 `--model` / `SOFUNNY_MODEL` 覆盖）。

### `prompt`

必填，视频生成指令。代理会对空 prompt 直接返回 `400 prompt is required`。

### `seconds` 与 `duration`

doubao adaptor 在构造上游请求体时读取的是 `TaskSubmitReq.Seconds`（字符串字段），而非 `Duration`（整数）。因此本脚本同时发送两者，并以 `seconds` 为实际生效字段：

```json
{ "seconds": "5", "duration": 5 }
```

### `metadata`

火山引擎 doubao-seedance 支持的扩展字段，经代理 `UnmarshalMetadata` 反序列化进上游请求体。本脚本用到的子字段：

| 字段         | 说明                                         |
| ------------ | -------------------------------------------- |
| `ratio`      | 画幅比例，如 `16:9`、`9:16`、`1:1`           |
| `resolution` | 分辨率：`480p` / `720p` / `1080p` / `4k`     |
| `seed`       | 随机种子（整数）                             |
| `generate_audio` | 布尔，让上游为视频生成音频；对应官方 `generate_audio` |
| `watermark`  | 布尔，是否带水印；默认不传由上游决定          |
| `content`    | 参考媒体数组，见下                           |

### `metadata.content[]`

参考媒体数组。每项为以下之一（均需带 `role`，上游 doubao-seedance-2.0 校验 `role must be specified for image contents`，缺 `role` 会被拒）：

- 图片：`{ "type": "image_url", "image_url": { "url": "<data URL 或公网 URL>" }, "role": "reference_image" }`
- 视频：`{ "type": "video_url", "video_url": { "url": "<data URL 或公网 URL>" }, "role": "reference_video" }`
- 音频：`{ "type": "audio_url", "audio_url": { "url": "<data URL 或公网 URL>" }, "role": "reference_audio" }`

`role` 取值与官方 Ark curl 一致。参考项顺序建议固定为「图片 → 视频 → 音频」，prompt 用「图片1/视频1/音频1」按位置引用。

**参考媒体的 URL 形式约束**：上游 doubao-seedance-2.0 对不同媒体类型的 URL 形式要求不同——

- 图片（`reference_image`）：接受 base64 `data:` URL，也接受公网 URL。
- 视频（`reference_video`）：**必须是公网 web URL**，传 base64 `data:` URL 会被拒（`reference_video must be provided as a web url`）。
- 音频（`reference_audio`）：同样要求公网 web URL，不要用 base64。

因此本地视频/音频文件无法直接 base64 透传，必须先上传到可公网访问的存储（或直接用官方已公开的 `ark-project.tos-cn-beijing.volces.com` 资源），再用 `--video-url` / `--audio-url` 传入；本地图片仍可用 `--input` 走 base64。

**为什么所有参考媒体都放进 `metadata.content` 而不用顶层 `image`/`images`**：doubao adaptor 的 `parseRequestPayload` 先把顶层 `Images` 展开成 `r.Content` 的 `image_url` 项，再调用 `UnmarshalMetadata(req.Metadata, &r)`。如果 `metadata` 里带了 `content` 字段，标准 JSON 反序列化会用它**整体覆盖** `r.Content`，导致顶层图片项被抹掉。为避免这个坑，本脚本统一把全部参考媒体（图 + 视频）放进 `metadata.content`，不使用顶层 `image`/`images`。

### 参考媒体 URL 形式

上游 doubao-seedance 异步任务需要服务端多次读取参考媒体，对不同媒体类型的 URL 形式要求不同：

- 图片（`reference_image`）：接受 base64 `data:` URL，也接受公网 URL。本地图片文件可由脚本编码为 `data:image/png;base64,...` / `data:image/jpeg;base64,...` / `data:image/webp;base64,...` 放进请求体（走 `--input`）。
- 视频（`reference_video`）：**必须是公网 web URL**，传 base64 `data:` URL 会被上游拒（`reference_video must be provided as a web url`）。
- 音频（`reference_audio`）：同样要求公网 web URL，不要用 base64。

因此本地视频/音频文件无法直接透传，必须先上传到可公网访问的存储（或直接用官方已公开的 `ark-project.tos-cn-beijing.volces.com` 资源），再用 `--video-url` / `--audio-url` 传入；脚本对 `--video-input` / `--audio-input` 的本地文件会直接报错提示，不再静默编码成注定失败的 base64。本地图片仍可用 `--input` 走 base64。

如果参考媒体已经是公网 URL（例如已上传到对象存储），用 `--image-url` / `--video-url` / `--audio-url` 原样透传即可，避免 base64 膨胀请求体。

> 说明：用户最初提到的 `https://ark-project.tos-cn-beijing.volces.com/doc_image/` 与 `.../doc_video/` 经实测为**公开读、非公开写**的火山引擎 TOS 桶（匿名 PUT 返回 `403 AccessDenied`），无法在脚本端无凭证上传。因此本 skill 对图片改用 base64 data URL 方案；视频/音频则必须由用户自行上传到可公网访问的存储后以 URL 传入。若已自行上传到该桶或其他公网存储，直接用 `--image-url` / `--video-url` / `--audio-url` 传入即可。

## 计费说明

`doubao-seedance-2.0` 的 token 单价随两个维度变化（代理 `relay/channel/task/doubao/adaptor.go` 中的 `doubaoSeedance2CNYPrice`）：

- **输出分辨率**：480p / 720p / 1080p / 4k
- **是否含视频输入**：`metadata.content` 中存在 `type:"video_url"` 项即视为含视频输入，走「视频生视频」档位

脚本不会干预计费，仅在 `--video-input` / `--video-url` 触发时被动进入含视频输入档位。如需控制成本，注意分辨率选择与是否引入参考视频。

## 超时与恢复

如果客户端看起来超时，但任务实际已提交：

1. 保留原始 `task_id`（提交响应里取）
2. 查询 `GET /v1/video/generations/{task_id}` 判断真实状态
3. 若 `completed`，直接走 `GET /v1/videos/{task_id}/content` 下载
4. 若 `failed`，从 `error` 字段取原因

在完成上述检查前，不要重新提交第二个生成任务，否则会造成重复计费。

## 脚本入口

跨平台脚本：

- `scripts/sofunny-video.js`

（不再提供 `.sh` / `.ps1` 壳层脚本，统一用 `node` 调用 `.js`）

## 参数解析规则

脚本按以下顺序解析配置：

1. 命令行参数
2. 进程环境变量
3. `~/.sofunny-video.env`
4. 内置默认值（`duration=5`、`ratio=16:9`、`resolution=1080p` 等）

支持的环境变量：

- `SOFUNNY_BASE_URL`
- `SOFUNNY_API_KEY`
- `SOFUNNY_MODEL`

## 更多示例

多参考图 + 参考视频（参考视频必须是公网 URL，本地视频文件无法直接透传）：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "按参考视频的运动节奏，把场景换成参考图的氛围。" \
  --input /absolute/path/to/ref-a.png \
  --input /absolute/path/to/ref-b.jpg \
  --video-url https://example.com/motion-ref.mp4
```

参考音频 + 让上游生成音频（参考音频作为背景音乐，必须是公网 URL，prompt 用「音频1」按位置引用）：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "全程使用音频1作为背景音乐，第一人称视角果茶广告。" \
  --input /absolute/path/to/pic1.jpg \
  --input /absolute/path/to/pic2.jpg \
  --video-url https://example.com/motion-ref.mp4 \
  --audio-url https://example.com/bgm.mp3 \
  --generate-audio \
  --duration 11 \
  --ratio 16:9
```

直接传入已经是公网 URL 的参考媒体（不再做 base64 编码）：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "让这张图里的人物转头微笑。" \
  --image-url https://example.com/ref.png
```

指定时长、画幅、分辨率、输出路径：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "10秒赛博朋克城市夜景航拍。" \
  --duration 10 \
  --ratio 16:9 \
  --resolution 1080p \
  --output /tmp/city.mp4
```

## 参数速查

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--prompt` | 是 | 视频生成指令 |
| `--input` | 否 | 可重复，参考图本地路径；编码为 `data:image/...;base64,...` 放入 `metadata.content[].image_url` |
| `--video-input` | 已禁用 | 上游要求参考视频为公网 web URL，不接受 base64；传本地路径会直接报错。请改用 `--video-url` |
| `--audio-input` | 已禁用 | 上游要求参考音频为公网 web URL，不接受 base64；传本地路径会直接报错。请改用 `--audio-url` |
| `--image-url` | 否 | 可重复，已是公网 URL 的参考图，原样透传 |
| `--video-url` | 否 | 可重复，已是公网 URL 的参考视频，原样透传 |
| `--audio-url` | 否 | 可重复，已是公网 URL 的参考音频，原样透传 |
| `--generate-audio` | 否 | 透传 `metadata.generate_audio=true`；`--no-generate-audio` 显式置 false |
| `--watermark` | 否 | 透传 `metadata.watermark=true`；默认不传，由上游决定 |
| `--duration` | 否 | 视频时长（秒），默认 `5` |
| `--ratio` | 否 | 画幅比例，默认 `16:9` |
| `--resolution` | 否 | 分辨率，默认 `1080p`；上游价表维度之一（480p/720p/1080p/4k） |
| `--seed` | 否 | 随机种子 |
| `--output` | 否 | 输出视频文件路径；未指定时保存到当前工作目录，文件名带时间戳 |
| `--model` | 否 | 默认 `doubao-seedance-2-0-260128` |
| `--base-url` | 否 | 覆盖服务根地址 |
| `--api-key` | 否 | 覆盖服务令牌 |
| `--timeout-seconds` | 否 | 轮询超时，默认 `600` |
| `--poll-interval-ms` | 否 | 轮询间隔，默认 `3000` |
| `--debug` | 否 | 输出调试日志到 stderr |
