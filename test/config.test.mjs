import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
