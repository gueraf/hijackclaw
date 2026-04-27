import os from "node:os";
import path from "node:path";
import { readConfig } from "./config.js";
import { readOpenAICodexProfile } from "../upstream/openai-codex-profile.js";
import { isTokenExpired } from "../auth/token-store.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type StatusDeps = {
  appHome?: string;
  logger?: Logger;
};

export async function runStatus(deps: StatusDeps = {}): Promise<void> {
  const logger: Logger = deps.logger ?? console;
  const appHome = deps.appHome ?? process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");
  const config = readConfig(path.join(appHome, "config.json"));

  // Proxy health
  let proxyAlive = false;
  try {
    const res = await fetch(`http://127.0.0.1:${config.port}/health`, { signal: AbortSignal.timeout(2000) });
    proxyAlive = res.ok;
  } catch {}

  // Auth state
  const tokens = readOpenAICodexProfile(path.join(appHome, "auth.json"));
  let authStatus = "not authenticated";
  if (tokens) {
    if (isTokenExpired(tokens, new Date())) {
      authStatus = tokens.refreshToken ? "expired (will auto-refresh)" : "expired (re-login needed)";
    } else {
      authStatus = `valid${tokens.email ? ` (${tokens.email})` : ""}`;
    }
  }

  logger.info("HijackClaw Status");
  logger.info("─────────────────────────────────");
  logger.info(`Proxy:      ${proxyAlive ? "running" : "down"} (port ${config.port})`);
  logger.info(`Auth:       ${authStatus}`);
  logger.info(`Model:      ${config.model} / ${config.smallFastModel}`);
  logger.info(`Config:     ${path.join(appHome, "config.json")}`);
}
