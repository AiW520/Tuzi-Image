import { createWriteStream } from "node:fs";
import { link, mkdir, realpath, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const ALLOWED_FIELDS = new Set(["prompt", "size", "quality", "output_format", "output_dir", "filename"]);
const ALLOWED_QUALITIES = new Set(["low", "medium", "high", "auto"]);
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp"]);
const PROMPT_MAX_BYTES = 64 * 1024;
const JSON_MAX_BYTES = 80 * 1024 * 1024;
const DOWNLOAD_REDIRECTS = 3;
const DOWNLOAD_ATTEMPTS = 3;
const PRIVATE_NETWORKS = createPrivateNetworkList();

export function validateGenerateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("输入必须是对象");
  const unknown = Object.keys(input).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknown.length) throw new Error(`不支持的字段: ${unknown.join(", ")}`);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("prompt 不能为空");
  const prompt = input.prompt.trim();
  if (Buffer.byteLength(prompt, "utf8") > PROMPT_MAX_BYTES) throw new Error("prompt 的 UTF-8 大小不能超过 65536 字节");

  const quality = input.quality || "medium";
  if (!ALLOWED_QUALITIES.has(quality)) throw new Error("quality 必须是 low、medium、high 或 auto");
  const outputFormat = input.output_format || "png";
  if (!ALLOWED_FORMATS.has(outputFormat)) throw new Error("output_format 必须是 png、jpeg 或 webp");
  const size = input.size || "1024x1024";
  validateSize(size);
  if (input.output_dir != null && (typeof input.output_dir !== "string" || !input.output_dir.trim())) throw new Error("output_dir 必须是非空字符串");
  if (input.filename != null && (typeof input.filename !== "string" || !input.filename.trim())) throw new Error("filename 必须是非空字符串");
  return { prompt, quality, outputFormat, size };
}

