import { once } from "node:events";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createOpenAICodexWsTransport } from "./openai-codex-ws.js";

const resources: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (resources.length > 0) {
    const cleanup = resources.pop();
    await cleanup?.();
  }
});

describe("createOpenAICodexWsTransport", () => {
  it("sends a response.create event and collects websocket output", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    resources.push(
      async () =>
        await new Promise<void>((resolve, reject) => {
          wss.close((wssError) => {
            server.close((serverError) => {
              if (wssError || serverError) {
                reject(wssError ?? serverError);
                return;
              }
              resolve();
            });
          });
        }),
    );

    wss.on("connection", (socket, request) => {
      expect(request.headers.authorization).toBe("Bearer token-456");
      socket.once("message", (payload) => {
        const parsed = JSON.parse(payload.toString("utf8")) as { type: string; response: { model: string } };
        expect(parsed.type).toBe("response.create");
        expect(parsed.response.model).toBe("gpt-5.4");

        socket.send(JSON.stringify({ type: "response.created", response: { id: "resp_ws", model: "gpt-5.4" } }));
        socket.send(JSON.stringify({ type: "response.output_text.delta", delta: "Hello from ws" }));
        socket.send(
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_ws",
              model: "gpt-5.4",
              output_text: "Hello from ws",
              usage: {
                input_tokens: 9,
                output_tokens: 3,
              },
              stop_reason: "end_turn",
            },
          }),
        );
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected tcp server address");
    }

    const transport = createOpenAICodexWsTransport({
      accessTokenProvider: async () => "token-456",
      baseUrl: `ws://127.0.0.1:${address.port}`,
      logger: console,
    });

    const response = await transport.createMessage({
      model: "gpt-5.4",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    });

    expect(response.outputText).toBe("Hello from ws");
    expect(response.usage.outputTokens).toBe(3);
  });

  it("times out when upstream sends no recognized events", async () => {
    const server = createServer();
    const wss = new WebSocketServer({ server });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    resources.push(
      async () =>
        await new Promise<void>((resolve, reject) => {
          wss.close((wssError) => {
            server.close((serverError) => {
              if (wssError || serverError) {
                reject(wssError ?? serverError);
                return;
              }
              resolve();
            });
          });
        }),
    );

    wss.on("connection", (socket) => {
      socket.once("message", () => {
        // Send only unrecognized event types — no response.created/delta/completed
        socket.send(JSON.stringify({ type: "session.created", session: {} }));
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected tcp server address");
    }

    const transport = createOpenAICodexWsTransport({
      accessTokenProvider: async () => "token-456",
      baseUrl: `ws://127.0.0.1:${address.port}`,
      logger: console,
      firstEventTimeoutMs: 200,
    });

    await expect(
      transport.createMessage({
        model: "gpt-5.4",
        input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
      }),
    ).rejects.toThrow(/timeout/i);
  });
});
