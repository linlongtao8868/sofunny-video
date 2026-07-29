#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const scriptPath = path.resolve(__dirname, "..", "scripts", "sofunny-video.js");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "sofunny-video-test-"));
const requests = [];

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function runCli(baseUrl, name, args) {
  return new Promise((resolve, reject) => {
    const taskIdPath = path.join(outputDir, `${name}.task-id`);
    const child = spawn(
      process.execPath,
      [scriptPath, "--base-url", baseUrl, "--api-key", "test-key", "--poll-interval-ms", "1", "--task-id-file", taskIdPath, "--output", path.join(outputDir, `${name}.mp4`), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${name} exited ${code}: ${stderr}`));
        return;
      }
      resolve({
        ...JSON.parse(stdout),
        persisted_task_id: fs.readFileSync(taskIdPath, "utf8").trim(),
      });
    });
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/v1/video/generations") {
    const body = JSON.parse(await readBody(request));
    requests.push(body);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ task_id: `task-${requests.length}` }));
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/v1/video/generations/")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "success", data: { data: { output: { video_url: "https://example.com/result.mp4" } } } }));
    return;
  }

  if (request.method === "GET" && request.url.startsWith("/v1/videos/")) {
    response.writeHead(200, { "Content-Type": "video/mp4" });
    response.end(Buffer.from("mock-video"));
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const fast = await runCli(baseUrl, "fast", ["--model", "doubao-seed-2-0-fast", "--prompt", "fast test"]);
    const mini = await runCli(baseUrl, "mini", ["--model", "doubao-seed-2-0-mini", "--prompt", "mini test", "--ratio", "9:16"]);
    const edit = await runCli(baseUrl, "edit", [
      "--model", "happyhorse-1.0-video-edit",
      "--prompt", "edit test",
      "--video-url", "https://example.com/source.mp4",
      "--image-url", "https://example.com/reference.png",
    ]);

    assert.equal(requests.length, 3);
    assert.equal(requests[0].model, "doubao-seed-2-0-fast");
    assert.equal(requests[0].seconds, "5");
    assert.equal(requests[0].metadata.resolution, "720p");
    assert.equal(requests[1].model, "doubao-seed-2-0-mini");
    assert.equal(requests[1].metadata.ratio, "9:16");
    assert.deepEqual(requests[2], {
      model: "happyhorse-1.0-video-edit",
      prompt: "edit test",
      size: "1080P",
      media: [
        { type: "video", url: "https://example.com/source.mp4" },
        { type: "reference_image", url: "https://example.com/reference.png" },
      ],
    });
    assert.equal(fast.video_url, "https://example.com/result.mp4");
    assert.equal(fast.persisted_task_id, "task-1");
    assert.equal(mini.model, "doubao-seed-2-0-mini");
    assert.equal(mini.persisted_task_id, "task-2");
    assert.equal(edit.model, "happyhorse-1.0-video-edit");
    assert.equal(edit.persisted_task_id, "task-3");
    assert.equal(fs.readFileSync(edit.saved_path, "utf8"), "mock-video");
    console.log("mock integration tests passed: fast, mini, happyhorse video-edit");
  } finally {
    server.close();
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
