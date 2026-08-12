import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import test from "node:test";

test("MCP stdio 使用 NDJSON 并提供三个工具", async (context) => {
  const child = spawn(process.execPath, ["plugins/tuzi-image/server/index.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, TUZI_IMAGE_DISABLE_DPAPI: "1", TUZI_IMAGE_CONFIG_DIR: `${process.env.TEMP}\\tuzi-mcp-nonexistent-${process.pid}` },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  context.after(() => child.kill());
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const responses = new Map();
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    responses.get(message.id)?.(message);
  });
  const call = (id, method, params) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`MCP ${method} 响应超时`)), 3_000);
    responses.set(id, (message) => { clearTimeout(timeout); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
  });

  const initialized = await call(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(initialized.result.serverInfo.name, "tuzi-image");
  const listed = await call(2, "tools/list");
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["tuzi_image_status", "tuzi_image_configure", "tuzi_generate_image"]);
  const status = await call(3, "tools/call", { name: "tuzi_image_status", arguments: {} });
  assert.equal(JSON.parse(status.result.content[0].text).configured, false);
});
