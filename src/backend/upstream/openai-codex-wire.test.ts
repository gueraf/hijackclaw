import { describe, expect, it, vi } from "vitest";
import type { UpstreamStreamEvent } from "./types.js";
import { collectCompletedResponse, OpenAICodexStreamNormalizer } from "./openai-codex-wire.js";

async function* toAsyncStream(chunks: UpstreamStreamEvent[]): AsyncGenerator<UpstreamStreamEvent> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("OpenAICodexStreamNormalizer", () => {
  it("aggregates streamed function-call events without logging known lifecycle events", async () => {
    const logger = { info: vi.fn() };
    const normalizer = new OpenAICodexStreamNormalizer(logger);

    const normalized = [
      { type: "response.in_progress", response: { id: "resp_1", model: "gpt-5.4" } },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "Read",
          arguments: "",
        },
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: "{\"file_path\"",
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: ":\"/tmp/a.txt\"}",
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
        arguments: "{\"file_path\":\"/tmp/a.txt\"}",
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "fc_1",
          type: "function_call",
          call_id: "call_1",
          name: "Read",
          arguments: "{\"file_path\":\"/tmp/a.txt\"}",
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_1",
          model: "gpt-5.4",
          output: [],
          status: "completed",
          usage: { input_tokens: 12, output_tokens: 4 },
        },
      },
    ].flatMap((event) => normalizer.normalize(event));

    expect(logger.info).not.toHaveBeenCalled();
    expect(normalized.filter((event) => event.type === "response.function_call.completed")).toHaveLength(1);

    const completed = await collectCompletedResponse(toAsyncStream(normalized));
    expect(completed.functionCalls).toEqual([
      {
        callId: "call_1",
        name: "Read",
        arguments: "{\"file_path\":\"/tmp/a.txt\"}",
      },
    ]);
    expect(completed.stopReason).toBe("tool_use");
  });

  it("uses output item text when the stream omits text deltas", async () => {
    const normalizer = new OpenAICodexStreamNormalizer();
    const normalized = [
      { type: "response.created", response: { id: "resp_2", model: "gpt-5.4" } },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Hello from item done" }],
        },
      },
      {
        type: "response.completed",
        response: {
          id: "resp_2",
          model: "gpt-5.4",
          output: [],
          status: "completed",
          usage: { input_tokens: 9, output_tokens: 5 },
        },
      },
    ].flatMap((event) => normalizer.normalize(event));

    const completed = await collectCompletedResponse(toAsyncStream(normalized));
    expect(completed.outputText).toBe("Hello from item done");
    expect(completed.usage.outputTokens).toBe(5);
  });
});
