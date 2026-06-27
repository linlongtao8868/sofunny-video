#!/usr/bin/env node

// sofunny-video：直接调用 Sofunny AIKey 的 doubao-seedance 视频生成接口。
// 提交任务 -> 轮询状态 -> 下载视频到本地。
// 参考图/视频以 base64 data URL 形式随请求体传递（上游异步任务需可直接读取的媒体）。
// 配置优先级：命令行参数 > 进程环境变量 > ~/.sofunny-video.env > 默认值。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const HOME = os.homedir();
const SOFUNNY_ENV_PATH = path.join(HOME, ".sofunny-video.env");

const DEFAULT_BASE_URL = "https://llm-api-proxy.hnfunny.com";
const DEFAULT_MODEL = "doubao-seedance-2-0-260128";
const DEFAULT_DURATION = 5;
const DEFAULT_RATIO = "16:9";
const DEFAULT_RESOLUTION = "1080p";
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SECONDS = 600;

// 上游返回的任务状态（dto/openai_video.go 中的 VideoStatus 常量）。
// doubao 任务完成时代理回显 status=SUCCESS（小写 success），与 OpenAI 风格的 completed 不同，
// 因此 success / succeeded / completed 都视为完成。
const SUCCESS_STATUS = new Set(["completed", "success", "succeeded"]);
const ACTIVE_STATUS = new Set(["queued", "in_progress", "unknown", "not_start", "processing", "running", "pending"]);
const FAILURE_STATUS = "failed";

let debugEnabled = false;

function printHelp() {
  console.log(`sofunny-video

使用：
  node scripts/sofunny-video.js --prompt "5秒电影感教室纯爱短片"

参数：
  --prompt           必填，视频生成指令
  --input            可重复，参考图本地路径（编码为 base64 data URL 传入 image_url）
  --video-input      已禁用：上游要求参考视频为公网 web URL，不接受 base64。请改用 --video-url
  --audio-input      已禁用：上游要求参考音频为公网 web URL，不接受 base64。请改用 --audio-url
  --image-url        可重复，已是公网 URL 的参考图，原样透传
  --video-url        可重复，已是公网 URL 的参考视频，原样透传
  --audio-url        可重复，已是公网 URL 的参考音频，原样透传
  --generate-audio   透传 generate_audio=true（让上游为视频生成音频）
  --no-generate-audio 显式透传 generate_audio=false
  --watermark        透传 watermark=true（默认不传，由上游决定）
  --duration         视频时长（秒），默认 5
  --ratio            画幅比例，默认 16:9
  --resolution       分辨率，默认 1080p
  --seed             可选，随机种子
  --output           可选，输出视频文件路径；未指定时写到当前工作目录
  --model            覆盖模型，默认 ${DEFAULT_MODEL}
  --base-url         覆盖服务根地址，默认 ${DEFAULT_BASE_URL}
  --api-key          覆盖服务令牌
  --timeout-seconds  轮询超时，默认 ${DEFAULT_TIMEOUT_SECONDS}
  --poll-interval-ms 轮询间隔，默认 ${DEFAULT_POLL_INTERVAL_MS}
  --debug            输出调试日志到 stderr
  --help             显示帮助
`);
}

function parseArgs(argv) {
  const result = { input: [], videoInput: [], imageUrl: [], videoUrl: [], audioInput: [], audioUrl: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--prompt":
        result.prompt = argv[++i];
        break;
      case "--input":
        result.input.push(argv[++i]);
        break;
      case "--video-input":
        result.videoInput.push(argv[++i]);
        break;
      case "--image-url":
        result.imageUrl.push(argv[++i]);
        break;
      case "--video-url":
        result.videoUrl.push(argv[++i]);
        break;
      case "--audio-input":
        result.audioInput.push(argv[++i]);
        break;
      case "--audio-url":
        result.audioUrl.push(argv[++i]);
        break;
      case "--generate-audio":
        result.generateAudio = true;
        break;
      case "--no-generate-audio":
        result.generateAudio = false;
        break;
      case "--watermark":
        result.watermark = true;
        break;
      case "--output":
        result.output = argv[++i];
        break;
      case "--duration":
        result.duration = argv[++i];
        break;
      case "--ratio":
        result.ratio = argv[++i];
        break;
      case "--resolution":
        result.resolution = argv[++i];
        break;
      case "--seed":
        result.seed = argv[++i];
        break;
      case "--model":
        result.model = argv[++i];
        break;
      case "--base-url":
        result.baseUrl = argv[++i];
        break;
      case "--api-key":
        result.apiKey = argv[++i];
        break;
      case "--timeout-seconds":
        result.timeoutSeconds = argv[++i];
        break;
      case "--poll-interval-ms":
        result.pollIntervalMs = argv[++i];
        break;
      case "--help":
      case "-h":
        result.help = true;
        break;
      case "--debug":
        result.debug = true;
        break;
      default:
        throw new Error(`不支持的参数：${arg}`);
    }
  }
  return result;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const content = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, "");
    env[key] = value;
  }
  return env;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeBaseUrl(rawBaseUrl) {
  if (!rawBaseUrl) return "";
  return rawBaseUrl.trim().replace(/\/+$/, "");
}

