import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { UpstreamTransport } from "../upstream/types.js";
import { registerProxyRoutes } from "./proxy-routes.js";

function createApp(upstreamTransport: UpstreamTransport, modelMap?: Record<string, string>) {
  const app = express();
  app.use(express.json());
  registerProxyRoutes(app, {
    upstreamTransport,
    models: ["gpt-5.4", "gpt-5.4-mini"],
    modelMap,
    logger: console,
  });
  return app;
}

async function* mockStream() {
  yield {
    type: "response.created" as const,
    id: "resp_stream",
    model: "gpt-5.4",
  };

  yield {
    type: "response.output_text.delta" as const,
    delta: "Hello",
  };

  yield {
    type: "response.completed" as const,
    response: {
      id: "resp_stream",
      model: "gpt-5.4",
      outputText: "Hello",
      stopReason: "end_turn" as const,
      stopSequence: null,
      usage: {
        inputTokens: 12,
        outputTokens: 3,
      },
    },
  };
}

describe("registerProxyRoutes", () => {
  it("serves /health", async () => {
    const app = createApp({
      createMessage: vi.fn(),
      streamMessage: vi.fn(),
      close: vi.fn(async () => undefined),
    });

    const response = await request(app).get("/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it("serves /v1/models", async () => {
    const app = createApp({
      createMessage: vi.fn(),
      streamMessage: vi.fn(),
      close: vi.fn(async () => undefined),
    });

    const response = await request(app).get("/v1/models");
    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0].id).toBe("gpt-5.4");
  });

  it("maps non-stream /v1/messages response", async () => {
    const upstreamTransport: UpstreamTransport = {
      createMessage: vi.fn(async () => ({
        id: "resp_1",
        model: "gpt-5.4",
        outputText: "Hello from upstream",
        stopReason: "end_turn",
        stopSequence: null,
        usage: {
          inputTokens: 9,
          outputTokens: 4,
        },
      })),
      streamMessage: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    const app = createApp(upstreamTransport);
    const response = await request(app).post("/v1/messages").send({
      model: "gpt-5.4",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      stream: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.type).toBe("message");
    expect(response.body.content[0].text).toBe("Hello from upstream");
    expect(response.body.usage.output_tokens).toBe(4);
  });

  it("maps incoming Anthropic models before calling upstream", async () => {
    const upstreamTransport: UpstreamTransport = {
      createMessage: vi.fn(async () => ({
        id: "resp_1",
        model: "gpt-5.4-mini",
        outputText: "Hello from upstream",
        stopReason: "end_turn",
        stopSequence: null,
        usage: {
          inputTokens: 9,
          outputTokens: 4,
        },
      })),
      streamMessage: vi.fn(),
      close: vi.fn(async () => undefined),
    };

    const app = createApp(upstreamTransport, {
      "claude-haiku-4-5-20251001": "gpt-5.4-mini",
      "claude-sonnet-4-6": "gpt-5.4",
      "claude-opus": "gpt-5.4",
    });
    const response = await request(app).post("/v1/messages").send({
      model: "claude-haiku-4-5-20251001",
      messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      stream: false,
    });

    expect(response.status).toBe(200);
    expect(upstreamTransport.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.4-mini", reasoning: { effort: "low" } }),
    );
  });

  it("streams Claude SSE events for stream=true", async () => {
    const upstreamTransport: UpstreamTransport = {
      createMessage: vi.fn(),
      streamMessage: vi.fn(async function* () {
        yield* mockStream();
      }),
      close: vi.fn(async () => undefined),
    };

    const app = createApp(upstreamTransport);

    const response = await request(app)
      .post("/v1/messages")
      .send({
        model: "gpt-5.4",
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        stream: true,
      })
      .buffer(true)
      .parse((res, callback) => {
        res.setEncoding("utf8");
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => callback(null, data));
      });

    expect(response.status).toBe(200);
    expect(response.body).toContain("event: message_start");
    expect(response.body).toContain("event: content_block_delta");
    expect(response.body).toContain("Hello");
    expect(response.body).toContain("event: message_stop");
  });

  it("returns explicit errors for unsupported MVP features", async () => {
    const app = createApp({
      createMessage: vi.fn(),
      streamMessage: vi.fn(),
      close: vi.fn(async () => undefined),
    });

    const response = await request(app).post("/v1/messages").send({
        model: "gpt-5.4",
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { type: "base64", data: "abc" } }],
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("error");
    expect(String(response.body.error.message)).toContain("Unsupported Anthropic feature");
  });
});
