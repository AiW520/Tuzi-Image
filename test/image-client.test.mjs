import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertPublicDownloadUrl, generateImage, validateGenerateInput } from "../plugins/tuzi-image/server/image-client.mjs";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const safeLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("校验输入、UTF-8 字节限制和未知字段", () => {
  assert.equal(validateGenerateInput({ prompt: "test", size: "1024x1024" }).size, "1024x1024");
  assert.throws(() => validateGenerateInput({ prompt: "test", size: "1000x1000" }), /尺寸约束/);
  assert.throws(() => validateGenerateInput({ prompt: "好".repeat(22_000) }), /UTF-8/);
  assert.throws(() => validateGenerateInput({ prompt: "test", n: 2 }), /不支持的字段/);
});

test("coding 通道固定端点、模型和单次 POST", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-image-"));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "POST") return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/image.png" }] }), { status: 200 });
    return new Response(PNG, { status: 200, headers: { "content-type": "image/png", "content-length": String(PNG.length) } });
  };
  try {
    const result = await generateImage({ prompt: "hello", output_dir: root, filename: "demo" }, config("coding"), { fetchImpl, lookup: safeLookup });
    assert.equal(calls.filter((call) => call.init.method === "POST").length, 1);
    assert.equal(calls[0].url, "https://api.tu-zi.com/coding/images/generations");
    assert.equal(JSON.parse(calls[0].init.body).model, "gpt-image-2");
    assert.equal(calls[0].init.headers.Authorization, "Bearer test-key");
    assert.deepEqual(await readFile(result.path), PNG);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("生成 POST 遇到 503 不重试", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 503 }); };
  await assert.rejects(generateImage({ prompt: "hello" }, config("api"), { fetchImpl }), /Tuzi API 503/);
  assert.equal(calls, 1);
});

test("API 通道支持 b64_json 且清理危险文件名", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-image-"));
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 });
  try {
    const result = await generateImage({ prompt: "hello", output_dir: root, filename: "../escape.png" }, config("api"), { fetchImpl });
    assert.equal(path.dirname(result.path), root);
    assert.deepEqual(await readFile(result.path), PNG);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("拒绝覆盖已有文件且不残留 part 文件", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-image-"));
  await writeFile(path.join(root, "demo.png"), "original");
  const fetchImpl = async () => new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 });
  try {
    await assert.rejects(generateImage({ prompt: "hello", output_dir: root, filename: "demo" }, config("api"), { fetchImpl }), /拒绝覆盖/);
    assert.equal(await readFile(path.join(root, "demo.png"), "utf8"), "original");
    assert.deepEqual(await readdir(root), ["demo.png"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("拒绝私网、环回和非 HTTPS 下载地址", async () => {
  await assert.rejects(assertPublicDownloadUrl("http://example.com/a.png", safeLookup), /HTTPS/);
  await assert.rejects(assertPublicDownloadUrl("https://127.0.0.1/a.png"), /内网/);
  await assert.rejects(assertPublicDownloadUrl("https://metadata.test/a.png", async () => [{ address: "169.254.169.254", family: 4 }]), /内网/);
});

test("拒绝 MIME 伪装和错误图片魔数", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-image-"));
  let downloadCount = 0;
  const fetchImpl = async (_url, init) => {
    if (init.method === "POST") return new Response(JSON.stringify({ data: [{ url: "https://cdn.example/image.png" }] }), { status: 200 });
    downloadCount += 1;
    return new Response("<html>bad</html>", { status: 200, headers: { "content-type": "image/png" } });
  };
  try {
    await assert.rejects(generateImage({ prompt: "hello", output_dir: root }, config("api"), { fetchImpl, lookup: safeLookup }), /不是有效/);
    assert.equal(downloadCount, 1);
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("供应商错误不会泄漏 API Key", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "bad test-key credential" } }), { status: 401 });
  await assert.rejects(generateImage({ prompt: "private prompt" }, config("api"), { fetchImpl }), (error) => {
    assert.equal(error.message.includes("test-key"), false);
    assert.equal(error.message.includes("private prompt"), false);
    return true;
  });
});

function config(channel) {
  return {
    channel,
    apiKey: "test-key",
    baseUrl: channel === "coding" ? "https://api.tu-zi.com/coding" : "https://api.tu-zi.com/v1",
    timeoutMs: 1_000,
    maxBytes: 1_024,
  };
}
