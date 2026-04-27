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

type RawOutputItem = {
  type?: string;
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type RawResponseLike = {
  id?: string;
  model?: string;
  output_text?: string;
  output?: RawOutputItem[];
  usage?: RawUsage;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  status?: string | null;
  incomplete_details?: {
    reason?: string | null;
  } | null;
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

function collectOutputItemText(item: RawOutputItem): string {
  return collectOutputText([item]);
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

function mergeFunctionCalls(
  existing: UpstreamFunctionCall[],
  incoming: UpstreamFunctionCall[],
): UpstreamFunctionCall[] {
  const merged = [...existing];
  const seen = new Set(merged.map((call) => call.callId));

  for (const call of incoming) {
    if (!seen.has(call.callId)) {
      merged.push(call);
      seen.add(call.callId);
    }
  }

  return merged;
}

function isKnownNonOutputEvent(type: string): boolean {
  return [
    "response.in_progress",
    "response.content_part.added",
    "response.content_part.done",
    "response.output_text.annotation.added",
    "rate_limits.updated",
  ].includes(type);
}

function isOpenAICodexProgressEventType(type: string): boolean {
  return (
    isKnownNonOutputEvent(type) ||
    type === "response.output_item.added" ||
    type === "response.output_item.created" ||
    type === "response.output_item.done" ||
    type === "response.function_call_arguments.delta" ||
    type === "response.function_call_arguments.done" ||
    type === "response.output_text.done"
  );
}

export function isOpenAICodexProgressEvent(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && isOpenAICodexProgressEventType(type);
}

type PendingFunctionCall = {
  itemId?: string;
  outputIndex?: number;
  callId?: string;
  name?: string;
  arguments: string;
};

function rawOutputItemFrom(value: unknown): RawOutputItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as RawOutputItem;
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export class OpenAICodexStreamNormalizer {
  private readonly functionCallsByItemId = new Map<string, PendingFunctionCall>();
  private readonly functionCallsByOutputIndex = new Map<number, PendingFunctionCall>();
  private readonly emittedFunctionCallKeys = new Set<string>();

  constructor(private readonly logger?: Pick<Console, "info">) {}

  normalize(value: unknown): UpstreamStreamEvent[] {
    if (!value || typeof value !== "object") {
      return [];
    }

    const event = value as Record<string, unknown>;
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "response.created") {
      const response = (event.response ?? event) as RawResponseLike;
      return [
        {
          type,
          id: typeof response.id === "string" ? response.id : `resp_${randomUUID()}`,
          model: typeof response.model === "string" ? response.model : "gpt-5.4",
        },
      ];
    }

    if (type === "response.output_text.delta" && typeof event.delta === "string") {
      return [
        {
          type,
          delta: event.delta,
        },
      ];
    }

    if (type === "response.output_text.done" && typeof event.text === "string") {
      return [
        {
          type,
          text: event.text,
        },
      ];
    }

    if (type === "response.output_item.added" || type === "response.output_item.created") {
      this.rememberFunctionCallItem(rawOutputItemFrom(event.item), numberFrom(event.output_index));
      return [];
    }

    if (type === "response.function_call_arguments.delta") {
      const pending = this.getOrCreateFunctionCall(
        stringFrom(event.item_id),
        numberFrom(event.output_index),
      );
      if (typeof event.delta === "string") {
        pending.arguments += event.delta;
      }
      return [];
    }

    if (type === "response.function_call_arguments.done") {
      const item = rawOutputItemFrom(event.item);
      const pending = this.rememberFunctionCallItem(item, numberFrom(event.output_index))
        ?? this.getOrCreateFunctionCall(stringFrom(event.item_id), numberFrom(event.output_index));
      if (typeof event.arguments === "string") {
        pending.arguments = event.arguments;
      }
      if (item?.arguments !== undefined) {
        pending.arguments = item.arguments;
      }
      return this.emitFunctionCallIfReady(pending);
    }

    if (type === "response.output_item.done") {
      const item = rawOutputItemFrom(event.item);
      if (item?.type === "function_call") {
        const pending = this.rememberFunctionCallItem(item, numberFrom(event.output_index));
        return pending ? this.emitFunctionCallIfReady(pending) : [];
      }

      if (item) {
        const text = collectOutputItemText(item);
        if (text.length > 0) {
          return [{ type: "response.output_text.done", text }];
        }
      }

      return [];
    }

    if (type === "response.completed" || type === "response.done") {
      const response = extractOpenAICodexResponse(event.response ?? event);
      return [
        {
          type: "response.completed",
          response: {
            ...response,
            functionCalls: mergeFunctionCalls(response.functionCalls ?? [], this.completedFunctionCalls()),
          },
        },
      ];
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

    if (type && !isKnownNonOutputEvent(type)) {
      this.logger?.info(`Unhandled upstream event type: ${type}`);
    }

    return [];
  }

  private getOrCreateFunctionCall(itemId?: string, outputIndex?: number): PendingFunctionCall {
    if (itemId) {
      const existing = this.functionCallsByItemId.get(itemId);
      if (existing) {
        return existing;
      }
    }

    if (outputIndex !== undefined) {
      const existing = this.functionCallsByOutputIndex.get(outputIndex);
      if (existing) {
        if (itemId) {
          existing.itemId = itemId;
          this.functionCallsByItemId.set(itemId, existing);
        }
        return existing;
      }
    }

    const pending: PendingFunctionCall = {
      itemId,
      outputIndex,
      arguments: "",
    };
    if (itemId) {
      this.functionCallsByItemId.set(itemId, pending);
    }
    if (outputIndex !== undefined) {
      this.functionCallsByOutputIndex.set(outputIndex, pending);
    }
    return pending;
  }

  private rememberFunctionCallItem(
    item: RawOutputItem | null,
    outputIndex?: number,
  ): PendingFunctionCall | null {
    if (item?.type !== "function_call") {
      return null;
    }

    const pending = this.getOrCreateFunctionCall(item.id, outputIndex);
    pending.callId = item.call_id ?? pending.callId ?? item.id;
    pending.name = item.name ?? pending.name;
    if (item.arguments !== undefined) {
      pending.arguments = item.arguments;
    }
    return pending;
  }

  private emitFunctionCallIfReady(pending: PendingFunctionCall): UpstreamStreamEvent[] {
    if (!pending.callId || !pending.name) {
      return [];
    }

    const dedupeKey = pending.callId || pending.itemId || `output:${pending.outputIndex ?? ""}`;
    if (this.emittedFunctionCallKeys.has(dedupeKey)) {
      return [];
    }

    this.emittedFunctionCallKeys.add(dedupeKey);
    return [
      {
        type: "response.function_call.completed",
        functionCall: {
          callId: pending.callId,
          name: pending.name,
          arguments: pending.arguments || "{}",
        },
      },
    ];
  }

  private completedFunctionCalls(): UpstreamFunctionCall[] {
    const calls: UpstreamFunctionCall[] = [];
    const seen = new Set<string>();
    for (const pending of [
      ...this.functionCallsByOutputIndex.values(),
      ...this.functionCallsByItemId.values(),
    ]) {
      if (!pending.callId || !pending.name || seen.has(pending.callId)) {
        continue;
      }
      calls.push({
        callId: pending.callId,
        name: pending.name,
        arguments: pending.arguments || "{}",
      });
      seen.add(pending.callId);
    }
    return calls;
  }
}

export function extractOpenAICodexResponse(value: unknown): UpstreamResponse {
  const response = (value ?? {}) as RawResponseLike;
  const outputText =
    typeof response.output_text === "string" ? response.output_text : collectOutputText(response.output);
  const functionCalls = extractFunctionCalls(response.output);
  const rawStopReason = response.stop_reason ?? response.incomplete_details?.reason ?? response.status;

  return {
    id: typeof response.id === "string" ? response.id : `resp_${randomUUID()}`,
    model: typeof response.model === "string" ? response.model : "gpt-5.4",
    outputText,
    functionCalls,
    stopReason: functionCalls.length > 0 && (response.stop_reason === undefined || response.stop_reason === null)
      ? "tool_use"
      : mapStopReason(rawStopReason),
    stopSequence: typeof response.stop_sequence === "string" ? response.stop_sequence : null,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    },
  };
}

export function normalizeOpenAICodexEvent(value: unknown, logger?: Pick<Console, "info">): UpstreamStreamEvent | null {
  return new OpenAICodexStreamNormalizer(logger).normalize(value)[0] ?? null;
}

export async function collectCompletedResponse(
  stream: AsyncIterable<UpstreamStreamEvent>,
): Promise<UpstreamResponse> {
  let latestCreated: { id: string; model: string } | null = null;
  let text = "";
  let functionCalls: UpstreamFunctionCall[] = [];
  for await (const event of stream) {
    if (event.type === "response.created") {
      latestCreated = { id: event.id, model: event.model };
      continue;
    }
    if (event.type === "response.output_text.delta") {
      text += event.delta;
      continue;
    }
    if (event.type === "response.output_text.done") {
      text = event.text.length > text.length ? event.text : text;
      continue;
    }
    if (event.type === "response.function_call.completed") {
      functionCalls = mergeFunctionCalls(functionCalls, [event.functionCall]);
      continue;
    }
    if (event.type === "response.completed") {
      const mergedFunctionCalls = mergeFunctionCalls(event.response.functionCalls ?? [], functionCalls);
      const stopReason =
        mergedFunctionCalls.length > 0 && event.response.stopReason === "end_turn"
          ? "tool_use"
          : event.response.stopReason;
      return event.response.outputText.length > 0
        ? { ...event.response, functionCalls: mergedFunctionCalls, stopReason }
        : { ...event.response, outputText: text, functionCalls: mergedFunctionCalls, stopReason };
    }
  }

  if (latestCreated) {
    return {
      id: latestCreated.id,
      model: latestCreated.model,
      outputText: text,
      functionCalls,
      stopReason: functionCalls.length > 0 ? "tool_use" : "end_turn",
      stopSequence: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
    };
  }

  throw new Error("OpenAI Codex response stream ended without a completed response");
}
