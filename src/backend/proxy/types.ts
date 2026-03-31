export type ClaudeRole = "user" | "assistant" | "system" | "tool";

export type ClaudeTextBlock = {
  type: "text";
  text: string;
};

export type ClaudeUnknownBlock = {
  type: string;
  [key: string]: unknown;
};

export type ClaudeToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type ClaudeToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content?: string | Array<ClaudeTextBlock>;
  is_error?: boolean;
};

export type ClaudeToolDefinition = {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

export type ClaudeContent = string | Array<ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock | ClaudeUnknownBlock>;

export type ClaudeMessage = {
  role: ClaudeRole;
  content: ClaudeContent;
};

export type ClaudeMessagesRequest = {
  model: string;
  messages: ClaudeMessage[];
  system?: string | ClaudeTextBlock[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: ClaudeToolDefinition[];
  tool_choice?: unknown;
  thinking?: {
    type?: string;
    budget_tokens?: number;
  };
  output_config?: {
    effort?: "low" | "medium" | "high";
  };
};

export type ClaudeStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;

export type ClaudeMessagesResponse = {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<ClaudeTextBlock | ClaudeToolUseBlock>;
  model: string;
  stop_reason: ClaudeStopReason;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
};

export type ClaudeErrorResponse = {
  type: "error";
  error: {
    type: "invalid_request_error";
    message: string;
  };
};
