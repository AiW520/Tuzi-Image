import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

export const CHANNELS = Object.freeze({
  coding: {
    baseUrl: "https://api.tu-zi.com/coding",
    envKey: "TUZI_CODING_API_KEY",
  },
  api: {
    baseUrl: "https://api.tu-zi.com/v1",
    envKey: "TUZI_API_KEY",
  },
});

export function configPath(env = process.env) {
  const root = env.TUZI_IMAGE_CONFIG_DIR || path.join(os.homedir(), ".tuzi-image");
  return path.join(root, "config.json");
}

export async function loadConfig(env = process.env) {
  let stored = {};
  try {
    stored = JSON.parse(await readFile(configPath(env), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error("Tuzi Image 配置文件无效");
  }

  const channel = env.TUZI_IMAGE_CHANNEL || stored.channel || null;
  if (channel && !CHANNELS[channel]) throw new Error(`未知通道: ${channel}`);
  const apiKey = channel ? env[CHANNELS[channel].envKey] || await loadWindowsCredential(channel, env) : null;
  return {
    channel,
    apiKey,
    baseUrl: channel ? CHANNELS[channel].baseUrl : null,
    outputDir: env.TUZI_IMAGE_OUTPUT_DIR || stored.outputDir || null,
    timeoutMs: parseInteger(env.TUZI_IMAGE_TIMEOUT_MS, 180_000, 10_000, 600_000),
    maxBytes: parseInteger(env.TUZI_IMAGE_MAX_BYTES, 50 * 1024 * 1024, 1024, 100 * 1024 * 1024),
  };
}

export async function saveConfig(update, env = process.env) {
  const current = await loadConfig(env);
  const channel = update.channel || current.channel;
  if (!CHANNELS[channel]) throw new Error("channel 必须是 coding 或 api");
  const outputDir = update.outputDir || current.outputDir || null;
  const target = configPath(env);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ channel, outputDir }, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, target);
  return loadConfig(env);
}

export function credentialPath(channel, env = process.env) {
  if (!CHANNELS[channel]) throw new Error("channel 必须是 coding 或 api");
  return path.join(path.dirname(configPath(env)), `credential-${channel}.dpapi`);
}

async function loadWindowsCredential(channel, env) {
  if (process.platform !== "win32" || env.TUZI_IMAGE_DISABLE_DPAPI === "1") return null;
  try { await stat(credentialPath(channel, env)); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("无法访问 Windows 加密凭据");
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    "$raw=[IO.File]::ReadAllText($args[0]).Trim()",
    "$secure=ConvertTo-SecureString $raw",
    "$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try {[Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr))} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}",
  ].join(";");
  try {
    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script, credentialPath(channel, env)], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 64 * 1024,
    });
    return stdout || null;
  } catch { throw new Error("无法读取 Windows 加密凭据"); }
}

function parseInteger(value, fallback, min, max) {
  if (value == null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
