import { buildOpenAICodexRequestBody, collectCompletedResponse, normalizeOpenAICodexEvent } from "./openai-codex-wire.js";
import type { UpstreamRequest, UpstreamStreamEvent, UpstreamTransport } from "./types.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type OpenAICodexSseTransportDeps = {
  accessTokenProvider: () => Promise<string>;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: Logger;
};

export class OpenAICodexSseTransport implements UpstreamTransport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger;

  constructor(private readonly deps: OpenAICodexSseTransportDeps) {
    this.baseUrl = (deps.baseUrl ?? "https://chatgpt.com/backend-api/codex").replace(/\/+$/, "");
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.logger = deps.logger ?? console;
  }

  async createMessage(request: UpstreamRequest) {
    return await collectCompletedResponse(this.streamMessage(request));
  }

  async *streamMessage(request: UpstreamRequest): AsyncGenerator<UpstreamStreamEvent> {
    const accessToken = await this.deps.accessTokenProvider();
    const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(buildOpenAICodexRequestBody(request, true)),
    });

    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {}
      throw new Error(`OpenAI Codex SSE request failed: ${response.status}${detail ? ` — ${detail}` : ""}`);
    }
    if (!response.body) {
      throw new Error("OpenAI Codex SSE response body was empty");
    }

    this.logger.info("OpenAI Codex SSE stream opened");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex < 0) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const parsed = parseSseDataLines(rawEvent);
        if (!parsed) {
          continue;
        }
        const normalized = normalizeOpenAICodexEvent(parsed, this.logger);
        if (normalized) {
          yield normalized;
        }
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const parsed = parseSseDataLines(tail);
      if (parsed) {
        const normalized = normalizeOpenAICodexEvent(parsed, this.logger);
        if (normalized) {
          yield normalized;
        }
      }
    }
    this.logger.info("OpenAI Codex SSE stream closed");
  }

  async close(): Promise<void> {
    // SSE requests are scoped per-call, so there is no persistent connection to close.
  }
}

function parseSseDataLines(rawEvent: string): unknown | null {
  const data = rawEvent
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");

  if (!data || data === "[DONE]") {
    return null;
  }

  return JSON.parse(data) as unknown;
}

export function createOpenAICodexSseTransport(deps: OpenAICodexSseTransportDeps): OpenAICodexSseTransport {
  return new OpenAICodexSseTransport(deps);
}
