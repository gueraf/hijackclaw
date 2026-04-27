import type { UpstreamResponse, UpstreamStopReason } from "../upstream/types.js";
import type { ClaudeMessagesResponse, ClaudeStopReason, ClaudeTextBlock, ClaudeToolUseBlock } from "./types.js";

export function mapUpstreamStopReasonToClaude(reason: UpstreamStopReason): ClaudeStopReason {
  if (reason === "max_tokens") return "max_tokens";
  if (reason === "stop_sequence") return "stop_sequence";
  if (reason === "tool_use") return "tool_use";
  return "end_turn";
}

function parseFunctionCallInput(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function translateUpstreamResponseToClaude(response: UpstreamResponse): ClaudeMessagesResponse {
  const content: Array<ClaudeTextBlock | ClaudeToolUseBlock> = [];

  if (response.outputText) {
    content.push({ type: "text", text: response.outputText });
  }

  for (const fc of response.functionCalls ?? []) {
    content.push({
      type: "tool_use",
      id: fc.callId,
      name: fc.name,
      input: parseFunctionCallInput(fc.arguments),
    });
  }

  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    content,
    model: response.model,
    stop_reason: response.functionCalls?.length
      ? "tool_use"
      : mapUpstreamStopReasonToClaude(response.stopReason),
    stop_sequence: response.stopSequence,
    usage: {
      input_tokens: response.usage.inputTokens,
      output_tokens: response.usage.outputTokens,
    },
  };
}
