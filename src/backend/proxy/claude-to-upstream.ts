import type {
  UpstreamFunctionCallInput,
  UpstreamFunctionCallOutput,
  UpstreamInputItem,
  UpstreamInputMessage,
  UpstreamRequest,
  UpstreamTool,
} from "../upstream/types.js";
import { ProxyValidationError, UnsupportedAnthropicFeatureError } from "./errors.js";
import type {
  ClaudeContent,
  ClaudeMessagesRequest,
  ClaudeTextBlock,
  ClaudeToolDefinition,
  ClaudeToolResultBlock,
  ClaudeToolUseBlock,
} from "./types.js";

type TranslateClaudeRequestOptions = {
  reasoningModel?: string;
};

function translateReasoning(
  request: ClaudeMessagesRequest,
  options?: TranslateClaudeRequestOptions,
): { effort?: "low" | "medium" | "high" } | undefined {
  if (request.thinking?.type === "disabled") {
    return undefined;
  }

  const explicitEffort = request.output_config?.effort;
  if (explicitEffort) {
    return { effort: explicitEffort };
  }

  const budget = request.thinking?.budget_tokens;
  if (typeof budget === "number") {
    if (budget <= 2048) {
      return { effort: "low" };
    }
    if (budget <= 8192) {
      return { effort: "medium" };
    }
    return { effort: "high" };
  }

  const reasoningModel = (options?.reasoningModel ?? request.model).toLowerCase();

  if (reasoningModel.includes("haiku")) {
    return { effort: "low" };
  }
  if (reasoningModel.includes("opus")) {
    return { effort: "high" };
  }
  if (reasoningModel.includes("sonnet")) {
    return { effort: "medium" };
  }

  return undefined;
}

function toInputMessage(role: "system" | "user" | "assistant", text: string): UpstreamInputMessage {
  const contentType = role === "assistant" ? "output_text" : "input_text";
  return {
    role,
    content: [{ type: contentType, text }],
  };
}

function extractText(content: ClaudeContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ClaudeTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function translateTools(tools: ClaudeToolDefinition[]): UpstreamTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  }));
}

function translateToolChoice(choice: unknown): unknown | undefined {
  if (!choice || typeof choice !== "object") return undefined;
  const c = choice as Record<string, unknown>;
  if (c.type === "auto") return "auto";
  if (c.type === "any") return "required";
  if (c.type === "tool" && typeof c.name === "string") {
    return { type: "function", name: c.name };
  }
  return undefined;
}

function toolResultContentToString(content: ClaudeToolResultBlock["content"]): string {
  if (content === undefined || content === null) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b): b is ClaudeTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

function translateAssistantContent(content: ClaudeContent): UpstreamInputItem[] {
  if (typeof content === "string") {
    return content ? [toInputMessage("assistant", content)] : [];
  }

  const items: UpstreamInputItem[] = [];
  const text = extractText(content);
  if (text) {
    items.push(toInputMessage("assistant", text));
  }

  for (const block of content) {
    if (block.type === "tool_use") {
      const tu = block as ClaudeToolUseBlock;
      items.push({
        type: "function_call",
        call_id: tu.id,
        name: tu.name,
        arguments: JSON.stringify(tu.input),
      } satisfies UpstreamFunctionCallInput);
    }
  }

  return items;
}

function translateUserContent(content: ClaudeContent): UpstreamInputItem[] {
  if (typeof content === "string") {
    return [toInputMessage("user", content)];
  }

  const items: UpstreamInputItem[] = [];
  const textParts: string[] = [];

  for (const block of content) {
    if (block.type === "text") {
      textParts.push((block as ClaudeTextBlock).text);
    } else if (block.type === "tool_result") {
      const tr = block as ClaudeToolResultBlock;
      items.push({
        type: "function_call_output",
        call_id: tr.tool_use_id,
        output: toolResultContentToString(tr.content),
      } satisfies UpstreamFunctionCallOutput);
    } else if (block.type !== "tool_use") {
      throw new UnsupportedAnthropicFeatureError(`content block type=${block.type}`);
    }
  }

  if (textParts.length > 0) {
    items.unshift(toInputMessage("user", textParts.join("")));
  }

  return items;
}

export function translateClaudeRequestToUpstream(
  request: ClaudeMessagesRequest,
  options?: TranslateClaudeRequestOptions,
): UpstreamRequest {
  if (!request || typeof request !== "object") {
    throw new ProxyValidationError("Request body must be a JSON object");
  }
  if (!request.model || typeof request.model !== "string") {
    throw new ProxyValidationError("model is required");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ProxyValidationError("messages must contain at least one message");
  }

  const input: UpstreamInputItem[] = [];
  let instructions: string | undefined;

  if (typeof request.system === "string" && request.system.length > 0) {
    instructions = request.system;
  } else if (Array.isArray(request.system) && request.system.length > 0) {
    const text = request.system
      .filter((b): b is ClaudeTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (text) instructions = text;
  }

  for (const message of request.messages) {
    if (message.role === "assistant") {
      input.push(...translateAssistantContent(message.content));
    } else if (message.role === "user") {
      input.push(...translateUserContent(message.content));
    }
  }

  const reasoning = translateReasoning(request, options);

  const result: UpstreamRequest = {
    model: request.model,
    instructions,
    input,
    reasoning,
    maxOutputTokens: request.max_tokens,
    temperature: request.temperature,
    topP: request.top_p,
    stopSequences: request.stop_sequences,
  };

  if (request.tools && request.tools.length > 0) {
    result.tools = translateTools(request.tools);
  }

  const toolChoice = translateToolChoice(request.tool_choice);
  if (toolChoice !== undefined) {
    result.toolChoice = toolChoice;
  }

  return result;
}