function applyConfigOverlay(target, source) {
  if (!source) return;
  if (source.SOFUNNY_BASE_URL) target.baseUrl = source.SOFUNNY_BASE_URL;
  if (source.SOFUNNY_API_KEY) target.apiKey = source.SOFUNNY_API_KEY;
  if (source.SOFUNNY_MODEL) target.model = source.SOFUNNY_MODEL;
}

function resolveConfig(cliArgs) {
  const envFileExists = fs.existsSync(SOFUNNY_ENV_PATH);
  const fileEnv = parseEnvFile(SOFUNNY_ENV_PATH);
  const merged = {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: "",
    model: DEFAULT_MODEL,
  };

  // 先读 env 文件，再让进程环境变量覆盖，最后命令行参数覆盖。
  applyConfigOverlay(merged, fileEnv);
  applyConfigOverlay(merged, process.env);

  if (cliArgs.baseUrl) merged.baseUrl = cliArgs.baseUrl;
  if (cliArgs.apiKey) merged.apiKey = cliArgs.apiKey;
  if (cliArgs.model) merged.model = cliArgs.model;

  return {
    baseUrl: normalizeBaseUrl(merged.baseUrl),
    apiKey: merged.apiKey,
    model: merged.model,
    envFileExists,
  };
}

function buildEnvFileHint() {
  return [
    `未检测到 ${SOFUNNY_ENV_PATH}，也未通过环境变量或 --api-key 提供 API Key。`,
    "请先创建该文件，并写入以下变量：",
    `SOFUNNY_BASE_URL=${DEFAULT_BASE_URL}`,
    "SOFUNNY_API_KEY=你的服务令牌",
    `SOFUNNY_MODEL=${DEFAULT_MODEL}`,
  ].join("\n");
}

function detectMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".ogg":
    case ".oga":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    default:
      return "application/octet-stream";
  }
}

function buildDataUrl(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`输入文件不存在：${absolutePath}`);
  }
  const base64 = fs.readFileSync(absolutePath).toString("base64");
  return `data:${detectMimeType(absolutePath)};base64,${base64}`;
}

function debugLog(message, extra) {
  if (!debugEnabled) return;
  const prefix = `[sofunny-video ${new Date().toISOString()}]`;
  if (extra === undefined) {
    console.error(`${prefix} ${message}`);
    return;
  }
  console.error(`${prefix} ${message} ${JSON.stringify(extra)}`);
}

