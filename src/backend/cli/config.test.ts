import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeConfig, DEFAULT_CONFIG, type DaemonConfig } from "./config.js";

describe("config", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hijackclaw-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when config file does not exist", () => {
    const config = readConfig(path.join(tmpDir, "config.json"));
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("round-trips a config", () => {
    const filePath = path.join(tmpDir, "config.json");
    const custom: DaemonConfig = {
      port: 9000,
      model: "gpt-5.4",
      smallFastModel: "gpt-5.4-mini",
      modelMap: {
        "claude-sonnet-4-6": "gpt-5.4",
        "claude-haiku-4-5-20251001": "gpt-5.4-mini",
        "claude-opus": "gpt-5.4",
      },
    };
    writeConfig(filePath, custom);
    expect(readConfig(filePath)).toEqual(custom);
  });

  it("returns defaults for malformed JSON", () => {
    const filePath = path.join(tmpDir, "config.json");
    fs.writeFileSync(filePath, "not json");
    expect(readConfig(filePath)).toEqual(DEFAULT_CONFIG);
  });
});
