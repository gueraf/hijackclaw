import { describe, expect, it } from "vitest";
import type { UpstreamStreamEvent } from "../upstream/types.js";
import { translateUpstreamStreamToClaudeSse } from "./upstream-stream-to-claude-sse.js";

async function collectChunks(stream: AsyncIterable<string>): Promise<string> {
  let output = "";
  for await (const part of stream) {
    output += part;
  }
  return output;
}

async function* toAsyncStream(chunks: UpstreamStreamEvent[]): AsyncGenerator<UpstreamStreamEvent> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("translateUpstreamStreamToClaudeSse", () => {
  it("emits Claude-compatible SSE events in expected order", async () => {
    const sse = await collectChunks(
      translateUpstreamStreamToClaudeSse(
        toAsyncStream([
          {
            type: "response.created",
            id: "resp_1",
            model: "gpt-5.4",
          },
          {
            type: "response.output_text.delta",
            delta: "Hello",
          },
          {
            type: "response.output_text.delta",
            delta: " world",
          },
          {
            type: "response.completed",
            response: {
              id: "resp_1",
              model: "gpt-5.4",
              outputText: "Hello world",
              stopReason: "end_turn",
              stopSequence: null,
              usage: {
                inputTokens: 11,
                outputTokens: 5,
              },
            },
          },
        ]),
        { model: "gpt-5.4", messageId: "msg_abc" },
      ),
    );

    expect(sse).toContain("event: message_start");
    expect(sse).toContain("event: content_block_start");
    expect(sse).toContain("\"text\":\"Hello\"");
    expect(sse).toContain("\"text\":\" world\"");
    expect(sse).toContain("event: content_block_stop");
    expect(sse).toContain("event: message_delta");
    expect(sse).toContain("\"stop_reason\":\"end_turn\"");
    expect(sse).toContain("\"input_tokens\":11");
    expect(sse).toContain("\"output_tokens\":5");
    expect(sse).toContain("event: message_stop");
  });

  it("emits tool_use content blocks from function calls in completed response", async () => {
    const sse = await collectChunks(
      translateUpstreamStreamToClaudeSse(
        toAsyncStream([
          {
            type: "response.created",
            id: "resp_2",
            model: "gpt-5.4",
          },
          {
            type: "response.output_text.delta",
            delta: "Reading file.",
          },
          {
            type: "response.completed",
            response: {
              id: "resp_2",
              model: "gpt-5.4",
              outputText: "Reading file.",
              functionCalls: [
                {
                  callId: "call_xyz",
                  name: "Read",
                  arguments: '{"file_path":"/tmp/a.txt"}',
                },
              ],
              stopReason: "tool_use",
              stopSequence: null,
              usage: { inputTokens: 10, outputTokens: 8 },
            },
          },
        ]),
        { model: "gpt-5.4", messageId: "msg_tool" },
      ),
    );

    expect(sse).toContain("event: message_start");
    // Text content block
    expect(sse).toContain('"text":"Reading file."');
    // Tool use content block
    expect(sse).toContain('"type":"tool_use"');
    expect(sse).toContain('"id":"call_xyz"');
    expect(sse).toContain('"name":"Read"');
    expect(sse).toContain('"input_json_delta"');
    expect(sse).toContain("file_path");
    // Stop reason
    expect(sse).toContain('"stop_reason":"tool_use"');
    expect(sse).toContain("event: message_stop");
  });
});
