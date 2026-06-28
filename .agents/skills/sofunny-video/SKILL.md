---
name: sofunny-video
version: 1.0.0
description: 通过 Sofunny AIKey 调用 doubao-seedance 视频生成接口，支持文生/图生/视频生视频、参考音视频与 generate_audio，提交任务、轮询并下载本地 mp4。
---

# sofunny-video

## 何时使用

在以下场景使用本 skill：

- 用户要生成视频（文生视频、图生视频、视频生视频）
- 用户要上传一张参考图、一段参考视频或一段参考音频，再结合文本生成新视频
- 用户要让上游为视频生成音频（`--generate-audio`）或把参考音频作为背景音乐
- 用户希望通过 `Sofunny AIKey` 统一调用 `doubao-seedance` 系列模型
- 用户希望优先复用：
  - 进程环境变量
  - `~/.sofunny-video.env`

如果只是普通文本问答、代码生成或图片生成，不要使用本 skill（图片生成用 `sofunny-image`）。

## 配置来源

脚本按以下顺序读取配置（后者覆盖前者）：

1. `~/.sofunny-video.env`
2. 当前 shell 的环境变量
3. 命令行参数 `--base-url` / `--api-key` / `--model`

如果没有检测到 `~/.sofunny-video.env`，脚本会提示你创建该文件并写入变量模板。优先变量：`SOFUNNY_BASE_URL`、`SOFUNNY_API_KEY`、`SOFUNNY_MODEL`。默认期望值：

- `SOFUNNY_BASE_URL=https://llm-api-proxy.hnfunny.com`
- `SOFUNNY_MODEL=doubao-seedance-2-0-260128`

## 安装与执行入口

- 推荐将仓库目录软链接到 `${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video`
- 可执行脚本入口：`${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js`

## 快速用法

文生视频：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "5秒电影感教室纯爱短片，16:9。"
```

图生视频（参考图为本地文件，自动编码为 base64 data URL）：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "保持主体不变，镜头缓缓推近。" \
  --input /absolute/path/to/ref-1.png
```

