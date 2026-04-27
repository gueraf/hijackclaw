import os from "node:os";
import path from "node:path";
import open from "open";
import { createAuthService } from "../auth/auth-service.js";
import {
  createDefaultOAuthConfig,
  FetchOAuthTransport,
  OAuthClient,
} from "../auth/oauth.js";
import { FileTokenStore } from "../auth/token-store.js";
import { startOAuthCallbackServer } from "../auth/callback-server.js";
import { createAppState } from "../runtime/state.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type LoginDeps = {
  appHome?: string;
  logger?: Logger;
};

export async function runLogin(deps: LoginDeps = {}): Promise<void> {
  const logger: Logger = deps.logger ?? console;
  const appHome = deps.appHome ?? process.env.HIJACKCLAW_HOME ?? path.join(os.homedir(), ".hijackclaw");
  const appState = createAppState();
  const oauthConfig = createDefaultOAuthConfig();
  const tokenStore = new FileTokenStore(path.join(appHome, "auth.json"));

  const authService = createAuthService({
    appState,
    oauthClient: new OAuthClient(oauthConfig, new FetchOAuthTransport()),
    tokenStore,
  });

  if (authService.isAuthenticated()) {
    logger.info("Already authenticated.");
    const state = authService.getState();
    if (state.email) logger.info(`Logged in as: ${state.email}`);
    if (state.expiresAt) logger.info(`Token expires: ${state.expiresAt}`);
    return;
  }

  const callbackServer = await startOAuthCallbackServer({
    authService,
    redirectUri: oauthConfig.redirectUri,
    logger,
  });

  const { authorizeUrl, flowId } = await authService.startLogin({ method: "browser" });
  logger.info(`Please open the following URL in your browser to log in:\n\n${authorizeUrl}\n`);

  if (process.env.BROWSER !== "none") {
    logger.info("Opening browser for ChatGPT login...");
    await open(authorizeUrl);
  }

  logger.info("Waiting for authorization (up to 10 minutes)...");

  const result = await new Promise<"approved" | "error">((resolve) => {
    const interval = setInterval(() => {
      const status = authService.getLoginStatus(flowId);
      if (status.status === "approved") {
        clearInterval(interval);
        resolve("approved");
      } else if (status.status === "error" || status.status === "expired") {
        clearInterval(interval);
        resolve("error");
      }
    }, 1000);
  });

  await callbackServer.close();

  if (result === "approved") {
    const state = authService.getState();
    logger.info(`Login successful! Logged in as: ${state.email ?? "unknown"}`);
    logger.info(`Tokens saved to ${path.join(appHome, "auth.json")}`);
  } else {
    logger.error("Login failed or timed out.");
    process.exitCode = 1;
  }
}
