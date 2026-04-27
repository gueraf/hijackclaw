import WebSocket, { type ClientOptions } from "ws";
import {
  buildOpenAICodexRequestBody,
  collectCompletedResponse,
  isOpenAICodexProgressEvent,
  OpenAICodexStreamNormalizer,
} from "./openai-codex-wire.js";
import type { UpstreamRequest, UpstreamStreamEvent, UpstreamTransport } from "./types.js";

type Logger = Pick<Console, "info" | "warn" | "error">;

type WebSocketFactory = (
  url: string,
  options: ClientOptions,
) => WebSocket;

export type OpenAICodexWsTransportDeps = {
  accessTokenProvider: () => Promise<string>;
  baseUrl?: string;
  logger?: Logger;
  createSocket?: WebSocketFactory;
  /** Max ms to wait for the first upstream event after sending. Default 30 000. */
  firstEventTimeoutMs?: number;
};

class AsyncQueue<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<T>) => void;
    reject: (error: Error) => void;
  }> = [];
  private done = false;
  private error: Error | null = null;

  push(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value });
      return;
    }
    this.values.push(value);
  }

  fail(error: Error): void {
    this.error = error;
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.reject(error);
    }
  }

  finish(): void {
    this.done = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.resolve({ done: true, value: undefined });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length > 0) {
      return { done: false, value: this.values.shift() as T };
    }
    if (this.error) {
      throw this.error;
    }
    if (this.done) {
      return { done: true, value: undefined };
    }
    return await new Promise<IteratorResult<T>>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

export class OpenAICodexWsTransport implements UpstreamTransport {
  private readonly baseUrl: string;
  private readonly logger: Logger;
  private readonly createSocket: WebSocketFactory;
  private readonly firstEventTimeoutMs: number;
  private readonly sockets = new Set<WebSocket>();

  constructor(private readonly deps: OpenAICodexWsTransportDeps) {
    this.baseUrl = (deps.baseUrl ?? "wss://chatgpt.com/backend-api/codex").replace(/\/+$/, "");
    this.logger = deps.logger ?? console;
    this.createSocket = deps.createSocket ?? ((url, options) => new WebSocket(url, [], options));
    this.firstEventTimeoutMs = deps.firstEventTimeoutMs ?? 30_000;
  }

  async createMessage(request: UpstreamRequest) {
    return await collectCompletedResponse(this.streamMessage(request));
  }

  async *streamMessage(request: UpstreamRequest): AsyncGenerator<UpstreamStreamEvent> {
    const accessToken = await this.deps.accessTokenProvider();
    const socket = this.createSocket(`${this.baseUrl}/responses`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    this.sockets.add(socket);
    const queue = new AsyncQueue<UpstreamStreamEvent>();
    const normalizer = new OpenAICodexStreamNormalizer(this.logger);
    let completed = false;
    let receivedAnyEvent = false;

    let firstEventTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = () => {
      if (firstEventTimer !== null) {
        clearTimeout(firstEventTimer);
        firstEventTimer = null;
      }
    };

    socket.once("open", () => {
      this.logger.info("OpenAI Codex websocket opened");
      socket.send(
        JSON.stringify({
          type: "response.create",
          response: buildOpenAICodexRequestBody(request, true),
        }),
      );

      firstEventTimer = setTimeout(() => {
        if (!receivedAnyEvent) {
          this.logger.warn(`No upstream events within ${this.firstEventTimeoutMs}ms, closing websocket`);
          queue.fail(new Error(`WebSocket response timeout: no events received within ${this.firstEventTimeoutMs}ms`));
          socket.close();
        }
      }, this.firstEventTimeoutMs);
    });

    socket.on("message", (data) => {
      try {
        const parsed = JSON.parse(data.toString("utf8")) as unknown;
        const normalizedEvents = normalizer.normalize(parsed);
        if (normalizedEvents.length > 0 || isOpenAICodexProgressEvent(parsed)) {
          receivedAnyEvent = true;
          clearTimer();
        }
        for (const normalized of normalizedEvents) {
          queue.push(normalized);
          if (normalized.type === "response.completed") {
            completed = true;
            socket.close();
          }
        }
      } catch (error) {
        clearTimer();
        queue.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });

    socket.once("error", (error) => {
      clearTimer();
      queue.fail(error instanceof Error ? error : new Error(String(error)));
    });

    socket.once("close", () => {
      clearTimer();
      this.logger.info("OpenAI Codex websocket closed");
      this.sockets.delete(socket);
      if (!completed) {
        queue.finish();
      } else {
        queue.finish();
      }
    });

    while (true) {
      const next = await queue.next();
      if (next.done) {
        break;
      }
      yield next.value;
    }
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.close();
    }
    this.sockets.clear();
  }
}

export function createOpenAICodexWsTransport(deps: OpenAICodexWsTransportDeps): OpenAICodexWsTransport {
  return new OpenAICodexWsTransport(deps);
}
