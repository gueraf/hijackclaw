import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateEnvSh,
  generatePlist,
  SHELL_HOOK_BEGIN_MARKER,
  SHELL_HOOK_END_MARKER,
  addShellHook,
  removeShellHook,
} from "./install.js";
import { DEFAULT_CONFIG } from "./config.js";

describe("install", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hijackclaw-install-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("generateEnvSh", () => {
    it("produces a script that checks proxy health before exporting", () => {
      const script = generateEnvSh(DEFAULT_CONFIG);
      expect(script).toContain("nc -z 127.0.0.1 8082");
      expect(script).toContain('export ANTHROPIC_BASE_URL="http://127.0.0.1:8082"');
      expect(script).toContain('export ANTHROPIC_AUTH_TOKEN="hijackclaw"');
      expect(script).toContain(`export ANTHROPIC_MODEL="${DEFAULT_CONFIG.model}"`);
      expect(script).toContain(`export ANTHROPIC_SMALL_FAST_MODEL="${DEFAULT_CONFIG.smallFastModel}"`);
      expect(script).toContain(`export ANTHROPIC_DEFAULT_OPUS_MODEL="${DEFAULT_CONFIG.model}"`);
      expect(script).toContain(`export ANTHROPIC_DEFAULT_SONNET_MODEL="${DEFAULT_CONFIG.model}"`);
      expect(script).toContain(`export ANTHROPIC_DEFAULT_HAIKU_MODEL="${DEFAULT_CONFIG.smallFastModel}"`);
      expect(script).toContain(`export CLAUDE_CODE_SUBAGENT_MODEL="${DEFAULT_CONFIG.smallFastModel}"`);
    });
  });

  describe("generatePlist", () => {
    it("produces a valid plist with correct paths", () => {
      const plist = generatePlist({
        nodePath: "/usr/local/bin/node",
        scriptPath: "/opt/hijackclaw/dist/backend/cli.js",
        appHome: "/Users/test/.hijackclaw",
      });
      expect(plist).toContain("<string>/usr/local/bin/node</string>");
      expect(plist).toContain("<string>/opt/hijackclaw/dist/backend/cli.js</string>");
      expect(plist).toContain("<string>serve</string>");
      expect(plist).toContain("com.hijackclaw.proxy");
      expect(plist).toContain("KeepAlive");
    });
  });

  describe("addShellHook / removeShellHook", () => {
    it("adds a source line with markers to the rc file", () => {
      const rcPath = path.join(tmpDir, ".zshrc");
      fs.writeFileSync(rcPath, "# existing config\n");
      addShellHook(rcPath, "/Users/test/.hijackclaw/env.sh");
      const content = fs.readFileSync(rcPath, "utf8");
      expect(content).toContain(SHELL_HOOK_BEGIN_MARKER);
      expect(content).toContain(SHELL_HOOK_END_MARKER);
      expect(content).toContain('[ -f "/Users/test/.hijackclaw/env.sh" ] && source "/Users/test/.hijackclaw/env.sh"');
      expect(content).toContain("# existing config");
    });

    it("does not duplicate the hook on repeated calls", () => {
      const rcPath = path.join(tmpDir, ".zshrc");
      fs.writeFileSync(rcPath, "");
      addShellHook(rcPath, "/Users/test/.hijackclaw/env.sh");
      addShellHook(rcPath, "/Users/test/.hijackclaw/env.sh");
      const content = fs.readFileSync(rcPath, "utf8");
      const count = content.split(SHELL_HOOK_BEGIN_MARKER).length - 1;
      expect(count).toBe(1);
    });

    it("removes the hook cleanly", () => {
      const rcPath = path.join(tmpDir, ".zshrc");
      fs.writeFileSync(rcPath, "# before\n");
      addShellHook(rcPath, "/Users/test/.hijackclaw/env.sh");
      removeShellHook(rcPath);
      const content = fs.readFileSync(rcPath, "utf8");
      expect(content).not.toContain(SHELL_HOOK_BEGIN_MARKER);
      expect(content).not.toContain(SHELL_HOOK_END_MARKER);
      expect(content).toContain("# before");
    });

    it("is a no-op if hook was never added", () => {
      const rcPath = path.join(tmpDir, ".zshrc");
      fs.writeFileSync(rcPath, "# untouched\n");
      removeShellHook(rcPath);
      expect(fs.readFileSync(rcPath, "utf8")).toBe("# untouched\n");
    });

    it("creates the rc file if it does not exist", () => {
      const rcPath = path.join(tmpDir, ".zshrc");
      addShellHook(rcPath, "/Users/test/.hijackclaw/env.sh");
      expect(fs.existsSync(rcPath)).toBe(true);
      expect(fs.readFileSync(rcPath, "utf8")).toContain(SHELL_HOOK_BEGIN_MARKER);
    });
  });
});