function extractErrorMessage(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.message || value.error?.message || value.error || value.detail || JSON.stringify(value);
  }
  return String(value);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const error = new Error(`无法解析上游 JSON 响应：${url} (status=${response.status}) body=${text.slice(0, 160)}`);
      error.status = response.status;
      throw error;
    }
  }
  if (!response.ok) {
    const message =
      extractErrorMessage(data?.error) ||
      extractErrorMessage(data?.message) ||
      `请求失败，状态码 ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

// 构造参考媒体 content 数组。所有参考图/视频/音频统一放进 metadata.content，
// 避免顶层 image/images 字段被 doubao adaptor 的 UnmarshalMetadata 覆盖。
// 参考项顺序：图片 → 视频 → 音频，与官方文档 content 数组顺序一致，便于 prompt
// 用「图片1/视频1/音频1」按位置引用。
// 每项必须带 role：上游 doubao-seedance-2.0 校验 "role must be specified for image contents"，
// 图/视频/音频分别用 reference_image / reference_video / reference_audio（与官方 Ark curl 一致）。
//
// 上游对不同媒体类型的 URL 形式要求不同：
// - reference_image：接受 base64 data URL，也接受公网 URL（本地文件可走 --input 编码）。
// - reference_video / reference_audio：必须是公网 web URL，传 base64 data URL 会被上游拒
//   （reference_video must be provided as a web url）。
// 因此本地视频/音频文件无法直接透传——rejectUnsupportedLocalMedia 会前置拦截并提示用户
// 先上传到公网存储再用 --video-url / --audio-url 传入，避免静默编码成注定失败的 base64。
function buildContentItems(cliArgs) {
  const items = [];

  for (const filePath of cliArgs.input) {
    items.push({ type: "image_url", image_url: { url: buildDataUrl(filePath) }, role: "reference_image" });
  }
  for (const url of cliArgs.imageUrl) {
    items.push({ type: "image_url", image_url: { url }, role: "reference_image" });
  }
  for (const url of cliArgs.videoUrl) {
    items.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  }
  for (const url of cliArgs.audioUrl) {
    items.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }

  return items;
}

// 前置拦截：本地视频/音频文件无法直接透传，上游要求公网 web URL。
// cliArgs.videoInput / cliArgs.audioInput 仍被 parseArgs 收集（以便给出友好报错），
// 但不再编码成 base64；命中即抛错，提示用户改用 --video-url / --audio-url。
function rejectUnsupportedLocalMedia(cliArgs) {
  if (cliArgs.videoInput.length > 0) {
    throw new Error(
      "参考视频不支持本地文件：上游 doubao-seedance 要求 reference_video 为公网 web URL，" +
        "传 base64 data URL 会被拒（reference_video must be provided as a web url）。" +
        "请先将视频上传到可公网访问的存储，再用 --video-url <公网URL> 传入。",
    );
  }
  if (cliArgs.audioInput.length > 0) {
    throw new Error(
      "参考音频不支持本地文件：上游 doubao-seedance 要求 reference_audio 为公网 web URL，" +
        "传 base64 data URL 会被拒。请先将音频上传到可公网访问的存储，再用 --audio-url <公网URL> 传入。",
    );
  }
}

function buildRequestBody(config, cliArgs, duration) {
  const body = {
    model: config.model,
    prompt: cliArgs.prompt,
    // doubao adaptor 读取 TaskSubmitReq.Seconds（字符串）作为上游 duration。
    seconds: String(duration),
    duration,
    metadata: {
      ratio: cliArgs.ratio,
      resolution: cliArgs.resolution,
    },
  };

  if (cliArgs.seed !== undefined && cliArgs.seed !== "") {
    const seed = Number.parseInt(cliArgs.seed, 10);
    if (!Number.isNaN(seed)) {
      body.metadata.seed = seed;
    }
  }

  // generate_audio / watermark 走 metadata 透传：doubao adaptor 的 requestPayload
  // 经 UnmarshalMetadata(req.Metadata, &r) 反序列化这两个字段，再 marshal 给上游。
  if (cliArgs.generateAudio === true) {
    body.metadata.generate_audio = true;
  } else if (cliArgs.generateAudio === false) {
    body.metadata.generate_audio = false;
  }
  if (cliArgs.watermark === true) {
    body.metadata.watermark = true;
  }

  const contentItems = buildContentItems(cliArgs);
  if (contentItems.length > 0) {
    body.metadata.content = contentItems;
  }

  return body;
}

function extractTaskId(payload) {
  return payload?.task_id || payload?.taskId || payload?.id || null;
}

function normalizeStatus(raw) {
  return String(raw || "").trim().toLowerCase();
}

function extractVideoUrl(payload) {
  return (
    payload?.metadata?.url ||
    payload?.url ||
    payload?.data?.url ||
    payload?.data?.metadata?.url ||
    null
  );
}

function buildSubmitEndpoint(config) {
  return `${config.baseUrl}/v1/video/generations`;
}

function buildPollEndpoint(config, taskId) {
  return `${config.baseUrl}/v1/video/generations/${encodeURIComponent(taskId)}`;
}

function buildContentEndpoint(config, taskId) {
  return `${config.baseUrl}/v1/videos/${encodeURIComponent(taskId)}/content`;
}

async function submitTask(config, cliArgs, duration) {
  const endpoint = buildSubmitEndpoint(config);
  const body = buildRequestBody(config, cliArgs, duration);
  const startedAt = Date.now();

  debugLog("request:start", { endpoint, model: config.model, duration, has_content: Boolean(body.metadata.content) });

  const response = await requestJson(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  debugLog("request:response", { endpoint, duration_ms: Date.now() - startedAt });

  const taskId = extractTaskId(response);
  if (!taskId) {
    throw new Error(`提交任务未返回 task_id：${JSON.stringify(response).slice(0, 200)}`);
  }
  return { taskId, raw: response };
}

async function pollTask(config, taskId) {
  const endpoint = buildPollEndpoint(config, taskId);
  const response = await requestJson(endpoint, {
    method: "GET",
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });
  const status = normalizeStatus(response.status || response.data?.status);
  return { status, payload: response };
}

function guessExtension(contentType) {
  const type = (contentType || "").toLowerCase();
  if (type.includes("video/mp4")) return ".mp4";
  if (type.includes("video/webm")) return ".webm";
  if (type.includes("video/quicktime")) return ".mov";
  return ".mp4";
}

function defaultOutputPath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(process.cwd(), `sofunny-video-${stamp}.mp4`);
}

function buildOutputPath(requestedOutput) {
  return requestedOutput ? path.resolve(requestedOutput) : defaultOutputPath();
}

async function downloadVideo(config, taskId, outputPath) {
  // 优先走代理 content 端点：它已处理上游鉴权与 data: URL 解码，且带缓存头。
  const endpoint = buildContentEndpoint(config, taskId);
  const startedAt = Date.now();
  debugLog("download:start", { endpoint });

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`下载视频失败：${endpoint} status=${response.status} body=${text.slice(0, 160)}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const extension = guessExtension(contentType);
  const finalPath = outputPath.endsWith(extension)
    ? outputPath
    : outputPath.replace(/\.[^.]+$/, "") + extension;

  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.promises.writeFile(finalPath, buffer);

  debugLog("download:done", { endpoint, duration_ms: Date.now() - startedAt, bytes: buffer.length });

  return { savedPath: finalPath, bytes: buffer.length, contentType };
}

