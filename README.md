# HijackClaw

Experimental Project. Use it at your own risk.

Run Claude Code using your ChatGPT/Codex subscription as the backend — no Anthropic API key or Claude session limits required.

## Why

We love Claude Code, but sometimes, we can't use it.

- **Session limits** — You've burned through your Claude Pro/Team allocation, and it's only Tuesday
- **No API budget** — Anthropic API credits or subscription aren't cheap, and your org won't approve them
- **Workplace restrictions** — Corporate firewalls or network policies block `api.anthropic.com`
- **Regional availability** — Claude API isn't available in your region, but ChatGPT is
- **Billing separation** — You already pay for ChatGPT Plus/Team and don't want a second AI subscription

HijackClaw solves this by routing Claude Code's API requests through your existing OpenAI Codex subscription session. You get the full Claude Code experience — interactive terminal, agentic workflows, file editing — powered by your ChatGPT account at no extra cost.

## How It Works

1. **Sign in** with your ChatGPT account (standard OAuth, no passwords stored)
2. **HijackClaw** spins up a local Anthropic-compatible proxy on `127.0.0.1`
3. **Claude Code** launches in a managed terminal with `ANTHROPIC_BASE_URL` pointed at the local proxy
4. **Requests** are translated from Claude's Messages API format to the Codex subscription wire protocol and sent over WebSocket (with SSE fallback)

Your auth tokens are stored locally in `~/.hijackclaw/auth.json` and refresh automatically — no browser needed after the initial login.

## Install

```bash
npm install
```

## Quick Start

```bash
npm run build
npm start
```

Then open `http://localhost:8080`, sign in with ChatGPT, and start the runtime.

For development with hot reload:

```bash
npm run dev
```

## Architecture

```
Claude Code (PTY)
    |
    | ANTHROPIC_BASE_URL=http://127.0.0.1:8082
    v
Local Proxy (POST /v1/messages)
    |
    | Translate Claude Messages API -> Codex wire protocol
    v
chatgpt.com/backend-api/codex/responses (WebSocket / SSE)
    |
    | Your ChatGPT subscription session
    v
OpenAI Codex Backend
```

**Key properties:**
- No shell profile edits, no OS proxy changes, no Claude config modifications
- `ANTHROPIC_*` env vars are injected only into the managed Claude child process
- Auth tokens are stored locally and refresh automatically
- WebSocket transport with automatic SSE fallback

## Test

```bash
npm test
npm run check
```

## Current Limitations

- Tool calling is not yet implemented (text-only responses)
- Unsupported Anthropic features fail explicitly rather than degrading silently

## Disclaimer

HijackClaw is an independent open-source project. It is **not** affiliated with, endorsed by, or sponsored by Anthropic or OpenAI. Use of this software may be subject to the terms of service of third-party platforms it interacts with. You are solely responsible for ensuring your usage complies with all applicable terms and policies.

This software is provided "as is", without warranty of any kind. See the [MIT License](LICENSE) for details.

## License

[MIT](LICENSE)
