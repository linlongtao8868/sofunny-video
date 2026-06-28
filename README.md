# sofunny-video

通过 **Sofunny AIKey** 统一调用视频生成模型（doubao-seedance 系列、阿里 DashScope HappyHorse 系列），支持文生 / 图生 / 视频生 / 参考音视频生成视频，自动提交任务、轮询状态并下载本地 mp4。

这是一个 [Claude Code Skill](https://docs.claude.com/en/docs/claude-code/skills)，由 `SKILL.md` 描述触发时机与工作流，由 `scripts/sofunny-video.js` 提供可执行入口。

## 能力一览

| 能力 | doubao-seedance | happyhorse |
|------|----------------|------------|
| 文生视频 (t2v) | ✅ 单模型 | ✅ 自动选 `*-t2v` |
| 图生视频 (i2v) | ✅ `--input` / `--image-url` | ✅ 自动选 `*-i2v` |
| 参考/视频生视频 (r2v) | ✅ `--video-url` | ✅ 自动选 `*-r2v`（1.0 视频参考会映射为图片） |
| 参考音频作背景音乐 | ✅ `--audio-url` | ✅ `reference_voice` |
| 上游生成音频 `--generate-audio` | ✅ | ❌（忽略并 warning） |
| 水印 `--watermark` | ✅ | ❌（忽略并 warning） |
| 画幅 / 时长 / 分辨率 | ✅ `--ratio` `--duration` `--resolution` | ✅ |

## 仓库结构

```
sofunny-video/
├── SKILL.md              # Skill 描述：何时使用、工作流、参数决策、错误处理
├── README.md             # 本文件
├── scripts/
│   └── sofunny-video.js  # 可执行入口：提交任务 → 轮询 → 下载 mp4
└── references/
    └── api.md            # 上游接口、请求体示例、参数速查、更多示例
```

## 安装

推荐将本仓库目录软链接到 Claude Code 的 plugin skills 目录：

```bash
ln -s /path/to/sofunny-video ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video
```

入口脚本：`${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js`

依赖：Node.js（内置 `fetch`，需 Node 18+）。

## 配置

脚本按以下顺序读取配置（后者覆盖前者）：

1. `~/.sofunny-video.env`
2. 当前 shell 的环境变量
3. 命令行参数 `--base-url` / `--api-key` / `--model`

创建配置文件：

```bash
cat > ~/.sofunny-video.env <<'EOF'
SOFUNNY_BASE_URL=https://llm-api-proxy.hnfunny.com
SOFUNNY_API_KEY=你的服务令牌
SOFUNNY_MODEL=doubao-seedance-2-0
EOF
```

> **模型别名**：env / 命令行只需写友好别名 `doubao-seedance-2-0`，脚本内部自动解析为上游实际模型 ID `doubao-seedance-2-0-260128` 用于请求，用户无需维护日期后缀。`happyhorse-1.0` 等不在别名表里的模型原样透传。要切换到 HappyHorse，把 `SOFUNNY_MODEL` 改成 `happyhorse-1.0` 即可。

文件中只应使用 `SOFUNNY_*` 变量，避免旧配置混入。

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

参考生视频（图片 + 公网音频作背景音乐）：

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "图中的人抬头微笑，背景用音频1" \
  --image-url https://example.com/ref.jpg \
  --audio-url https://example.com/bgm.mp3
```

HappyHorse 文生视频：

```bash
SOFUNNY_MODEL=happyhorse-1.0 node ${CLAUDE_PLUGIN_ROOT}/skills/sofunny-video/scripts/sofunny-video.js \
  --prompt "一只橘猫在窗台上晒太阳，微风吹过，猫咪打了个哈欠"
```

## 参数速查

| 参数 | 说明 | 默认 |
|------|------|------|
| `--prompt` | 必填，视频生成指令 | — |
| `--input` | 可重复，参考图本地路径（base64 透传） | — |
| `--image-url` | 可重复，公网 URL 参考图，原样透传 | — |
| `--video-url` | 可重复，公网 URL 参考视频（上游不接受 base64） | — |
| `--audio-url` | 可重复，公网 URL 参考音频 | — |
| `--video-input` / `--audio-input` | 已禁用，本地视频/音频无法透传，会直接报错 | — |
| `--generate-audio` / `--no-generate-audio` | 让上游为视频生成音频 | 不传 |
| `--watermark` | 透传 watermark=true | 不传 |
| `--duration` | 视频时长（秒） | 5 |
| `--ratio` | 画幅比例 | 16:9 |
| `--resolution` | 分辨率 | 1080p |
| `--seed` | 随机种子 | — |
| `--output` | 输出路径，未指定则写入当前工作目录（带时间戳） | — |
| `--model` | 覆盖模型 | `doubao-seedance-2-0` |
| `--base-url` | 覆盖服务根地址 | `https://llm-api-proxy.hnfunny.com` |
| `--api-key` | 覆盖服务令牌 | — |
| `--timeout-seconds` | 轮询超时 | 600 |
| `--poll-interval-ms` | 轮询间隔 | 3000 |
| `--debug` | 输出调试日志到 stderr | 关 |
| `--help` | 显示帮助 | — |

完整参数说明与更多示例见 [references/api.md](references/api.md)。

## 工作流

1. 脚本调用 `POST {BASE_URL}/v1/video/generations` 提交任务，取回 `task_id`。
2. 按 `--poll-interval-ms` 轮询 `GET {BASE_URL}/v1/video/generations/{task_id}`，直到 `status=completed/success` 或 `failed`。
3. 成功后通过 `GET {BASE_URL}/v1/videos/{task_id}/content` 下载视频到 `--output`（或当前工作目录），并输出 JSON 摘要（含 `saved_path`、`task_id`、`video_url` 等）。

## 重要约束

- **参考视频/音频必须是公网 web URL**：上游 doubao 不接受 base64 data URL（会返回 `reference_video must be provided as a web url`）。本地视频/音频需先上传到公网存储，再用 `--video-url` / `--audio-url` 传入；`--video-input` / `--audio-input` 已禁用，传了直接报错。
- **参考图**可以本地文件（`--input`，自动 base64 编码）或公网 URL（`--image-url`）。
- **参考项顺序固定为「图片 → 视频 → 音频」**，prompt 用「图片1/视频1/音频1」按位置引用。
- **禁止自动切换模型**：失败时不要自动换模型重试；展示错误后由用户决定是否重试或切换。
- **禁止重复提交**：客户端超时后先用 `task_id` 查询真实状态，不要重新提交，否则会重复计费。
- 本 skill 直连 `Sofunny AIKey`，`BASE_URL` 应为代理根地址，脚本自动拼出 `/v1/video/generations/...`。

更详细的注意事项、错误处理策略与协议适配差异见 [SKILL.md](SKILL.md)。
