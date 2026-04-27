import { createOpenAICodexSseTransport, type OpenAICodexSseTransportDeps } from "./openai-codex-sse.js";
import { createOpenAICodexWsTransport, type OpenAICodexWsTransportDeps } from "./openai-codex-ws.js";
import type {
  UpstreamRequest,
  UpstreamResponse,
  UpstreamStreamEvent,
  UpstreamTransport,
  UpstreamTransportMode,
} from "./types.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

export type OpenAICodexTransportDeps = {
  ws: OpenAICodexWsTransportDeps;
  sse: OpenAICodexSseTransportDeps;
  logger?: Logger;
  onModeChange?: (mode: UpstreamTransportMode) => void;
};

export class OpenAICodexTransport implements UpstreamTransport {
  private readonly wsTransport;
  private readonly sseTransport;
  private readonly logger: Logger;

  constructor(private readonly deps: OpenAICodexTransportDeps) {
    this.wsTransport = createOpenAICodexWsTransport(deps.ws);
    this.sseTransport = createOpenAICodexSseTransport(deps.sse);
    this.logger = deps.logger ?? console;
  }

  async createMessage(request: UpstreamRequest): Promise<UpstreamResponse> {
    try {
      this.deps.onModeChange?.("ws");
      return await this.wsTransport.createMessage(request);
    } catch (error) {
      this.logger.info(`Falling back from WebSocket to SSE transport: ${error instanceof Error ? error.message : String(error)}`);
      this.deps.onModeChange?.("sse");
      return await this.sseTransport.createMessage(request);
    }
  }

  async *streamMessage(request: UpstreamRequest): AsyncGenerator<UpstreamStreamEvent> {
    try {
      this.deps.onModeChange?.("ws");
      let yieldedAny = false;
      for await (const event of this.wsTransport.streamMessage(request)) {
        yieldedAny = true;
        yield event;
      }
      if (yieldedAny) {
        return;
      }
      this.logger.info("Falling back from WebSocket to SSE transport: WebSocket stream completed with no events");
    } catch (error) {
      this.logger.info(`Falling back from WebSocket to SSE transport: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.deps.onModeChange?.("sse");
    yield* this.sseTransport.streamMessage(request);
  }

  async close(): Promise<void> {
    await this.wsTransport.close();
    await this.sseTransport.close();
  }
}

export function createOpenAICodexTransport(deps: OpenAICodexTransportDeps): OpenAICodexTransport {
  return new OpenAICodexTransport(deps);
}
