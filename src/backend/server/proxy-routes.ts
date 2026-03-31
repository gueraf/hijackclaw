import type { Express, Request, Response } from "express";
import type { UpstreamTransport } from "../upstream/types.js";
import { translateClaudeRequestToUpstream } from "../proxy/claude-to-upstream.js";
import { isProxyValidationError } from "../proxy/errors.js";
import { translateUpstreamResponseToClaude } from "../proxy/upstream-to-claude.js";
import { translateUpstreamStreamToClaudeSse } from "../proxy/upstream-stream-to-claude-sse.js";
import { redactSensitiveText } from "../proxy/redaction.js";
import type { ClaudeErrorResponse, ClaudeMessagesRequest } from "../proxy/types.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type ProxyRouteDeps = {
  upstreamTransport: UpstreamTransport;
  models?: string[];
  modelMap?: Record<string, string>;
  logger?: Logger;
};

const DEFAULT_MODELS = ["gpt-5.4", "gpt-5.4-mini"];

function sendProxyError(response: Response, message: string, statusCode: number): void {
  const body: ClaudeErrorResponse = {
    type: "error",
    error: {
      type: "invalid_request_error",
      message,
    },
  };
  response.status(statusCode).json(body);
}

function normalizeError(error: unknown): { statusCode: number; message: string } {
  if (isProxyValidationError(error)) {
    return {
      statusCode: error.statusCode,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 502,
      message: error.message,
    };
  }

  return {
    statusCode: 500,
    message: "Unknown proxy error",
  };
}

function parseClaudeBody(request: Request): ClaudeMessagesRequest {
  return request.body as ClaudeMessagesRequest;
}

export function registerProxyRoutes(app: Pick<Express, "get" | "post">, deps: ProxyRouteDeps): void {
  const logger = deps.logger ?? console;

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/v1/models", (_request, response) => {
    const catalog = deps.models ?? DEFAULT_MODELS;
    response.json({
      data: catalog.map((id) => ({
        id,
        object: "model",
        created: 0,
        owned_by: "openai",
      })),
    });
  });

  app.post("/v1/messages", async (request, response) => {
    let claudeRequest: ClaudeMessagesRequest;
    try {
      claudeRequest = parseClaudeBody(request);
      const requestedModel = claudeRequest.model;
      const upstreamModel = deps.modelMap?.[requestedModel] ?? requestedModel;
      const upstreamRequest = translateClaudeRequestToUpstream({
        ...claudeRequest,
        model: upstreamModel,
      }, { reasoningModel: requestedModel });
      logger.info(
        `Proxying model ${requestedModel} -> ${upstreamModel} with reasoning effort ${upstreamRequest.reasoning?.effort ?? "unset"}`,
      );

      if (claudeRequest.stream) {
        response.status(200);
        response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders?.();

        const stream = deps.upstreamTransport.streamMessage(upstreamRequest);
        for await (const chunk of translateUpstreamStreamToClaudeSse(stream, { model: claudeRequest.model })) {
          if (response.writableEnded) {
            break;
          }
          response.write(chunk);
        }
        response.end();
        return;
      }

      const upstreamResponse = await deps.upstreamTransport.createMessage(upstreamRequest);
      const claudeResponse = translateUpstreamResponseToClaude(upstreamResponse);
      response.status(200).json(claudeResponse);
    } catch (error) {
      const normalized = normalizeError(error);
      logger.warn(`Proxy request failed: ${redactSensitiveText(normalized.message)}`);

      if (response.headersSent) {
        response.write(
          `event: error\ndata: ${JSON.stringify({ type: "error", error: { message: normalized.message } })}\n\n`,
        );
        response.end();
        return;
      }

      sendProxyError(response, normalized.message, normalized.statusCode);
    }
  });
}
