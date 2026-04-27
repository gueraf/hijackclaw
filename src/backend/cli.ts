#!/usr/bin/env node

import os from "node:os";
import path from "node:path";

const command = process.argv[2];
const appHome = process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");

async function main(): Promise<void> {
  switch (command) {
    case "login": {
      const { runLogin } = await import("./cli/login.js");
      await runLogin({ appHome });
      break;
    }
    case "serve": {
      const { runServe } = await import("./cli/serve.js");
      const { readConfig } = await import("./cli/config.js");
      const config = readConfig(path.join(appHome, "config.json"));
      await runServe({ config, appHome });
      break;
    }
    case "status": {
      const { runStatus } = await import("./cli/status.js");
      await runStatus({ appHome });
      break;
    }
    default: {
      const { printUsage } = await import("./cli/help.js");
      printUsage();
      if (command && command !== "help" && command !== "--help" && command !== "-h") {
        process.exitCode = 1;
      }
      break;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
