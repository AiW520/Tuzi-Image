import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, saveConfig } from "../plugins/tuzi-image/server/config.mjs";

test("配置只保存通道，不落盘密钥", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-config-"));
  const env = { TUZI_IMAGE_CONFIG_DIR: root, TUZI_API_KEY: "secret-value", TUZI_IMAGE_DISABLE_DPAPI: "1" };
  try {
    const saved = await saveConfig({ channel: "api" }, env);
    assert.equal(saved.apiKey, "secret-value");
    const raw = await readFile(path.join(root, "config.json"), "utf8");
    assert.equal(raw.includes("secret-value"), false);
    assert.equal((await loadConfig(env)).baseUrl, "https://api.tu-zi.com/v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("存在 Codex OPENAI_API_KEY 时默认选择 coding 通道", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-config-"));
  try {
    await writeFile(path.join(root, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "codex-plan-key" }), "utf8");
    const config = await loadConfig({ CODEX_HOME: root, TUZI_IMAGE_CONFIG_DIR: root, TUZI_IMAGE_DISABLE_DPAPI: "1" });
    assert.equal(config.channel, "coding");
    assert.equal(config.apiKey, "codex-plan-key");
    assert.equal(config.baseUrl, "https://api.tu-zi.com/coding");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("显式 api 通道不会复用 Codex 套餐 Key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-config-"));
  try {
    await writeFile(path.join(root, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "codex-plan-key" }), "utf8");
    const config = await loadConfig({ CODEX_HOME: root, TUZI_IMAGE_CONFIG_DIR: root, TUZI_IMAGE_CHANNEL: "api", TUZI_IMAGE_DISABLE_DPAPI: "1" });
    assert.equal(config.channel, "api");
    assert.equal(config.apiKey, null);
    assert.equal(config.baseUrl, "https://api.tu-zi.com/v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OAuth 会话令牌不会作为 Tuzi API Key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-config-"));
  try {
    await writeFile(path.join(root, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", OPENAI_API_KEY: "session-token" }), "utf8");
    const config = await loadConfig({ CODEX_HOME: root, TUZI_IMAGE_CONFIG_DIR: root, TUZI_IMAGE_DISABLE_DPAPI: "1" });
    assert.equal(config.channel, null);
    assert.equal(config.apiKey, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("当前进程 OPENAI_API_KEY 优先于 auth.json", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tuzi-config-"));
  try {
    await writeFile(path.join(root, "auth.json"), JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "stored-key" }), "utf8");
    const config = await loadConfig({ CODEX_HOME: root, TUZI_IMAGE_CONFIG_DIR: root, OPENAI_API_KEY: "current-key", TUZI_IMAGE_DISABLE_DPAPI: "1" });
    assert.equal(config.channel, "coding");
    assert.equal(config.apiKey, "current-key");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