更多示例（多参考图 + 参考视频、参考音频 + generate_audio、公网 URL 透传、指定时长/画幅/分辨率）见 [references/api.md](references/api.md#更多示例)。

## Happyhorse (DashScope) 模型

通过 `SOFUNNY_MODEL=happyhorse-1.0` 切换到阿里 DashScope 的 HappyHorse 系列视频模型（渠道 type=17）。脚本根据输入媒体类型自动选择子模型：

- 纯文本 `--prompt`（无任何参考媒体）→ `happyhorse-1.0-t2v`（文生视频）
- 仅图片参考（`--input` / `--image-url`）→ `happyhorse-1.0-i2v`（首帧生视频）
- 包含视频/音频参考（`--video-url` / `--audio-url`）→ `happyhorse-1.0-r2v`（参考生视频）

### 使用示例

文生视频：
```bash
SOFUNNY_MODEL=happyhorse-1.0 node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "一只橘猫在窗台上晒太阳，微风吹过，猫咪打了个哈欠"
```

图生视频（公网 URL 参考图）：
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --model happyhorse-1.0 \
  --prompt "让图片中的人转头微笑" \
  --image-url https://example.com/ref.png
```

参考生视频（图片 + 音频作为背景音乐）：
```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --model happyhorse-1.0 \
  --prompt "图中的人抬头微笑，背景用音频1" \
  --image-url https://example.com/ref.jpg \
  --audio-url https://example.com/bgm.mp3
```

### 与 doubao-seedance 的关键差异

| 维度 | doubao-seedance | happyhorse |
|------|----------------|------------|
| 子模型选择 | 单模型 | 自动选 t2v/i2v/r2v |
| 分辨率 | `metadata.resolution` ("1080p") | 顶层 `size` ("1080P") |
| 参考媒体 | `metadata.content[]` + role | `media[]` / `input_reference` |
| 音频 | 独立 `audio_url` 项 | `reference_voice` 挂在 media 项上 |
| 视频参考 | `reference_video` | 1.0 不支持，会映射为 reference_image 并 warning；1.1 待验证 |
| generate_audio | 支持 | 不支持（会 warning 并忽略） |
| watermark | 支持 | 不支持（会 warning 并忽略） |

happyhorse-1.1 开通后，将 `SOFUNNY_MODEL=happyhorse-1.1` 即可切换，子模型选择逻辑不变。

## 参数决策

- 必填：`--prompt`
- 参考媒体：本地**图片**用 `--input`（base64 透传，上游接受）；参考**视频/音频必须用公网 web URL**，上游不接受 base64（传了会返回 `reference_video must be provided as a web url`）。本地视频/音频文件需先自行上传到可公网访问的存储，再用 `--video-url` / `--audio-url` 传入；`--video-input` / `--audio-input` 已禁用本地文件，传了会直接报错提示。
- 音频：`--generate-audio` 让上游为视频生成音频；参考音频作背景音乐时同时传 `--audio-url`（公网 URL），prompt 用「音频1」按位置引用
- 画幅/时长/分辨率：`--ratio`、`--duration`、`--resolution`；计费随分辨率与是否含视频输入变化
- 输出：`--output` 指定路径，未指定则写入当前工作目录（文件名带时间戳）
- 完整参数表与默认值见 [references/api.md](references/api.md#参数速查)

## 工作流

1. 收集用户的 prompt、参考图/视频/音频、时长、画幅、分辨率、输出路径。
   - **图生/视频生/音频参考判断**：当用户提供了图片/视频/音频，必须作为 `--input` / `--image-url` / `--video-url` / `--audio-url` 传入。没有这些参数的调用只会走纯文生视频，参考媒体会被完全忽略。
   - 如果用户提到的参考媒体是对话中之前生成的，使用之前保存的输出路径作为 `--input`（图片）。视频/音频输出若需复用，因其必须为公网 URL，需先确认已落到可公网访问的存储。
   - 参考视频/音频必须是公网 web URL，上游不接受 base64 data URL；本地视频/音频文件需先上传到公网存储再用 `--video-url` / `--audio-url` 传入。
   - 参考项顺序固定为「图片 → 视频 → 音频」，与官方 content 数组顺序一致；prompt 用「图片1/视频1/音频1」按此顺序引用。
2. 运行 `scripts/sofunny-video.js`。
3. 脚本调用 `POST {BASE_URL}/v1/video/generations` 提交任务，从响应中取 `task_id`。
4. 脚本按 `--poll-interval-ms` 轮询 `GET {BASE_URL}/v1/video/generations/{task_id}`，直到 `status=completed` 或 `failed`。
5. 成功后通过 `GET {BASE_URL}/v1/videos/{task_id}/content` 下载视频到 `--output` 指定路径（或当前工作目录），并把保存路径返回给用户。

## 错误处理

- **禁止自动切换模型**：如果脚本调用失败，不要自动更换模型重试。用户配置（env 或 `--model`）指定的模型就是要用的模型。
- 失败时应按以下顺序提示用户：
  1. 展示完整错误信息
  2. 建议用户检查配置（API Key、模型名称、上游是否挂载可用渠道）
  3. 询问用户是否要重试（相同模型、相同参数）
  4. 询问用户是否要切换到其他模型，由用户决定
- 不要在用户未确认的情况下更换模型、更换参数或跳过错误。
- **禁止重复提交**：任务提交后若客户端超时，先用 `task_id` 查询 `GET /v1/video/generations/{task_id}` 判断真实状态，不要重新提交第二个生成任务，否则会造成重复计费。

## 注意事项

- 本 skill 直连 `Sofunny AIKey`，不再经过任何中间 Seedance Studio 服务。`BASE_URL` 应为代理根地址，脚本会自动拼出 `/v1/video/generations/...`。
- 参考图以 base64 `data:` URL 随请求体传递（上游接受 `reference_image` 的 base64）；参考视频/音频**不接受 base64**，上游要求公网 web URL，传 base64 会被拒（`reference_video must be provided as a web url`）。因此本地视频/音频文件无法直接透传，必须先上传到可公网访问的存储，再用 `--video-url` / `--audio-url` 传入；`--video-input` / `--audio-input` 已禁用本地文件，传了会直接报错提示。
- 所有参考媒体统一放入 `metadata.content` 数组（`image_url` / `video_url` / `audio_url` 三类 item），不使用顶层 `image` / `images` 字段。这是为了避免 doubao adaptor 的 `UnmarshalMetadata` 用 `metadata.content` 覆盖掉顶层图片项导致参考图丢失。
- `generate_audio` / `watermark` 通过 `metadata` 透传：doubao adaptor 的 `requestPayload` 经 `UnmarshalMetadata` 反序列化这两个字段后再 marshal 给上游。后端早已支持，本 skill 仅负责把参数发出去。
- 时长通过 `seconds`（字符串）字段传递：doubao adaptor 实际读取 `TaskSubmitReq.Seconds`，脚本同时发送 `seconds` 与 `duration`，以 `seconds` 为准。
- 视频下载默认走代理的 `/v1/videos/{task_id}/content` 端点，它已处理上游鉴权与 `data:` URL 解码；若需要直链，可从返回 JSON 的 `video_url` 字段取上游地址。
- `~/.sofunny-video.env` 中只应使用 `SOFUNNY_*` 变量，避免旧配置混入导致行为不一致。
- 上游 `doubao-seedance-2.0` 计费随「分辨率 × 是否含视频输入」变化：传入 `--video-url` 会触发「含视频输入」档位，价格不同。
- 若上游返回 `model_not_found`、`No available channel` 或同类错误，优先按代理渠道或模型配置问题排查，而不是怀疑本 skill。
