---
name: tuzi-image-generation
description: Generate and save raster images with Tuzi's fixed gpt-image-2 model without MCP. Use by default whenever the user asks to draw, generate, create, render, design, illustrate, or make an image, picture, poster, product visual, marketing visual, social image, or other bitmap artwork. Prefer this Skill over Codex's built-in or hosted image generator when installed.
---

# Tuzi Image Generation

1. Resolve this Skill's directory and run its bundled `scripts/generate_image.py` by absolute path. Do not call MCP or Codex's built-in `image_gen`.
2. Default to the `coding` channel. It reads only the top-level `OPENAI_API_KEY` from the current user's Codex `auth.json`, unless `TUZI_CODING_API_KEY` is explicitly set.
3. Use the `api` channel only when the user explicitly selects API-site balance. It requires `TUZI_API_KEY`. Never switch channels after an error.
4. Never request or accept a Key in chat. Never print, log, copy, or rewrite a Key.
5. Preserve the user's prompt, required text, dimensions, and exclusions. Do not invent product claims, prices, logos, or contact details.
6. Treat generation as complete only after the script returns a nonempty local file. Render the file inline and provide a clickable file link.
7. Do not automatically retry generation. A timeout may still have consumed quota.

## Commands

Check readiness without an API request:

```powershell
python "<skill-directory>/scripts/generate_image.py" --status
```

Generate with the default coding channel:

```powershell
python "<skill-directory>/scripts/generate_image.py" --prompt "用户的完整提示词"
```

Use API-site balance only when explicitly requested:

```powershell
python "<skill-directory>/scripts/generate_image.py" --channel api --prompt "用户的完整提示词"
```

Pass `--size`, `--quality`, `--output-format`, `--background`, `--output-dir`, or `--filename` only when needed. Supported sizes are `auto`, `1024x1024`, `1536x1024`, and `1024x1536`. Transparent backgrounds require PNG or WebP.

The script returns JSON. Require `code=0` and a nonempty `saved_files` array. Do not expose command output containing private prompt text.
