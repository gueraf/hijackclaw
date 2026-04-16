import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DaemonConfig } from "./config.js";
import { readConfig, writeConfig } from "./config.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export const SHELL_HOOK_BEGIN_MARKER = "# >>> hijackclaw >>>";
export const SHELL_HOOK_END_MARKER = "# <<< hijackclaw <<<";
const PLIST_LABEL = "com.hijackclaw.proxy";

// ── env.sh generation ───────────────────────────────────────────

export function generateEnvSh(config: DaemonConfig): string {
  return `# HijackClaw proxy integration (auto-generated)
# Checks if the local proxy is alive before setting env vars.
# If the proxy is down, these vars are NOT set and Claude Code works normally.
if nc -z 127.0.0.1 ${config.port} 2>/dev/null; then
  export ANTHROPIC_BASE_URL="http://127.0.0.1:${config.port}"
  export ANTHROPIC_AUTH_TOKEN="hijackclaw"
  export ANTHROPIC_MODEL="${config.model}"
  export ANTHROPIC_SMALL_FAST_MODEL="${config.smallFastModel}"
  export ANTHROPIC_DEFAULT_OPUS_MODEL="${config.model}"
  export ANTHROPIC_DEFAULT_SONNET_MODEL="${config.model}"
  export ANTHROPIC_DEFAULT_HAIKU_MODEL="${config.smallFastModel}"
  export CLAUDE_CODE_SUBAGENT_MODEL="${config.smallFastModel}"
fi
`;
}

// ── launchd plist generation ────────────────────────────────────

export function generatePlist(paths: {
  nodePath: string;
  scriptPath: string;
  appHome: string;
}): string {
  const logDir = path.join(paths.appHome, "logs");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${paths.nodePath}</string>
    <string>${paths.scriptPath}</string>
    <string>serve</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>

  <key>StandardOutPath</key>
  <string>${path.join(logDir, "stdout.log")}</string>

  <key>StandardErrorPath</key>
  <string>${path.join(logDir, "stderr.log")}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HIJACKCLAW_HOME</key>
    <string>${paths.appHome}</string>
  </dict>
</dict>
</plist>
`;
}

// ── shell hook (add / remove) ───────────────────────────────────

export function addShellHook(rcPath: string, envShPath: string): void {
  const existing = fs.existsSync(rcPath) ? fs.readFileSync(rcPath, "utf8") : "";
  if (existing.includes(SHELL_HOOK_BEGIN_MARKER)) {
    return;
  }

  const block = `\n${SHELL_HOOK_BEGIN_MARKER}\n[ -f "${envShPath}" ] && source "${envShPath}"\n${SHELL_HOOK_END_MARKER}\n`;
  fs.writeFileSync(rcPath, existing + block);
}

export function removeShellHook(rcPath: string): void {
  if (!fs.existsSync(rcPath)) return;

  const content = fs.readFileSync(rcPath, "utf8");
  const beginIdx = content.indexOf(SHELL_HOOK_BEGIN_MARKER);
  if (beginIdx === -1) return;

  const endIdx = content.indexOf(SHELL_HOOK_END_MARKER);
  if (endIdx === -1) return;

  const before = content.slice(0, beginIdx === 0 ? 0 : beginIdx - 1);
  const after = content.slice(endIdx + SHELL_HOOK_END_MARKER.length + 1);
  fs.writeFileSync(rcPath, before + after);
}

// ── resolve paths ───────────────────────────────────────────────

function resolveCliScriptPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  let dir = path.dirname(thisFile);

  while (true) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return path.join(dir, "dist", "backend", "backend", "cli.js");
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.join(path.dirname(thisFile), "cli.js");
    }
    dir = parent;
  }
}

function resolvePlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
}

function resolveRcPath(): string {
  const shell = process.env.SHELL ?? "/bin/zsh";
  if (shell.endsWith("bash")) return path.join(os.homedir(), ".bashrc");
  return path.join(os.homedir(), ".zshrc");
}

function getUid(): string {
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("process.getuid() not available on this platform");
  return String(uid);
}

// ── install command ─────────────────────────────────────────────

export type InstallDeps = {
  appHome?: string;
  logger?: Logger;
};

export async function runInstall(deps: InstallDeps = {}): Promise<void> {
  const logger: Logger = deps.logger ?? console;
  const appHome = deps.appHome ?? process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");

  fs.mkdirSync(path.join(appHome, "logs"), { recursive: true });

  // 1. Write default config if it doesn't exist
  const configPath = path.join(appHome, "config.json");
  const config = readConfig(configPath);
  if (!fs.existsSync(configPath)) {
    writeConfig(configPath, config);
    logger.info(`Created default config: ${configPath}`);
  }

  // 2. Write env.sh
  const envShPath = path.join(appHome, "env.sh");
  fs.writeFileSync(envShPath, generateEnvSh(config));
  logger.info(`Wrote shell hook: ${envShPath}`);

  // 3. Add source line to shell rc
  const rcPath = resolveRcPath();
  addShellHook(rcPath, envShPath);
  logger.info(`Added source line to ${rcPath}`);

  // 4. Write and load launchd plist
  const plistPath = resolvePlistPath();
  const nodePath = process.execPath;
  const scriptPath = resolveCliScriptPath();
  fs.writeFileSync(plistPath, generatePlist({ nodePath, scriptPath, appHome }));
  logger.info(`Wrote launchd plist: ${plistPath}`);

  const uid = getUid();
  try {
    execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", `gui/${uid}`, plistPath], { stdio: "inherit" });
  logger.info("Loaded launchd agent");

  logger.info("\nInstall complete! Open a new terminal for env vars to take effect.");
  logger.info("Run `hijackclaw status` to verify everything is running.");
}

// ── uninstall command ───────────────────────────────────────────

export type UninstallDeps = {
  appHome?: string;
  purge?: boolean;
  logger?: Logger;
};

export async function runUninstall(deps: UninstallDeps = {}): Promise<void> {
  const logger: Logger = deps.logger ?? console;
  const appHome = deps.appHome ?? process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");

  // 1. Unload launchd agent
  const plistPath = resolvePlistPath();
  if (fs.existsSync(plistPath)) {
    const uid = getUid();
    try {
      execFileSync("launchctl", ["bootout", `gui/${uid}`, plistPath], { stdio: "ignore" });
      logger.info("Unloaded launchd agent");
    } catch {
      logger.warn("launchd agent was not loaded (already stopped)");
    }
    fs.unlinkSync(plistPath);
    logger.info(`Removed ${plistPath}`);
  }

  // 2. Remove shell hook
  const rcPath = resolveRcPath();
  removeShellHook(rcPath);
  logger.info(`Removed hook from ${rcPath}`);

  // 3. Remove env.sh and PID file
  for (const file of ["env.sh", "proxy.pid"]) {
    const p = path.join(appHome, file);
    try { fs.unlinkSync(p); } catch {}
  }
  logger.info("Removed env.sh and PID file");

  // 4. Remove logs
  const logsDir = path.join(appHome, "logs");
  fs.rmSync(logsDir, { recursive: true, force: true });
  logger.info("Removed logs");

  // 5. Optionally purge auth + config
  if (deps.purge) {
    fs.rmSync(appHome, { recursive: true, force: true });
    logger.info(`Purged ${appHome}`);
  }

  logger.info("\nUninstall complete. Open a new terminal to clear env vars.");
}