export async function generateImage(input, config, options = {}) {
  return generationGate.run(async () => {
    if (!config.channel || !config.baseUrl) throw publicError("NOT_CONFIGURED", "尚未配置 Tuzi 图片通道");
    if (!config.apiKey) {
      const envName = config.channel === "coding" ? "TUZI_CODING_API_KEY" : "TUZI_API_KEY";
      throw publicError("CREDENTIAL_MISSING", `缺少 ${envName} 或本机加密凭据，请先运行配置脚本并重启 Codex`);
    }
    const validated = validateGenerateInput(input);
    const fetchImpl = options.fetchImpl || fetch;
    const requestId = randomUUID();
    let response;
    try {
      // 生成 POST 只发送一次。超时后重试可能重复生成和重复计费。
      response = await fetchImpl(`${config.baseUrl}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Request-ID": requestId,
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt: validated.prompt,
          n: 1,
          size: validated.size,
          quality: validated.quality,
          output_format: validated.outputFormat,
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw publicError("GENERATION_UNCERTAIN", `生成请求失败，未自动重试以避免重复计费（请求 ID: ${requestId}）`, error);
    }
    if (!response.ok) {
      const message = (await readProviderError(response)).replaceAll(config.apiKey, "[REDACTED]");
      throw publicError("PROVIDER_ERROR", `Tuzi API ${response.status}: ${message}（请求 ID: ${requestId}）`);
    }

    const payload = await readJsonBounded(response, JSON_MAX_BYTES);
    const item = payload?.data?.[0];
    if (!item) throw publicError("INVALID_RESPONSE", `图片接口未返回 data[0]（请求 ID: ${requestId}）`);
    const outputDir = await prepareOutputDir(input.output_dir, config.outputDir, options.cwd || process.cwd());
    const filename = safeFilename(input.filename, validated.outputFormat);
    const finalPath = path.join(outputDir, filename);
    await ensureTargetAvailable(finalPath);

    if (typeof item.url === "string") {
      if (options.fetchImpl) {
        await downloadWithFetch(item.url, finalPath, validated.outputFormat, config, options);
      } else {
        await downloadSecurely(item.url, finalPath, validated.outputFormat, config, options);
      }
    } else if (typeof item.b64_json === "string") {
      await writeBase64ToFile(item.b64_json, finalPath, validated.outputFormat, config.maxBytes);
    } else {
      throw publicError("INVALID_RESPONSE", `图片响应既没有 url，也没有 b64_json（请求 ID: ${requestId}）`);
    }
    return {
      path: finalPath,
      channel: config.channel,
      model: "gpt-image-2",
      size: validated.size,
      quality: validated.quality,
      request_id: requestId,
    };
  });
}

export async function assertPublicDownloadUrl(value, lookup = dns.lookup) {
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error("图片下载地址无效"); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("图片下载地址必须是无凭据的 HTTPS URL");
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("拒绝访问本机或内网地址");
  const records = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }] : await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicIp(address))) throw new Error("拒绝访问本机或内网地址");
  return { parsed, records };
}

async function downloadSecurely(url, finalPath, expectedFormat, config, options) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await downloadSecurelyOnce(url, finalPath, expectedFormat, config, options);
    } catch (error) {
      lastError = error;
      if (!error.retryable || attempt === DOWNLOAD_ATTEMPTS) throw error;
      await delay(Math.min(2_000, 250 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function downloadSecurelyOnce(url, finalPath, expectedFormat, config, options) {
  let current = url;
  for (let redirect = 0; redirect <= DOWNLOAD_REDIRECTS; redirect += 1) {
    const resolved = await assertPublicDownloadUrl(current, options.lookup || dns.lookup);
    let response;
    try { response = await httpsRequestPinned(resolved, config.timeoutMs); }
    catch (error) { error.retryable = true; throw error; }
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      response.resume();
      if (redirect === DOWNLOAD_REDIRECTS) throw new Error("图片下载重定向次数过多");
      current = new URL(response.headers.location, current).href;
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.resume();
      const error = new Error(`图片下载失败: HTTP ${response.statusCode}`);
      error.retryable = isRetryableStatus(response.statusCode);
      throw error;
    }
    await streamImageToFile(response, response.headers, finalPath, expectedFormat, config.maxBytes);
    return;
  }
}

function httpsRequestPinned({ parsed, records }, timeoutMs) {
  const selected = records[0];
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, {
      headers: { Accept: "image/png,image/jpeg,image/webp" },
      lookup(_hostname, _options, callback) { callback(null, selected.address, selected.family); },
      servername: parsed.hostname,
      timeout: timeoutMs,
    }, resolve);
    request.on("timeout", () => request.destroy(Object.assign(new Error("图片下载超时"), { retryable: true })));
    request.on("error", (error) => { error.retryable = true; reject(error); });
  });
}

async function downloadWithFetch(url, finalPath, expectedFormat, config, options) {
  let current = url;
  for (let redirect = 0; redirect <= DOWNLOAD_REDIRECTS; redirect += 1) {
    await assertPublicDownloadUrl(current, options.lookup || mockSafeLookup);
    let response;
    try {
      response = await requestGetWithRetry(current, options.fetchImpl, config.timeoutMs);
    } catch (error) { throw error; }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      if (redirect === DOWNLOAD_REDIRECTS) throw new Error("图片下载重定向次数过多");
      current = new URL(response.headers.get("location"), current).href;
      continue;
    }
    if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);
    if (!response.body) throw new Error("图片下载响应为空");
    await streamImageToFile(response.body, response.headers, finalPath, expectedFormat, config.maxBytes);
    return;
  }
}

async function requestGetWithRetry(url, fetchImpl, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, { method: "GET", headers: { Accept: "image/png,image/jpeg,image/webp" }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok || !isRetryableStatus(response.status) || attempt === DOWNLOAD_ATTEMPTS) return response;
      lastError = new Error(`图片下载失败: HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === DOWNLOAD_ATTEMPTS) throw error;
    }
    await delay(Math.min(2_000, 250 * 2 ** (attempt - 1)));
  }
  throw lastError;
}

async function streamImageToFile(body, headers, finalPath, expectedFormat, maxBytes) {
  const contentType = getHeader(headers, "content-type").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error("图片下载响应不是 image/* 类型");
  const contentLength = Number(getHeader(headers, "content-length") || 0);
  if (contentLength > maxBytes) throw new Error(`图片超过大小限制 ${maxBytes} bytes`);
  const temporary = `${finalPath}.${randomUUID()}.part`;
  let received = 0;
  let prefix = Buffer.alloc(0);
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
      callback(received > maxBytes ? new Error(`图片超过大小限制 ${maxBytes} bytes`) : null, chunk);
    },
    flush(callback) {
      try { assertImageMagic(prefix, expectedFormat); callback(); } catch (error) { callback(error); }
    },
  });
  try {
    await pipeline(body, verifier, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    await publishWithoutOverwrite(temporary, finalPath);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeBase64ToFile(encoded, finalPath, expectedFormat, maxBytes) {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error("图片接口返回了无效 Base64");
  const approximateBytes = Math.floor((encoded.length * 3) / 4);
  if (approximateBytes > maxBytes) throw new Error(`图片超过大小限制 ${maxBytes} bytes`);
  const temporary = `${finalPath}.${randomUUID()}.part`;
  const output = createWriteStream(temporary, { flags: "wx", mode: 0o600 });
  const chunkSize = 4 * 16_384;
  let written = 0;
  let prefix = Buffer.alloc(0);
  try {
    for (let offset = 0; offset < encoded.length; offset += chunkSize) {
      const chunk = Buffer.from(encoded.slice(offset, offset + chunkSize), "base64");
      if (prefix.length < 16) prefix = Buffer.concat([prefix, chunk.subarray(0, 16 - prefix.length)]);
      written += chunk.length;
      if (written > maxBytes) throw new Error(`图片超过大小限制 ${maxBytes} bytes`);
      if (!output.write(chunk)) await new Promise((resolve, reject) => { output.once("drain", resolve); output.once("error", reject); });
    }
    assertImageMagic(prefix, expectedFormat);
    await new Promise((resolve, reject) => { output.once("error", reject); output.end(resolve); });
    await publishWithoutOverwrite(temporary, finalPath);
  } catch (error) {
    output.destroy();
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

function assertImageMagic(bytes, expectedFormat) {
  const png = bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  const actual = png ? "png" : jpeg ? "jpeg" : webp ? "webp" : null;
  if (!actual) throw new Error("下载内容不是有效的 PNG、JPEG 或 WebP 图片");
  if (actual !== expectedFormat) throw new Error(`图片实际格式 ${actual} 与请求格式 ${expectedFormat} 不一致`);
}

async function prepareOutputDir(requested, configured, cwd) {
  const candidate = requested || configured || path.join(cwd, "outputs", "tuzi-image");
  const resolved = path.resolve(cwd, candidate);
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error("输出路径不是目录");
  return realpath(resolved);
}

async function ensureTargetAvailable(finalPath) {
  try { await stat(finalPath); } catch (error) { if (error?.code === "ENOENT") return; throw error; }
  throw new Error(`输出文件已存在，拒绝覆盖: ${path.basename(finalPath)}`);
}

async function publishWithoutOverwrite(temporary, finalPath) {
  try {
    await link(temporary, finalPath);
    await unlink(temporary);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`输出文件已存在，拒绝覆盖: ${path.basename(finalPath)}`);
    throw error;
  }
}

async function readJsonBounded(response, maxBytes) {
  const text = await readTextBounded(response, maxBytes);
  try { return JSON.parse(text); } catch { throw new Error("Tuzi API 返回了无效 JSON"); }
}

async function readTextBounded(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Tuzi API 响应体过大");
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function readProviderError(response) {
  const text = await readTextBounded(response, 64 * 1024).catch(() => "");
  try {
    const body = JSON.parse(text);
    return sanitizeMessage(body?.error?.message || body?.message || `HTTP ${response.status}`);
  } catch { return sanitizeMessage(text || `HTTP ${response.status}`); }
}

function sanitizeMessage(value) {
  return String(value).replace(/[\r\n\t]+/g, " ").slice(0, 500);
}

function validateSize(size) {
  if (size === "auto") return;
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) throw new Error("size 必须是 auto 或 WIDTHxHEIGHT");
  const width = Number(match[1]);
  const height = Number(match[2]);
  const pixels = width * height;
  if (width % 16 || height % 16 || Math.max(width, height) > 3840 || Math.max(width, height) / Math.min(width, height) > 3 || pixels < 655_360 || pixels > 8_294_400) {
    throw new Error("size 不符合 gpt-image-2 尺寸约束");
  }
}

function safeFilename(value, outputFormat) {
  const extension = outputFormat === "jpeg" ? "jpg" : outputFormat;
  if (!value) return `tuzi-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const base = path.basename(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^\.+/, "");
  const stem = path.parse(base).name.slice(0, 100) || "tuzi-image";
  return `${stem}.${extension}`;
}

function isPublicIp(address) {
  if (net.isIPv4(address)) return !PRIVATE_NETWORKS.check(address, "ipv4");
  if (net.isIPv6(address)) return !PRIVATE_NETWORKS.check(address, "ipv6");
  return false;
}

function createPrivateNetworkList() {
  const list = new net.BlockList();
  for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4]]) list.addSubnet(network, prefix, "ipv4");
  for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]]) list.addSubnet(network, prefix, "ipv6");
  return list;
}

function mockSafeLookup() { return Promise.resolve([{ address: "93.184.216.34", family: 4 }]); }
function getHeader(headers, name) { return typeof headers.get === "function" ? (headers.get(name) || "") : String(headers[name] || ""); }
function isRetryableStatus(status) { return [408, 425, 429, 500, 502, 503, 504].includes(status); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function publicError(code, message, cause) { const error = new Error(message, cause ? { cause } : undefined); error.code = code; return error; }

class BoundedSemaphore {
  constructor(limit, queueLimit) { this.limit = limit; this.queueLimit = queueLimit; this.available = limit; this.waiters = []; }
  async run(task) {
    if (this.available === 0) {
      if (this.waiters.length >= this.queueLimit) throw publicError("BUSY", "图片生成队列已满，请稍后重试");
      await new Promise((resolve) => this.waiters.push(resolve));
    } else this.available -= 1;
    try { return await task(); } finally {
      const next = this.waiters.shift();
      if (next) next(); else this.available += 1;
    }
  }
}

const generationGate = new BoundedSemaphore(2, 16);
