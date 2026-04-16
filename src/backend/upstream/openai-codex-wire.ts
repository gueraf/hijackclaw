import { randomUUID } from "node:crypto";
import type {
  UpstreamFunctionCall,
  UpstreamRequest,
  UpstreamResponse,
  UpstreamStopReason,
  UpstreamStreamEvent,
} from "./types.js";

type RawUsage = {
  input_tokens?: number;
  output_tokens?: number;
} | null | undefined;

type RawResponseLike = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  }>;
  usage?: RawUsage;
  stop_reason?: string | null;
  stop_sequence?: string | null;
};

function mapStopReason(value: string | null | undefined): UpstreamStopReason {
  if (value === "max_output_tokens" || value === "length") {
    return "max_tokens";
  }
  if (value === "stop_sequence" || value === "content_filter") {
    return "stop_sequence";
  }
  if (value === "tool_use" || value === "tool_calls") {
    return "tool_use";
  }
  if (value === null || value === undefined || value === "stop" || value === "end_turn") {
    return "end_turn";
  }
  return "end_turn";
}

function collectOutputText(output: RawResponseLike["output"]): string {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => item.content ?? [])
    .map((contentItem) => (typeof contentItem.text === "string" ? contentItem.text : ""))
    .join("");
}

export function buildOpenAICodexRequestBody(request: UpstreamRequest, stream = true): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    instructions: request.instructions ?? "",
    input: request.input,
    store: false,
    stream,
  };
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools;
  }
  if (request.toolChoice !== undefined) {
    body.tool_choice = request.toolChoice;
  }
  if (request.reasoning) {
    body.reasoning = request.reasoning;
  }
  return body;
}

function extractFunctionCalls(output: RawResponseLike["output"]): UpstreamFunctionCall[] {
  if (!Array.isArray(output)) return [];
  return output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      callId: item.call_id ?? item.id ?? "",
      name: item.name ?? "",
      arguments: item.arguments ?? "{}",
    }));
}

export function extractOpenAICodexResponse(value: unknown): UpstreamResponse {
  const response = (value ?? {}) as RawResponseLike;
  const outputText =
    typeof response.output_text === "string" ? response.output_text : collectOutputText(response.output);

  return {
    id: typeof response.id === "string" ? response.id : `resp_${randomUUID()}`,
    model: typeof response.model === "string" ? response.model : "gpt-5.4",
    outputText,
    functionCalls: extractFunctionCalls(response.output),
    stopReason: mapStopReason(response.stop_reason),
    stopSequence: typeof response.stop_sequence === "string" ? response.stop_sequence : null,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export function normalizeOpenAICodexEvent(value: unknown, logger?: Pick<Console, "info">): UpstreamStreamEvent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const event = value as Record<string, unknown>;
  const type = typeof event.type === "string" ? event.type : "";

  if (type === "response.created") {
    const response = (event.response ?? event) as RawResponseLike;
    return {
      type,
      id: typeof response.id === "string" ? response.id : `resp_${randomUUID()}`,
      model: typeof response.model === "string" ? response.model : "gpt-5.4",
    };
  }

  if (type === "response.output_text.delta" && typeof event.delta === "string") {
    return {
      type,
      delta: event.delta,
    };
  }

  if (type === "response.completed") {
    return {
      type,
      response: extractOpenAICodexResponse(event.response ?? event),
    };
  }

  if (type === "response.failed") {
    const error = event.error;
    const message =
      error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : "OpenAI Codex response failed";
    throw new Error(message);
  }

  if (type === "error") {
    const message =
      typeof event.message === "string"
        ? event.message
        : typeof event.error === "string"
          ? event.error
          : "OpenAI Codex transport error";
    throw new Error(message);
  }

  if (type) {
    logger?.info(`Unhandled upstream event type: ${type}`);
  }

  return null;
}

export async function collectCompletedResponse(
  stream: AsyncIterable<UpstreamStreamEvent>,
): Promise<UpstreamResponse> {
  let latestCreated: { id: string; model: string } | null = null;
  let text = "";
  for await (const event of stream) {
    if (event.type === "response.created") {
      latestCreated = { id: event.id, model: event.model };
      continue;
    }
    if (event.type === "response.output_text.delta") {
      text += event.delta;
      continue;
    }
    if (event.type === "response.completed") {
      return event.response.outputText.length > 0
        ? event.response
        : { ...event.response, outputText: text };
    }
  }

  if (latestCreated) {
    return {
      id: latestCreated.id,
      model: latestCreated.model,
      outputText: text,
      functionCalls: [],
      stopReason: "end_turn",
      stopSequence: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }

  throw new Error("OpenAI Codex response stream ended without a completed response");
}
