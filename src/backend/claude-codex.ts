#!/usr/bin/env node

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { readConfig } from "./cli/config.js";
import { createServeContext } from "./cli/serve.js";

const appHome = process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");
const quietProxyLogger = {
  info() {},
  warn() {},
  error() {},
};

async function checkProxyHealth(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const config = readConfig(path.join(appHome, "config.json"));
  const proxyAlive = await checkProxyHealth(config.port);

  let serveCtx: ReturnType<typeof createServeContext> | null = null;

  if (!proxyAlive) {
    // The embedded proxy shares the terminal with Claude's TUI. Keep routine
    // transport logs silent here; fatal startup errors are reported below.
    serveCtx = createServeContext({ config, appHome, logger: quietProxyLogger });
    try {
      await serveCtx.start();
    } catch (err: unknown) {
      console.error("Failed to start HijackClaw proxy:", err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  const env = {
    ...process.env,
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${config.port}`,
    ANTHROPIC_AUTH_TOKEN: "hijackclaw",
    ANTHROPIC_MODEL: config.model,
    ANTHROPIC_SMALL_FAST_MODEL: config.smallFastModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: config.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: config.model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: config.smallFastModel,
    CLAUDE_CODE_SUBAGENT_MODEL: config.smallFastModel,
  };

  const claudeProcess = spawn("claude", process.argv.slice(2), {
    stdio: "inherit",
    env,
  });

  // Ignore signals so that the child process can handle them (e.g. Ctrl-C in terminal)
  process.on("SIGINT", () => { /* ignore */ });
  process.on("SIGTERM", () => { /* ignore */ });

  claudeProcess.on("close", async (code) => {
    if (serveCtx) {
      await serveCtx.stop();
    }
    process.exit(code ?? 0);
  });

  claudeProcess.on("error", async (err) => {
    console.error("Failed to start claude:", err.message);
    if (serveCtx) {
      await serveCtx.stop();
    }
    process.exit(1);
  });
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
