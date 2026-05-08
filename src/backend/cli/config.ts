import fs from "node:fs";
import path from "node:path";

export type ReasoningEffort = "low" | "medium" | "high" | "extreme";

export type DaemonConfig = {
  port: number;
  model: string;
  smallFastModel: string;
  modelMap: Record<string, string>;
  reasoningEffort?: ReasoningEffort;
};

export const DEFAULT_CONFIG: DaemonConfig = {
  port: 8082,
  model: "gpt-5.5",
  smallFastModel: "gpt-5.4-mini",
  modelMap: {
    "claude-haiku-4-5-20251001": "gpt-5.4-mini",
    "claude-opus-4-7": "gpt-5.5",
    "claude-sonnet-4-6": "gpt-5.5",
    "claude-sonnet-4-7": "gpt-5.5",
  },
};

function normalizeModelMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_CONFIG.modelMap };
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

const VALID_EFFORTS: ReasoningEffort[] = ["low", "medium", "high", "extreme"];

function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return VALID_EFFORTS.includes(value as ReasoningEffort) ? (value as ReasoningEffort) : undefined;
}

export function readConfig(filePath: string): DaemonConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DaemonConfig>;
    return {
      port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
      model: typeof raw.model === "string" ? raw.model : DEFAULT_CONFIG.model,
      smallFastModel: typeof raw.smallFastModel === "string" ? raw.smallFastModel : DEFAULT_CONFIG.smallFastModel,
      modelMap: normalizeModelMap(raw.modelMap),
      reasoningEffort: parseReasoningEffort(raw.reasoningEffort),
    };
  } catch {
    return { ...DEFAULT_CONFIG, modelMap: { ...DEFAULT_CONFIG.modelMap } };
  }
}

export function writeConfig(filePath: string, config: DaemonConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}