async function run() {
  const cliArgs = parseArgs(process.argv.slice(2));
  debugEnabled = Boolean(cliArgs.debug);

  if (cliArgs.help) {
    printHelp();
    return;
  }

  if (!cliArgs.prompt) {
    throw new Error("缺少 --prompt");
  }

  // 本地视频/音频文件无法直接透传（上游要求公网 web URL），尽早拦截给出正确用法。
  rejectUnsupportedLocalMedia(cliArgs);

  const config = resolveConfig(cliArgs);

  if (!config.apiKey) {
    if (!config.envFileExists && !process.env.SOFUNNY_API_KEY && !cliArgs.apiKey) {
      throw new Error(buildEnvFileHint());
    }
    throw new Error("未找到 SOFUNNY_API_KEY，请通过环境变量、~/.sofunny-video.env 或 --api-key 提供。");
  }

  const duration = Number(cliArgs.duration || DEFAULT_DURATION);
  const ratio = cliArgs.ratio || DEFAULT_RATIO;
  const resolution = cliArgs.resolution || DEFAULT_RESOLUTION;
  const pollIntervalMs = Number(cliArgs.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS);
  const timeoutSeconds = Number(cliArgs.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS);

  // 把已解析的可选参数回填到 cliArgs，供 buildRequestBody 使用。
  cliArgs.ratio = ratio;
  cliArgs.resolution = resolution;

  // 1. 提交任务
  const submitted = await submitTask(config, cliArgs, duration);
  const taskId = submitted.taskId;
  debugLog("task:submitted", { task_id: taskId });

  // 2. 轮询
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus = "";
  let lastPayload = null;

  while (Date.now() <= deadline) {
    await sleep(pollIntervalMs);
    const { status, payload } = await pollTask(config, taskId);
    lastStatus = status;
    lastPayload = payload;
    debugLog("task:poll", { task_id: taskId, status });

    if (ACTIVE_STATUS.has(status)) {
      continue;
    }

    if (SUCCESS_STATUS.has(status)) {
      // 3. 下载
      const outputPath = buildOutputPath(cliArgs.output);
      const download = await downloadVideo(config, taskId, outputPath);
      const videoUrl = extractVideoUrl(payload);
      const summary = {
        model: config.model,
        base_url: config.baseUrl,
        task_id: taskId,
        status,
        video_url: videoUrl,
        content_url: buildContentEndpoint(config, taskId),
        saved_path: download.savedPath,
        bytes: download.bytes,
        duration,
        ratio,
        resolution,
      };
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    if (status === FAILURE_STATUS) {
      const message =
        extractErrorMessage(payload?.error) ||
        extractErrorMessage(payload?.data?.error) ||
        `任务失败：${taskId}`;
      const error = new Error(message);
      error.taskId = taskId;
      error.statusText = status;
      error.payload = payload;
      throw error;
    }

    // 未知状态视为进行中，继续轮询。
  }

  const timeoutError = new Error(`轮询超时：任务 ${taskId} 仍在 ${lastStatus || "unknown"} 状态`);
  timeoutError.taskId = taskId;
  timeoutError.statusText = lastStatus || "TIMEOUT";
  timeoutError.payload = lastPayload;
  throw timeoutError;
}

run().catch((error) => {
  debugLog("request:error", {
    message: error.message || String(error),
    code: error.code,
    stack: error.stack ? error.stack.split("\n").slice(0, 3).join(" | ") : undefined,
  });
  const details = {
    error: error.message || String(error),
    task_id: error.taskId || null,
    status: error.statusText || null,
    payload: error.payload || error.body || null,
  };
  console.error(JSON.stringify(details, null, 2));
  process.exit(1);
});
