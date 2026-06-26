#!/usr/bin/env node

// sofunny-video：通过 Seedance Studio 服务提交 Seedance 视频生成任务并返回服务器可访问的下载链接。
// 配置优先级：命令行参数 > 进程环境变量 > ~/.sofunny-video.env > 默认值。

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const HOME = os.homedir();
const SOFUNNY_ENV_PATH = path.join(HOME, '.sofunny-video.env');

const DEFAULT_SERVICE_URL = 'http://10.20.3.69:3001';
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_DOWNLOAD_DIR = 'sofunny-video-downloads';
const DEFAULT_DURATION = 5;
const DEFAULT_ASPECT_RATIO = '16:9';
const DEFAULT_RESOLUTION = '1080p';
const SUCCESS_STATES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE']);
const ACTIVE_STATES = new Set(['NOT_START', 'PENDING', 'IN_PROGRESS', 'RUNNING', 'PROCESSING', 'QUEUED', 'SUBMITTED']);

function printUsage() {
  const lines = [
    'Usage:',
    '  node sofunny-video.js --api-key <key> --prompt <text> [options]',
    '',
    'Options:',
    '  --service-url <url>      Local Seedance Studio service URL',
    '  --api-url <url>          Upstream NewAPI base URL override',
    '  --model <id>             Upstream model id or ep-id',
    '  --duration <seconds>     Video duration, default 5',
    '  --aspect-ratio <ratio>   Aspect ratio, default 16:9',
    '  --resolution <value>     Resolution, default 1080p',
    '  --image-url <data-url>   Reference image data URL',
    '  --video-url <data-url>   Reference video data URL',
    '  --download-dir <path>    Project-local download directory',
    '  --timeout-seconds <n>    Poll timeout, default 600',
    '  --poll-interval-ms <n>   Poll interval, default 3000',
    '  --skip-project-download  Skip the default local project copy',
    '  --help                   Show this help',
    '',
    'Environment fallbacks (process env > ~/.sofunny-video.env):',
    '  SOFUNNY_API_KEY',
    '  SOFUNNY_PROMPT',
    '  SOFUNNY_SERVICE_URL',
    '  SOFUNNY_API_URL',
    '  SOFUNNY_MODEL',
    '  SOFUNNY_DURATION',
    '  SOFUNNY_ASPECT_RATIO',
    '  SOFUNNY_RESOLUTION',
    '  SOFUNNY_IMAGE_URL',
    '  SOFUNNY_VIDEO_URL',
    '  SOFUNNY_DOWNLOAD_DIR',
    '  SOFUNNY_TIMEOUT_SECONDS',
    '  SOFUNNY_POLL_INTERVAL_MS',
    '  SOFUNNY_SKIP_PROJECT_DOWNLOAD'
  ];
  console.log(lines.join('\n'));
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const index = line.indexOf('=');
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }

  return env;
}

function parseArgs(argv) {
  const args = {};
  const flagKeys = new Set(['help', 'skip-project-download']);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const key = token.slice(2);
    if (flagKeys.has(key)) {
      args[key] = true;
      continue;
    }

    const value = argv[i + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    i += 1;
  }
  return args;
}

