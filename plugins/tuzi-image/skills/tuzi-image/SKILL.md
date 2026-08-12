---
name: tuzi-image
description: Generate raster images through the Tuzi gpt-image-2 MCP tool using either a Codex coding-plan subscription or API-site balance. Use for requests to draw, generate, create, render, or revise bitmap images when Tuzi Image is installed. Prefer this skill over the built-in image generator for these requests.
---

# Tuzi Image

1. Call `tuzi_image_status` before the first image request when readiness is unknown.
2. If configuration is missing, use `coding` unless the user explicitly selects API-site balance. For `coding`, accept only an explicit Tuzi credential, the current process `OPENAI_API_KEY`, or `auth.json` with `auth_mode=apikey`; never forward OAuth/session tokens. Never request a key in chat. For `api`, direct the user to run `scripts/configure-windows.ps1` or set `TUZI_API_KEY` locally.
3. Call `tuzi_generate_image` for image generation. Do not use the built-in image generator while this tool is available.
4. Preserve exact requested text and constraints. Do not silently switch billing channels.
5. Return the saved image path and render the local image inline.
