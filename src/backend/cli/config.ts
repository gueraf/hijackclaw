import fs from "node:fs";
import path from "node:path";

export type DaemonConfig = {
  port: number;
  model: string;
  smallFastModel: string;
};

export const DEFAULT_CONFIG: DaemonConfig = {
  port: 8082,
  model: "gpt-5.4",
  smallFastModel: "gpt-5.4-mini",
};

export function readConfig(filePath: string): DaemonConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<DaemonConfig>;
    return {
      port: typeof raw.port === "number" ? raw.port : DEFAULT_CONFIG.port,
      model: typeof raw.model === "string" ? raw.model : DEFAULT_CONFIG.model,
      smallFastModel: typeof raw.smallFastModel === "string" ? raw.smallFastModel : DEFAULT_CONFIG.smallFastModel,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(filePath: string, config: DaemonConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}
