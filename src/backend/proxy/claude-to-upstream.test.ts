import { describe, expect, it } from "vitest";
import { UnsupportedAnthropicFeatureError } from "./errors.js";
import { translateClaudeRequestToUpstream } from "./claude-to-upstream.js";

describe("translateClaudeRequestToUpstream", () => {
  it("maps a text-only Claude request into an upstream responses-style request", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      system: "You are concise.",
      max_tokens: 128,
      temperature: 0.2,
      top_p: 0.9,
      stop_sequences: ["###"],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "Hello proxy" }],
        },
      ],
      stream: false,
    });

    expect(result).toEqual({
      model: "gpt-5.4",
      instructions: "You are concise.",
      input: [
        { role: "user", content: [{ type: "input_text", text: "Hello proxy" }] },
      ],
      maxOutputTokens: 128,
      temperature: 0.2,
      topP: 0.9,
      stopSequences: ["###"],
    });
  });

  it("keeps the provided model unchanged", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.model).toBe("gpt-5.4");
  });

  it("maps explicit output_config effort to upstream reasoning", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toEqual({ effort: "high" });
  });

  it("maps thinking budget to medium reasoning effort", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      thinking: { type: "enabled", budget_tokens: 4096 },
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toEqual({ effort: "medium" });
  });

  it("derives reasoning effort from mapped Claude model family", () => {
    const result = translateClaudeRequestToUpstream({
      model: "claude-opus",
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toEqual({ effort: "high" });
  });

  it("returns no reasoning when thinking is disabled", () => {
    const result = translateClaudeRequestToUpstream({
      model: "claude-opus",
      thinking: { type: "disabled", budget_tokens: 4096 },
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toBeUndefined();
  });

  it("returns no reasoning when thinking is disabled even with explicit effort", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      thinking: { type: "disabled" },
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toBeUndefined();
  });

  it("derives reasoning effort from model name regardless of casing", () => {
    const result = translateClaudeRequestToUpstream({
      model: "Claude-Opus-4",
      messages: [{ role: "user", content: "Hello proxy" }],
    });

    expect(result.reasoning).toEqual({ effort: "high" });
  });

  it("throws for non-text non-tool content blocks", () => {
    expect(() =>
      translateClaudeRequestToUpstream({
        model: "gpt-5.4",
        messages: [
          {
            role: "user",
            content: [{ type: "image", source: { type: "base64", data: "abc" } }],
          },
        ],
      }),
    ).toThrowError(UnsupportedAnthropicFeatureError);
  });

  it("translates tool definitions to upstream function format", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      tools: [
        {
          name: "Read",
          description: "Read a file",
          input_schema: {
            type: "object",
            properties: { file_path: { type: "string" } },
            required: ["file_path"],
          },
        },
      ],
      messages: [{ role: "user", content: "Read /tmp/test.txt" }],
    });

    expect(result.tools).toEqual([
      {
        type: "function",
        name: "Read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { file_path: { type: "string" } },
          required: ["file_path"],
        },
      },
    ]);
  });

  it("translates assistant tool_use and user tool_result messages", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      tools: [{ name: "Read", input_schema: { type: "object" } }],
      messages: [
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "I'll read it." },
            {
              type: "tool_use",
              id: "toolu_01abc",
              name: "Read",
              input: { file_path: "/tmp/test.txt" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_01abc",
              content: "file contents here",
            },
          ],
        },
      ],
    });

    expect(result.input).toEqual([
      { role: "user", content: [{ type: "input_text", text: "Read the file" }] },
      { role: "assistant", content: [{ type: "output_text", text: "I'll read it." }] },
      {
        type: "function_call",
        call_id: "toolu_01abc",
        name: "Read",
        arguments: '{"file_path":"/tmp/test.txt"}',
      },
      {
        type: "function_call_output",
        call_id: "toolu_01abc",
        output: "file contents here",
      },
    ]);
  });

  it("translates tool_choice", () => {
    const result = translateClaudeRequestToUpstream({
      model: "gpt-5.4",
      tools: [{ name: "Read", input_schema: { type: "object" } }],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: "go" }],
    });

    expect(result.toolChoice).toBe("required");
  });
});
