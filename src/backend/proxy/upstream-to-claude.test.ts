import { describe, expect, it } from "vitest";
import { mapUpstreamStopReasonToClaude, translateUpstreamResponseToClaude } from "./upstream-to-claude.js";

describe("mapUpstreamStopReasonToClaude", () => {
  it("maps upstream stop reasons into Claude stop reasons", () => {
    expect(mapUpstreamStopReasonToClaude("end_turn")).toBe("end_turn");
    expect(mapUpstreamStopReasonToClaude("max_tokens")).toBe("max_tokens");
    expect(mapUpstreamStopReasonToClaude("stop_sequence")).toBe("stop_sequence");
    expect(mapUpstreamStopReasonToClaude("tool_use")).toBe("tool_use");
    expect(mapUpstreamStopReasonToClaude(null)).toBe("end_turn");
  });
});

describe("translateUpstreamResponseToClaude", () => {
  it("maps a normalized upstream response into a Claude-style message response", () => {
    const result = translateUpstreamResponseToClaude({
      id: "resp_123",
      model: "gpt-5.4",
      outputText: "Hello from Codex",
      stopReason: "end_turn",
      stopSequence: null,
      usage: {
        inputTokens: 13,
        outputTokens: 7,
      },
    });

    expect(result).toEqual({
      id: "resp_123",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello from Codex" }],
      model: "gpt-5.4",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 13,
        output_tokens: 7,
      },
    });
  });

  it("translates function calls into tool_use content blocks", () => {
    const result = translateUpstreamResponseToClaude({
      id: "resp_456",
      model: "gpt-5.4",
      outputText: "I'll read that file.",
      functionCalls: [
        {
          callId: "call_abc",
          name: "Read",
          arguments: '{"file_path":"/tmp/test.txt"}',
        },
      ],
      stopReason: "tool_use",
      stopSequence: null,
      usage: { inputTokens: 20, outputTokens: 15 },
    });

    expect(result.content).toEqual([
      { type: "text", text: "I'll read that file." },
      {
        type: "tool_use",
        id: "call_abc",
        name: "Read",
        input: { file_path: "/tmp/test.txt" },
      },
    ]);
    expect(result.stop_reason).toBe("tool_use");
  });
});
