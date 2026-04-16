import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import express from "express";
import type { DaemonConfig } from "./config.js";
import { createAuthService, type AuthService } from "../auth/auth-service.js";
import {
  createDefaultOAuthConfig,
  FetchOAuthTransport,
  OAuthClient,
} from "../auth/oauth.js";
import { FileTokenStore, type TokenStore } from "../auth/token-store.js";
import { registerProxyRoutes } from "../server/proxy-routes.js";
import { createOpenAICodexTransport } from "../upstream/openai-codex-transport.js";
import type { UpstreamTransport } from "../upstream/types.js";
import { createAppState, type AppState } from "../runtime/state.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type ServeContextDeps = {
  config: DaemonConfig;
  appHome: string;
  tokenStore?: TokenStore;
  logger?: Logger;
};

export type ServeContext = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export function createServeContext(deps: ServeContextDeps): ServeContext {
  const logger: Logger = deps.logger ?? console;
  const appHome = deps.appHome;
  const config = deps.config;
  const pidFile = path.join(appHome, "proxy.pid");

  let server: http.Server | null = null;
  let transport: UpstreamTransport | null = null;

  return {
    async start() {
      const appState: AppState = createAppState();
      const tokenStore = deps.tokenStore ?? new FileTokenStore(path.join(appHome, "auth.json"));
      const oauthConfig = createDefaultOAuthConfig();
      const authService: AuthService = createAuthService({
        appState,
        oauthClient: new OAuthClient(oauthConfig, new FetchOAuthTransport()),
        tokenStore,
      });

      if (!authService.isAuthenticated()) {
        throw new Error("Not authenticated. Run `hijackclaw login` first.");
      }

      const codexTransport = createOpenAICodexTransport({
        ws: {
          accessTokenProvider: () => authService.getAccessToken(),
          logger,
        },
        sse: {
          accessTokenProvider: () => authService.getAccessToken(),
          logger,
        },
        logger,
      });
      transport = codexTransport;

      const app = express();
      app.disable("x-powered-by");
      app.use(express.json({ limit: "4mb" }));
      registerProxyRoutes(app, {
        upstreamTransport: codexTransport,
        models: [config.model, config.smallFastModel],
        modelMap: config.modelMap,
        logger,
      });

      await new Promise<void>((resolve, reject) => {
        const httpServer = http.createServer(app);
        const onError = (error: Error) => {
          httpServer.off("error", onError);
          reject(error);
        };
        httpServer.once("error", onError);
        httpServer.listen(config.port, "127.0.0.1", () => {
          httpServer.off("error", onError);
          server = httpServer;
          logger.info(`Proxy listening on http://127.0.0.1:${config.port}`);
          resolve();
        });
      });

      fs.mkdirSync(appHome, { recursive: true });
      fs.writeFileSync(pidFile, String(process.pid));
    },

    async stop() {
      try { fs.unlinkSync(pidFile); } catch {}

      if (transport) {
        await transport.close();
        transport = null;
      }

      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((err) => (err ? reject(err) : resolve()));
        });
        server = null;
      }
    },
  };
}

export async function runServe(deps: ServeContextDeps): Promise<void> {
  const ctx = createServeContext(deps);
  await ctx.start();

  const shutdown = async (signal: string) => {
    deps.logger?.info?.(`Received ${signal}, shutting down`);
    await ctx.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
