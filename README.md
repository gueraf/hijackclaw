# HijackClaw

Experimental Project. Use it at your own risk.

Run Claude Code using your ChatGPT/Codex subscription as the backend — no Anthropic API key or Claude session limits required.

<img width="719" height="263" alt="656857892_17954945292102905_8477525572146901740_n" src="https://github.com/user-attachments/assets/4a3af5d4-de3f-4b35-b7af-16f3e3c3ec85" />

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

## Quick Start

```bash
npm i hijackclaw -g

# Authenticate with your ChatGPT account
hijackclaw login

# Install daemon + shell hook (adds env vars to new shells when proxy is alive)
hijackclaw install
# Run the proxy that reroutes Anthropic calls to OpenAI
hijackclaw serve

# Open a new terminal — Claude Code now routes through OpenAI
claude
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `hijackclaw login` | Browser-based OAuth PKCE login with your ChatGPT account |
| `hijackclaw install` | Install launchd daemon + shell hook in `.zshrc`/`.bashrc` |
| `hijackclaw uninstall` | Remove daemon, shell hook, and env files |
| `hijackclaw uninstall --purge` | Also remove auth tokens and config |
| `hijackclaw serve` | Run the proxy in the foreground (used by launchd) |
| `hijackclaw status` | Check proxy, auth, and install state |

### Configuration

Config lives at `~/.hijackclaw/config.json`:

```json
{
  "port": 8082,
  "model": "gpt-5.4",
  "smallFastModel": "gpt-5.4-mini",
  "modelMap": {
    "claude-sonnet-4-6": "gpt-5.4",
    "claude-haiku-4-5-20251001": "gpt-5.4-mini",
    "claude-opus": "gpt-5.4"
  }
}
```

| Key | Description |
|-----|-------------|
| `port` | Local proxy port (default `8082`) |
| `model` | Default upstream model for unmapped requests |
| `smallFastModel` | Upstream model used for lightweight/fast requests |
| `modelMap` | Maps Claude model names to upstream models. When Claude Code sends a request for a specific Claude model, the proxy looks it up here and routes to the corresponding upstream model. The original Claude model name is still used to infer reasoning effort (e.g. `opus` → high, `sonnet` → medium, `haiku` → low). |

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
- Shell hook conditionally exports `ANTHROPIC_*` env vars only when the proxy is alive (`nc -z` guard)
- When the proxy is down, Claude Code works normally against Anthropic
- Auth tokens stored locally with automatic refresh
- WebSocket transport with automatic SSE fallback and 30s timeout
- Full tool use support (function calls + results round-trip)

## Development

```bash
git clone https://github.com/yungookim/hijackclaw.git
cd hijackclaw
npm install
npm run build

npm test             # Run tests
npm run check        # TypeScript type checking
```

## Current Limitations

- Unsupported Anthropic features (e.g. image content blocks) fail explicitly rather than degrading silently

## Disclaimer

HijackClaw is an independent open-source project. It is **not** affiliated with, endorsed by, or sponsored by Anthropic or OpenAI. Use of this software may be subject to the terms of service of third-party platforms it interacts with. You are solely responsible for ensuring your usage complies with all applicable terms and policies.

This software is provided "as is", without warranty of any kind. See the [MIT License](LICENSE) for details.

## License

[MIT](LICENSE)
