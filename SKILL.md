---
name: sofunny-video
version: 1.0.1
description: 通过 Sofunny AIKey 调用 doubao-seedance / HappyHorse 生成视频，支持文生/图生/视频生、参考音视频、generate_audio，提交、轮询、下载本地 mp4
---

# sofunny-video

## 何时使用

在以下场景使用本 skill：

- 用户要生成视频（文生视频、图生视频、视频生视频）
- 用户要上传参考图、参考视频或参考音频，再结合文本生成新视频
- 用户要让上游为视频生成音频（`--generate-audio`）或把参考音频作为背景音乐
- 用户希望通过 `Sofunny AIKey` 统一调用 `doubao-seedance` 或 `HappyHorse` 系列视频模型
- 用户希望优先复用进程环境变量与 `~/.sofunny-video.env`

如果只是普通文本问答、代码生成或图片生成，不要使用本 skill（图片生成用 `sofunny-image`）。

## 配置来源

脚本按「命令行参数 > 进程环境变量 > `~/.sofunny-video.env` > 内置默认值」的优先级读取配置（高优先级覆盖低优先级）。

优先变量：`SOFUNNY_BASE_URL`、`SOFUNNY_API_KEY`、`SOFUNNY_MODEL`。默认期望值：

- `SOFUNNY_BASE_URL=https://llm-api-proxy.hnfunny.com`
- `SOFUNNY_MODEL=doubao-seedance-2-0`

如果没有检测到 `~/.sofunny-video.env`，脚本会提示创建该文件并写入变量模板。文件中只应使用 `SOFUNNY_*` 变量，避免旧配置混入。

**模型别名**：env / 命令行只需写友好别名 `doubao-seedance-2-0`，脚本内部自动解析为上游实际模型 ID `doubao-seedance-2-0-260128`，用户无需维护日期后缀。`happyhorse-1.0` 等不在别名表里的模型原样透传。

## 安装与执行入口

- 推荐将仓库目录软链接到 `${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video`
- 可执行脚本入口：`${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js`
- 依赖：Node.js 18+（内置 `fetch`）

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

HappyHorse 文生视频（DashScope 渠道）：

```bash
SOFUNNY_MODEL=happyhorse-1.0 node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "一只橘猫在窗台上晒太阳，微风吹过，猫咪打了个哈欠"
```

更多示例（多参考图 + 参考视频、参考音频 + generate_audio、公网 URL 透传、指定时长/画幅/分辨率）见 [references/api.md](references/api.md#更多示例)。

## HappyHorse 模型

通过 `SOFUNNY_MODEL=happyhorse-1.0`（或 `--model happyhorse-1.0`）切换到阿里 DashScope 的 HappyHorse 系列视频模型。脚本根据输入媒体类型自动选择子模型：

- 纯文本 → `happyhorse-{ver}-t2v`（文生视频）
- 仅图片（`--input` / `--image-url`）→ `happyhorse-{ver}-i2v`（首帧生视频）
- 含视频/音频（`--video-url` / `--audio-url`）→ `happyhorse-{ver}-r2v`（参考生视频）

happyhorse 与 doubao-seedance 在请求体格式、分辨率字段、参考媒体结构上有显著差异；`generate_audio` / `watermark` / 原生视频参考在 happyhorse-1.0 上不支持（脚本会 warning 并忽略或降级映射）。完整差异表与请求体示例见 [references/api.md](references/api.md#happyhorse-dashscope-接口)。happyhorse-1.1 开通后改 `SOFUNNY_MODEL=happyhorse-1.1` 即可，子模型选择逻辑不变。

## 参数决策

- 必填：`--prompt`
- 参考媒体：本地**图片**用 `--input`（base64 透传）；参考**视频/音频必须用公网 web URL**，上游不接受 base64（传了会返回 `reference_video must be provided as a web url`）。本地视频/音频需先上传到公网存储，再用 `--video-url` / `--audio-url` 传入；`--video-input` / `--audio-input` 已禁用本地文件，传了直接报错。
- 音频：`--generate-audio` 让上游为视频生成音频；参考音频作背景音乐时同时传 `--audio-url`（公网 URL），prompt 用「音频1」按位置引用。
- 画幅/时长/分辨率：`--ratio`、`--duration`、`--resolution`；计费随分辨率与是否含视频输入变化。
- 输出：`--output` 指定路径，未指定则写入当前工作目录（文件名带时间戳）。
- 完整参数表与默认值见 [references/api.md](references/api.md#参数速查)。

## 工作流

1. 收集 prompt、参考图/视频/音频、时长、画幅、分辨率、输出路径。
   - 用户提供的图片/视频/音频必须作为 `--input` / `--image-url` / `--video-url` / `--audio-url` 传入；缺这些参数只走纯文生视频，参考媒体会被完全忽略。
   - 对话中之前生成的参考图可用其输出路径作 `--input`；视频/音频输出若需复用，因必须为公网 URL，需先确认已落到公网存储。
   - 参考项顺序固定为「图片 → 视频 → 音频」，与官方 content 数组顺序一致；prompt 用「图片1/视频1/音频1」按此顺序引用。
2. 运行 `scripts/sofunny-video.js`：`POST {BASE_URL}/v1/video/generations` 提交任务取 `task_id`。
3. 按 `--poll-interval-ms` 轮询 `GET {BASE_URL}/v1/video/generations/{task_id}`，直到 `status=completed/success` 或 `failed`。
4. 成功后 `GET {BASE_URL}/v1/videos/{task_id}/content` 下载到 `--output`（或当前工作目录），返回保存路径。

## 错误处理

- **禁止自动切换模型**：失败时不要自动换模型重试。用户配置（env 或 `--model`）指定的模型就是要用的模型。
- 失败时按顺序：展示完整错误 → 建议检查配置（API Key、模型名、上游渠道）→ 询问是否重试（同模型同参数）→ 询问是否切换模型，由用户决定。不在用户未确认下换模型、换参数或跳过错误。
- **禁止重复提交**：任务提交后若客户端超时，先用 `task_id` 查询 `GET /v1/video/generations/{task_id}` 判断真实状态，不要重新提交第二个任务，否则会重复计费。

## 注意事项

- 本 skill 直连 `Sofunny AIKey`，不经过任何中间 Seedance Studio 服务。`BASE_URL` 为代理根地址，脚本自动拼出 `/v1/video/generations/...`。
- 参考图以 base64 `data:` URL 随请求体传递；参考视频/音频**不接受 base64**，必须公网 web URL，`--video-input` / `--audio-input` 已禁用本地文件。
- 所有参考媒体统一放入 `metadata.content` 数组（`image_url` / `video_url` / `audio_url` 三类 item），不用顶层 `image`/`images`，避免 doubao adaptor 的 `UnmarshalMetadata` 用 `metadata.content` 整体覆盖顶层图片项导致参考图丢失。
- 时长通过 `seconds`（字符串）字段生效：doubao adaptor 实际读 `TaskSubmitReq.Seconds`，脚本同时发 `seconds` 与 `duration`，以 `seconds` 为准。
- 上游 `doubao-seedance-2.0` 计费随「分辨率 × 是否含视频输入」变化：传入 `--video-url` 触发「含视频输入」档位。
- 若上游返回 `model_not_found`、`No available channel` 或同类错误，优先按代理渠道或模型配置排查，而非怀疑本 skill。

接口字段细节、请求体示例、HappyHorse 协议差异、计费与超时恢复见 [references/api.md](references/api.md)。
