#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline";
import { loadConfig, saveConfig, CHANNELS } from "./config.mjs";
import { generateImage } from "./image-client.mjs";

const protocolVersion = "2025-03-26";
let runtimeConfig = await loadConfig();
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  if (Buffer.byteLength(line, "utf8") > 1024 * 1024) return;
  let message;
  try { message = JSON.parse(line); } catch { return; }
  void handle(message).catch(() => {});
});

async function handle(message) {
  if (!Object.hasOwn(message, "id")) return;
  try {
    if (message.method === "initialize") {
      return reply(message.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "tuzi-image", version: "1.0.0" },
      });
    }
    if (message.method === "ping") return reply(message.id, {});
    if (message.method === "tools/list") return reply(message.id, { tools: toolDefinitions });
    if (message.method === "tools/call") return reply(message.id, await callTool(message.params?.name, message.params?.arguments || {}));
    return errorReply(message.id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    return reply(message.id, {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
  }
}

async function callTool(name, args) {
  if (name === "tuzi_image_status") {
    const config = runtimeConfig;
    const envKey = config.channel ? CHANNELS[config.channel].envKey : null;
    return textResult(JSON.stringify({
      configured: Boolean(config.channel),
      ready: Boolean(config.channel && config.apiKey),
      channel: config.channel,
      base_url: config.baseUrl,
      credential_env: envKey,
      credential_present: Boolean(config.apiKey),
      output_dir: config.outputDir,
    }, null, 2));
  }
  if (name === "tuzi_image_configure") {
    const config = await saveConfig({ channel: args.channel, outputDir: args.output_dir });
    runtimeConfig = config;
    const envKey = CHANNELS[config.channel].envKey;
    return textResult(`已选择 ${config.channel} 通道。${config.apiKey ? "凭据已就绪。" : `尚未找到凭据。Windows 请运行 Plugin 的 scripts/configure-windows.ps1；其他系统请设置 ${envKey}，然后重启 Codex。`}`);
  }
  if (name === "tuzi_generate_image") {
    const result = await generateImage(args, runtimeConfig);
    return {
      content: [
        { type: "text", text: `图片已生成\n路径: ${result.path}\n通道: ${result.channel}\n模型: ${result.model}\n尺寸: ${result.size}\n质量: ${result.quality}` },
        { type: "resource_link", uri: pathToFileUri(result.path), name: result.path.split(/[\\/]/).pop(), mimeType: mimeFromPath(result.path), description: "Generated image" },
      ],
      structuredContent: result,
    };
  }
  throw new Error(`未知工具: ${name}`);
}

const toolDefinitions = [
  {
    name: "tuzi_image_status",
    description: "Check the configured Tuzi billing channel and whether its credential is available. Never exposes the credential.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} },
  },
  {
    name: "tuzi_image_configure",
    description: "Select the Tuzi account product. Use coding for a Codex subscription plan and api for API-site balance. This does not accept or store secret keys.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["channel"],
      properties: {
        channel: { type: "string", enum: ["coding", "api"] },
        output_dir: { type: "string", description: "Optional default output directory." },
      },
    },
  },
  {
    name: "tuzi_generate_image",
    description: "Generate one raster image using gpt-image-2 through the configured Tuzi channel and save it locally.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: {
        prompt: { type: "string", maxLength: 32000 },
        size: { type: "string", default: "1024x1024" },
        quality: { type: "string", enum: ["low", "medium", "high", "auto"], default: "medium" },
        output_format: { type: "string", enum: ["png", "jpeg", "webp"], default: "png" },
        output_dir: { type: "string" },
        filename: { type: "string" },
      },
    },
  },
];

function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function errorReply(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
function textResult(text) { return { content: [{ type: "text", text }] }; }
function pathToFileUri(value) { return new URL(`file:///${value.replace(/\\/g, "/")}`).href; }
function mimeFromPath(value) { return value.endsWith(".jpg") || value.endsWith(".jpeg") ? "image/jpeg" : value.endsWith(".webp") ? "image/webp" : "image/png"; }
