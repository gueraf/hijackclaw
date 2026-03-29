export type UpstreamRole = "system" | "user" | "assistant";

export type UpstreamInputText = {
  type: "input_text";
  text: string;
};

export type UpstreamInputMessage = {
  role: UpstreamRole;
  content: UpstreamInputText[];
};

export type UpstreamTool = {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
};

export type UpstreamFunctionCall = {
  callId: string;
  name: string;
  arguments: string;
};

export type UpstreamFunctionCallInput = {
  type: "function_call";
  callId: string;
  name: string;
  arguments: string;
};

export type UpstreamFunctionCallOutput = {
  type: "function_call_output";
  callId: string;
  output: string;
};

export type UpstreamInputItem =
  | UpstreamInputMessage
  | UpstreamFunctionCallInput
  | UpstreamFunctionCallOutput;

export type UpstreamRequest = {
  model: string;
  input: UpstreamInputItem[];
  tools?: UpstreamTool[];
  toolChoice?: unknown;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stopSequences?: string[];
  metadata?: Record<string, string>;
};

export type UpstreamUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type UpstreamStopReason = "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;

export type UpstreamResponse = {
  id: string;
  model: string;
  outputText: string;
  functionCalls?: UpstreamFunctionCall[];
  stopReason: UpstreamStopReason;
  stopSequence: string | null;
  usage: UpstreamUsage;
};

export type UpstreamStreamEvent =
  | {
      type: "response.created";
      id: string;
      model: string;
    }
  | {
      type: "response.output_text.delta";
      delta: string;
    }
  | {
      type: "response.completed";
      response: UpstreamResponse;
    };

export interface UpstreamTransport {
  createMessage(request: UpstreamRequest): Promise<UpstreamResponse>;
  streamMessage(request: UpstreamRequest): AsyncGenerator<UpstreamStreamEvent>;
  close(): Promise<void>;
}

export type UpstreamTransportMode = "ws" | "sse";
