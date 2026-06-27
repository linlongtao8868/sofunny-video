# sofunny-video

`sofunny-video` 是一个独立维护的视频生成技能仓库，直接调用 `llm-api-proxy` 的 `doubao-seedance` 视频生成接口，完成提交任务、轮询长任务、下载本地 mp4。

## 仓库说明

这个仓库只维护技能本身，不承载 Web 服务。视频生成能力由 `llm-api-proxy`（一个 New-API 衍生项目）提供，上游为火山引擎 doubao-seedance。

当前默认服务地址：

- `https://llm-api-proxy.hnfunny.com`

默认模型：

- `doubao-seedance-2-0-260128`

适用场景：

- 文生视频、图生视频、视频生视频
- 参考图/视频以 base64 data URL 随请求传递，无需额外上传凭证
- 需要轮询长任务并在客户端超时后用 `task_id` 恢复
- 需要把结果下载到调用方本地

## 目录结构

```text
sofunny-video/
├── SKILL.md
├── README.md
├── agents/
│   └── openai.yaml
├── references/
│   └── api.md
└── scripts/
    └── sofunny-video.js
```

## 技能能力

- 通过 `llm-api-proxy` 提交 `doubao-seedance` 视频生成任务
- 轮询任务状态并下载最终 mp4
- 支持参考图（`--input` / `--image-url`）与参考视频（`--video-input` / `--video-url`）
- 参考媒体默认编码为 base64 data URL，也支持直接透传公网 URL
- 支持环境变量与 `~/.sofunny-video.env` 注入常用参数
- 跨平台，仅需 Node.js 18+

## 配置来源

脚本按以下顺序读取配置：

1. `~/.sofunny-video.env`
2. 当前 shell 的环境变量（覆盖上一步）
3. 命令行参数（覆盖以上两步）

如果没有检测到 `~/.sofunny-video.env`，脚本会在缺少 API Key 时提示你创建该文件并写入所需变量模板。

## 支持的环境变量

- `SOFUNNY_BASE_URL`
- `SOFUNNY_API_KEY`
- `SOFUNNY_MODEL`

默认期望值：

- `SOFUNNY_BASE_URL=https://llm-api-proxy.hnfunny.com`
- `SOFUNNY_MODEL=doubao-seedance-2-0-260128`

## 使用方式

### 方式一：全参数调用

```bash
node scripts/sofunny-video.js \
  --api-key "sk-xxx" \
  --prompt "5秒电影感教室纯爱短片" \
  --duration 5 \
  --ratio 16:9 \
  --resolution 1080p
```

### 方式二：环境变量 + 配置文件

```bash
export SOFUNNY_API_KEY="sk-xxx"
node scripts/sofunny-video.js --prompt "5秒电影感教室纯爱短片"
```

也可以把常用变量写到 `~/.sofunny-video.env`：

```ini
SOFUNNY_BASE_URL=https://llm-api-proxy.hnfunny.com
SOFUNNY_API_KEY=sk-xxx
SOFUNNY_MODEL=doubao-seedance-2-0-260128
```

### 方式三：带参考媒体

图生视频（本地参考图自动转 base64 data URL）：

```bash
node scripts/sofunny-video.js \
  --prompt "保持主体不变，镜头缓缓推近。" \
  --input /path/to/ref.png
```

视频生视频：

```bash
node scripts/sofunny-video.js \
  --prompt "按参考视频的运动节奏重绘场景。" \
  --video-input /path/to/motion-ref.mp4
```

参考媒体已是公网 URL 时直接透传：

```bash
node scripts/sofunny-video.js \
  --prompt "让这张图里的人物转头微笑。" \
  --image-url https://example.com/ref.png
```

## 返回结果

成功后，脚本会输出 JSON，重点字段包括：

- `task_id`：任务编号
- `status`：任务状态（`completed`）
- `video_url`：上游视频直链
- `content_url`：代理下载端点
- `saved_path`：本地保存路径
- `bytes`：文件大小
- `duration` / `ratio` / `resolution`：实际使用的参数

## 排障建议

### 1. 提示模型不可用

上游返回 `model_not_found`、`No available channel` 等错误时，优先检查 `llm-api-proxy` 是否真的挂载了 `doubao-seedance-2-0-260128` 可用渠道，而不是先怀疑本 skill。

### 2. 前端显示超时但后台有消费

不要立即重复提交。先用 `task_id` 查询 `GET /v1/video/generations/{task_id}` 判断真实状态，`completed` 则直接下载，`failed` 则取 `error` 字段。重复提交会造成重复计费。

### 3. 参考媒体被忽略

必须用 `--input` / `--video-input` / `--image-url` / `--video-url` 显式传入参考媒体。只给 `--prompt` 会走纯文生视频，参考媒体被完全忽略。

### 4. 关于 base64 data URL

参考媒体默认编码为 `data:<mime>;base64,...` 随请求体传递，无需额外上传凭证。代价是请求体变大的体积膨胀；超大文件建议先自行上传到可公网访问的存储，再用 `--image-url` / `--video-url` 传入。

## 关联项目

- `llm-api-proxy`：提供视频生成代理能力，上游为火山引擎 doubao-seedance
- `sofunny-image`：姊妹 skill，处理图片生成，结构与本仓库一致
