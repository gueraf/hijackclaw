import { describe, expect, it, vi } from "vitest";
import { OpenAICodexTransport } from "./openai-codex-transport.js";

describe("OpenAICodexTransport", () => {
  it("falls back to SSE when websocket transport fails", async () => {
    const modes: string[] = [];
    const transport = new OpenAICodexTransport({
      ws: {
        accessTokenProvider: async () => "token",
        createSocket: (() => {
          throw new Error("ws unavailable");
        }) as never,
      },
      sse: {
        accessTokenProvider: async () => "token",
        fetchImpl: vi.fn(async () =>
          new Response(
            [
              'data: {"type":"response.created","response":{"id":"resp_sse","model":"gpt-5.4"}}',
              "",
              'data: {"type":"response.completed","response":{"id":"resp_sse","model":"gpt-5.4","output_text":"fallback","usage":{"input_tokens":5,"output_tokens":1},"stop_reason":"end_turn"}}',
              "",
            ].join("\n"),
            {
              status: 200,
              headers: {
                "Content-Type": "text/event-stream",
              },
            },
          )) as unknown as typeof fetch,
      },
      logger: console,
      onModeChange: (mode) => {
        modes.push(mode);
      },
    });

    const response = await transport.createMessage({
      model: "gpt-5.4",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
    });

    expect(response.outputText).toBe("fallback");
    expect(modes).toEqual(["ws", "sse"]);
  });

  it("streaming falls back to SSE when websocket yields no events", async () => {
    const modes: string[] = [];

    // WS transport that opens but yields nothing (simulates all events normalizing to null)
    const emptyWsTransport = {
      async createMessage() {
        throw new Error("unused");
      },
      async *streamMessage() {
        // yields nothing — simulates empty stream
      },
      async close() {},
    };

    const transport = new OpenAICodexTransport({
      ws: {
        accessTokenProvider: async () => "token",
        // We override the transport at the class level below
        createSocket: (() => { throw new Error("unused"); }) as never,
      },
      sse: {
        accessTokenProvider: async () => "token",
        fetchImpl: vi.fn(async () =>
          new Response(
            [
              'data: {"type":"response.created","response":{"id":"resp_sse","model":"gpt-5.4"}}',
              "",
              'data: {"type":"response.output_text.delta","delta":"SSE content"}',
              "",
              'data: {"type":"response.completed","response":{"id":"resp_sse","model":"gpt-5.4","output_text":"SSE content","usage":{"input_tokens":5,"output_tokens":2},"stop_reason":"end_turn"}}',
              "",
            ].join("\n"),
            {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            },
          )) as unknown as typeof fetch,
      },
      logger: console,
      onModeChange: (mode) => {
        modes.push(mode);
      },
    });

    // Replace the internal WS transport with our empty mock
    (transport as unknown as { wsTransport: typeof emptyWsTransport }).wsTransport = emptyWsTransport;

    const events: string[] = [];
    for await (const event of transport.streamMessage({
      model: "gpt-5.4",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
    })) {
      events.push(event.type);
    }

    expect(events).toContain("response.output_text.delta");
    expect(modes).toEqual(["ws", "sse"]);
  });
});
