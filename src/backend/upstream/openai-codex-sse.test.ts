import { describe, expect, it, vi } from "vitest";
import { createOpenAICodexSseTransport } from "./openai-codex-sse.js";

function createSseResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

describe("createOpenAICodexSseTransport", () => {
  it("posts to the Codex subscription endpoint and parses streaming events", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
      expect(String(init?.headers && (init.headers as Record<string, string>).Authorization)).toBe("Bearer token-123");
      return createSseResponse(
        [
          'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.4"}}',
          "",
          'data: {"type":"response.output_text.delta","delta":"Hello"}',
          "",
          'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.4","output_text":"Hello","usage":{"input_tokens":8,"output_tokens":1},"stop_reason":"end_turn"}}',
          "",
        ].join("\n"),
      );
    });

    const transport = createOpenAICodexSseTransport({
      accessTokenProvider: async () => "token-123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      logger: console,
    });

    const response = await transport.createMessage({
      model: "gpt-5.4",
      input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
    });

    expect(response).toEqual({
      id: "resp_1",
      model: "gpt-5.4",
      outputText: "Hello",
      functionCalls: [],
      stopReason: "end_turn",
      stopSequence: null,
      usage: {
        inputTokens: 8,
        outputTokens: 1,
      },
    });
  });
});