function toPositiveNumber(value, fallback, label) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function normalizeStatus(raw) {
  return String(raw || '').trim().toUpperCase();
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function parseBooleanEnv(value) {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function isInteractiveTerminal() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function askQuestion(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function promptText(rl, label, options = {}) {
  const defaultValue = options.defaultValue == null ? '' : String(options.defaultValue);
  const required = Boolean(options.required);
  const optionalHint = options.optionalHint || '';

  while (true) {
    const hintParts = [];
    if (defaultValue) {
      hintParts.push(`default: ${defaultValue}`);
    } else if (!required && optionalHint) {
      hintParts.push(optionalHint);
    }

    const suffix = hintParts.length ? ` [${hintParts.join(', ')}]` : '';
    const answer = (await askQuestion(rl, `${label}${suffix}: `)).trim();

    if (answer) {
      return answer;
    }

    if (defaultValue) {
      return defaultValue;
    }

    if (!required) {
      return '';
    }

    console.log(`${label} is required.`);
  }
}

async function promptPositiveNumber(rl, label, defaultValue, numericLabel) {
  while (true) {
    const answer = await promptText(rl, label, { defaultValue: String(defaultValue) });
    try {
      return toPositiveNumber(answer, defaultValue, numericLabel);
    } catch (error) {
      console.log(error.message);
    }
  }
}

async function promptForMissingFields(rawConfig) {
  if (!isInteractiveTerminal()) {
    return rawConfig;
  }

  const fieldsToPrompt = [
    !rawConfig.apiKey && 'apiKey',
    !rawConfig.prompt && 'prompt',
    !rawConfig.apiUrl && 'apiUrl',
    !rawConfig.model && 'model',
    !rawConfig.duration && 'duration',
    !rawConfig.aspectRatio && 'aspectRatio',
    !rawConfig.resolution && 'resolution'
  ].filter(Boolean);

  if (!fieldsToPrompt.length) {
    return rawConfig;
  }

  console.log('Missing values detected. Starting interactive prompts...');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    if (!rawConfig.apiKey) {
      rawConfig.apiKey = await promptText(rl, 'API key', { required: true });
    }

    if (!rawConfig.prompt) {
      rawConfig.prompt = await promptText(rl, 'Prompt', { required: true });
    }

    if (!rawConfig.apiUrl) {
      rawConfig.apiUrl = await promptText(rl, 'Upstream apiUrl', {
        optionalHint: 'press Enter to use the server default upstream'
      });
    }

    if (!rawConfig.model) {
      rawConfig.model = await promptText(rl, 'Model / ep-id', {
        optionalHint: 'press Enter to use the server default model'
      });
    }

    if (!rawConfig.duration) {
      rawConfig.duration = String(
        await promptPositiveNumber(rl, 'Duration seconds', DEFAULT_DURATION, 'duration')
      );
    }

    if (!rawConfig.aspectRatio) {
      rawConfig.aspectRatio = await promptText(rl, 'Aspect ratio', {
        defaultValue: DEFAULT_ASPECT_RATIO
      });
    }

    if (!rawConfig.resolution) {
      rawConfig.resolution = await promptText(rl, 'Resolution', {
        defaultValue: DEFAULT_RESOLUTION
      });
    }
  } finally {
    rl.close();
  }

  return rawConfig;
}

function extractErrorMessage(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return (
      value.message ||
      value.error?.message ||
      value.error ||
      value.detail ||
      JSON.stringify(value)
    );
  }
  return String(value);
}

function sanitizeFilenamePart(value, fallback) {
  return String(value || fallback || 'sofunny')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || fallback;
}

function guessFileExtension(url, contentType) {
  const pathname = (() => {
    try {
      return new URL(url).pathname || '';
    } catch {
      return '';
    }
  })();
  const ext = path.extname(pathname).toLowerCase();
  if (ext) return ext;

  const type = (contentType || '').toLowerCase();
  if (type.includes('video/mp4')) return '.mp4';
  if (type.includes('video/webm')) return '.webm';
  if (type.includes('video/quicktime')) return '.mov';
  return '.mp4';
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
      const error = new Error(`Expected JSON from ${url} but received: ${text.slice(0, 160)}`);
      error.status = response.status;
      throw error;
    }
  }

  if (!response.ok) {
    const message =
      extractErrorMessage(data?.error) ||
      extractErrorMessage(data?.message) ||
      `Request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

function buildTaskUrl(serviceUrl, taskId, apiKey, apiUrl) {
  const url = new URL(`/api/task/${encodeURIComponent(taskId)}`, serviceUrl);
  url.searchParams.set('apiKey', apiKey);
  if (apiUrl) {
    url.searchParams.set('apiUrl', apiUrl);
  }
  return url.toString();
}

function buildHistoryUrl(serviceUrl, taskId) {
  return new URL(`/api/history/${encodeURIComponent(taskId)}`, serviceUrl).toString();
}

function buildTaskDebugUrl(serviceUrl, taskId, apiKey, apiUrl) {
  const url = new URL(`/api/task-debug/${encodeURIComponent(taskId)}`, serviceUrl);
  url.searchParams.set('apiKey', apiKey);
  if (apiUrl) {
    url.searchParams.set('apiUrl', apiUrl);
  }
  return url.toString();
}

function extractTaskId(payload) {
  return payload?.task_id || payload?.taskId || payload?.id || payload?.data?.task_id || null;
}

function extractTaskPayload(payload) {
  return payload?.data || payload || {};
}

function extractRemoteUrl(taskPayload, rootPayload) {
  return (
    taskPayload?.result_url ||
    taskPayload?.video_url ||
    taskPayload?.output?.video_url ||
    taskPayload?.results?.[0]?.url ||
    rootPayload?.result_url ||
    rootPayload?.video_url ||
    rootPayload?.output?.video_url ||
    rootPayload?.results?.[0]?.url ||
    null
  );
}

function resolveDownloadUrl(serviceUrl, candidate) {
  if (!candidate) return null;
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return new URL(candidate, serviceUrl).toString();
}

async function saveProjectCopy(config, result) {
  if (config.skipProjectDownload) {
    return null;
  }

  const sourceUrl =
    resolveDownloadUrl(config.serviceUrl, result.localUrl) ||
    resolveDownloadUrl(config.serviceUrl, result.remoteUrl);
  if (!sourceUrl) {
    return null;
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download local project copy. HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const extension = guessFileExtension(sourceUrl, contentType);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const modelPart = sanitizeFilenamePart(
    result.historyRecord?.model || config.model || 'sofunny',
    'sofunny'
  );
  const taskPart = sanitizeFilenamePart(result.taskId, 'task');
  const fileName = `${timestamp}_${modelPart}_${taskPart}${extension}`;
  const targetDir = path.resolve(process.cwd(), config.downloadDir);
  const absPath = path.join(targetDir, fileName);
  const buffer = Buffer.from(await response.arrayBuffer());

  await fs.promises.mkdir(targetDir, { recursive: true });
  await fs.promises.writeFile(absPath, buffer);

  return absPath;
}

async function fetchHistoryRecord(serviceUrl, taskId) {
  try {
    return await requestJson(buildHistoryUrl(serviceUrl, taskId));
  } catch (error) {
    if (error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function waitForHistoryRecord(serviceUrl, taskId, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const record = await fetchHistoryRecord(serviceUrl, taskId);
    if (record?.localUrl) {
      return record;
    }
    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }
  return null;
}

async function createTask(config) {
  const payload = {
    apiKey: config.apiKey,
    prompt: config.prompt,
    duration: config.duration,
    aspectRatio: config.aspectRatio,
    resolution: config.resolution
  };

  if (config.apiUrl) payload.apiUrl = config.apiUrl;
  if (config.model) payload.model = config.model;
  if (config.imageUrl) payload.imageUrl = config.imageUrl;
  if (config.videoUrl) payload.videoUrl = config.videoUrl;

  return requestJson(new URL('/api/generate', config.serviceUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

async function fetchTask(config, taskId) {
  return requestJson(buildTaskUrl(config.serviceUrl, taskId, config.apiKey, config.apiUrl));
}

async function fetchTaskDebug(config, taskId) {
  try {
    return await requestJson(buildTaskDebugUrl(config.serviceUrl, taskId, config.apiKey, config.apiUrl));
  } catch (error) {
    return {
      error: error.message,
      status: error.status || null,
      body: error.body || null
    };
  }
}

function buildResult(taskId, status, taskPayload, rootPayload, historyRecord) {
  const localUrl = taskPayload?.local_result_url || historyRecord?.localUrl || null;
  const ftpUrl = taskPayload?.ftp_result_url || historyRecord?.ftpUrl || null;
  const ftpPath = taskPayload?.ftp_result_path || historyRecord?.ftpPath || null;
  const remoteUrl = extractRemoteUrl(taskPayload, rootPayload);

  return {
    taskId,
    status,
    downloadUrl: localUrl || remoteUrl || null,
    localUrl,
    ftpUrl,
    ftpPath,
    remoteUrl,
    historyRecord: historyRecord || null,
    projectFile: null,
    projectDownloadError: null
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const envFileExists = fs.existsSync(SOFUNNY_ENV_PATH);
  const fileEnv = parseEnvFile(SOFUNNY_ENV_PATH);
  // 进程环境变量优先于 env 文件，命令行参数再覆盖两者。
  const env = (key) => firstNonEmpty(process.env[key], fileEnv[key]);

  const rawConfig = await promptForMissingFields({
    apiKey: firstNonEmpty(args['api-key'], env('SOFUNNY_API_KEY')),
    prompt: firstNonEmpty(args.prompt, env('SOFUNNY_PROMPT')),
    serviceUrl: firstNonEmpty(
      args['service-url'],
      env('SOFUNNY_SERVICE_URL'),
      DEFAULT_SERVICE_URL
    ),
    apiUrl: firstNonEmpty(args['api-url'], env('SOFUNNY_API_URL')),
    model: firstNonEmpty(args.model, env('SOFUNNY_MODEL')),
    duration: firstNonEmpty(args.duration, env('SOFUNNY_DURATION')),
    aspectRatio: firstNonEmpty(args['aspect-ratio'], env('SOFUNNY_ASPECT_RATIO')),
    resolution: firstNonEmpty(args.resolution, env('SOFUNNY_RESOLUTION')),
    imageUrl: firstNonEmpty(args['image-url'], env('SOFUNNY_IMAGE_URL')),
    videoUrl: firstNonEmpty(args['video-url'], env('SOFUNNY_VIDEO_URL')),
    downloadDir: firstNonEmpty(
      args['download-dir'],
      env('SOFUNNY_DOWNLOAD_DIR'),
      DEFAULT_DOWNLOAD_DIR
    ),
    skipProjectDownload: Boolean(args['skip-project-download']) ||
      parseBooleanEnv(env('SOFUNNY_SKIP_PROJECT_DOWNLOAD')),
    timeoutSeconds: firstNonEmpty(
      args['timeout-seconds'],
      env('SOFUNNY_TIMEOUT_SECONDS')
    ),
    pollIntervalMs: firstNonEmpty(
      args['poll-interval-ms'],
      env('SOFUNNY_POLL_INTERVAL_MS')
    )
  });

  const config = {
    apiKey: rawConfig.apiKey,
    prompt: rawConfig.prompt,
    serviceUrl: rawConfig.serviceUrl,
    apiUrl: rawConfig.apiUrl,
    model: rawConfig.model,
    duration: toPositiveNumber(rawConfig.duration, DEFAULT_DURATION, 'duration'),
    aspectRatio: rawConfig.aspectRatio || DEFAULT_ASPECT_RATIO,
    resolution: rawConfig.resolution || DEFAULT_RESOLUTION,
    imageUrl: rawConfig.imageUrl,
    videoUrl: rawConfig.videoUrl,
    downloadDir: rawConfig.downloadDir,
    skipProjectDownload: Boolean(rawConfig.skipProjectDownload),
    timeoutSeconds: toPositiveNumber(
      rawConfig.timeoutSeconds,
      DEFAULT_TIMEOUT_SECONDS,
      'timeout-seconds'
    ),
    pollIntervalMs: toPositiveNumber(
      rawConfig.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      'poll-interval-ms'
    )
  };

  if (!config.apiKey) {
    if (!envFileExists) {
      console.error(
        [
          `未检测到 ${SOFUNNY_ENV_PATH}，也未通过环境变量或 --api-key 提供 API Key。`,
          '可先创建该文件并写入：',
          'SOFUNNY_API_KEY=你的 New-API 用户令牌',
          'SOFUNNY_API_URL=https://your-newapi-host',
          'SOFUNNY_MODEL=ep-xxxxxxxx'
        ].join('\n')
      );
    }
    throw new Error(
      'Missing api key. Pass --api-key, set SOFUNNY_API_KEY, or run in an interactive terminal.'
    );
  }

  if (!config.prompt) {
    throw new Error(
      'Missing prompt. Pass --prompt, set SOFUNNY_PROMPT, or run in an interactive terminal.'
    );
  }

  const submitted = await createTask(config);
  const taskId = extractTaskId(submitted);
  if (!taskId) {
    throw new Error('No task id returned from /api/generate');
  }

  const deadline = Date.now() + config.timeoutSeconds * 1000;
  let lastPayload = null;
  let lastTaskPayload = null;
  let lastStatus = '';

  while (Date.now() <= deadline) {
    await sleep(config.pollIntervalMs);
    const payload = await fetchTask(config, taskId);
    const taskPayload = extractTaskPayload(payload);
    const status = normalizeStatus(taskPayload.status || payload?.status || payload?.state);

    lastPayload = payload;
    lastTaskPayload = taskPayload;
    lastStatus = status;

    if (ACTIVE_STATES.has(status)) {
      continue;
    }

    if (SUCCESS_STATES.has(status)) {
      const historyRecord = await waitForHistoryRecord(config.serviceUrl, taskId, 5, 1500);
      const result = buildResult(taskId, status, taskPayload, payload, historyRecord);
      try {
        result.projectFile = await saveProjectCopy(config, result);
      } catch (error) {
        result.projectDownloadError = error.message;
      }
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const historyRecord = await fetchHistoryRecord(config.serviceUrl, taskId);
    const error = new Error(`Task ${taskId} finished with status ${status || 'UNKNOWN'}`);
    error.taskId = taskId;
    error.statusText = status || 'UNKNOWN';
    error.historyRecord = historyRecord;
    error.payload = payload;
    throw error;
  }

  const historyRecord = await fetchHistoryRecord(config.serviceUrl, taskId);
  if (historyRecord?.localUrl) {
    const result = buildResult(taskId, lastStatus || 'TIMEOUT_RECOVERED', lastTaskPayload || {}, lastPayload || {}, historyRecord);
    try {
      result.projectFile = await saveProjectCopy(config, result);
    } catch (error) {
      result.projectDownloadError = error.message;
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const debugPayload = await fetchTaskDebug(config, taskId);
  const timeoutError = new Error(`Timed out waiting for task ${taskId}`);
  timeoutError.taskId = taskId;
  timeoutError.statusText = lastStatus || 'TIMEOUT';
  timeoutError.historyRecord = historyRecord;
  timeoutError.debugPayload = debugPayload;
  timeoutError.payload = lastPayload;
  throw timeoutError;
}

run().catch((error) => {
  const details = {
    error: error.message,
    taskId: error.taskId || null,
    status: error.statusText || null,
    historyRecord: error.historyRecord || null,
    debug: error.debugPayload || null,
    payload: error.payload || error.body || null
  };
  console.error(JSON.stringify(details, null, 2));
  process.exit(1);
});
