import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServeContext, type ServeContext } from "./serve.js";
import { DEFAULT_CONFIG } from "./config.js";
import { InMemoryTokenStore } from "../auth/token-store.js";

describe("serve", () => {
  let tmpDir: string;
  let ctx: ServeContext;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hijackclaw-serve-test-"));
  });

  afterEach(async () => {
    if (ctx) await ctx.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts the proxy", async () => {
    const tokenStore = new InMemoryTokenStore();
    tokenStore.set({
      accessToken: "test-token",
      refreshToken: "test-refresh",
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    ctx = createServeContext({
      config: DEFAULT_CONFIG,
      appHome: tmpDir,
      tokenStore,
    });
    await ctx.start();

    const res = await fetch(`http://127.0.0.1:${DEFAULT_CONFIG.port}/health`);
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });
});
