import { randomUUID } from "node:crypto";
import type { UpstreamFunctionCall, UpstreamStreamEvent } from "../upstream/types.js";
import type { ClaudeStopReason } from "./types.js";
import { mapUpstreamStopReasonToClaude } from "./upstream-to-claude.js";

type TranslateStreamOptions = {
  messageId?: string;
  model: string;
};

function formatSseEvent(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function buildMessageId(messageId?: string): string {
  return messageId ?? `msg_${randomUUID()}`;
}

function parseFunctionCallInput(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function* translateUpstreamStreamToClaudeSse(
  stream: AsyncIterable<UpstreamStreamEvent>,
  options: TranslateStreamOptions,
): AsyncGenerator<string> {
  const messageId = buildMessageId(options.messageId);
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: ClaudeStopReason = "end_turn";
  let stopSequence: string | null = null;
  let functionCalls: UpstreamFunctionCall[] = [];
  let contentBlockIndex = 0;

  yield formatSseEvent("message_start", {
    type: "message_start",
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      content: [],
      model: options.model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  });

  yield formatSseEvent("content_block_start", {
    type: "content_block_start",
    index: contentBlockIndex,
    content_block: {
      type: "text",
      text: "",
    },
  });

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && event.delta.length > 0) {
      yield formatSseEvent("content_block_delta", {
        type: "content_block_delta",
        index: contentBlockIndex,
        delta: {
          type: "text_delta",
          text: event.delta,
        },
      });
      continue;
    }

    if (event.type === "response.completed") {
      inputTokens = event.response.usage.inputTokens;
      outputTokens = event.response.usage.outputTokens;
      stopReason = mapUpstreamStopReasonToClaude(event.response.stopReason);
      stopSequence = event.response.stopSequence;
      functionCalls = event.response.functionCalls ?? [];
    }
  }

  yield formatSseEvent("content_block_stop", {
    type: "content_block_stop",
    index: contentBlockIndex,
  });
  contentBlockIndex++;

  for (const fc of functionCalls) {
    yield formatSseEvent("content_block_start", {
      type: "content_block_start",
      index: contentBlockIndex,
      content_block: {
        type: "tool_use",
        id: fc.callId,
        name: fc.name,
        input: {},
      },
    });

    yield formatSseEvent("content_block_delta", {
      type: "content_block_delta",
      index: contentBlockIndex,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(parseFunctionCallInput(fc.arguments)),
      },
    });

    yield formatSseEvent("content_block_stop", {
      type: "content_block_stop",
      index: contentBlockIndex,
    });

    contentBlockIndex++;
  }

  yield formatSseEvent("message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: stopReason,
      stop_sequence: stopSequence,
    },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  });

  yield formatSseEvent("message_stop", {
    type: "message_stop",
  });
}
