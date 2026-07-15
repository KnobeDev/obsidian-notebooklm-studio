import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bridgeSource from "../bridge/notebooklm_bridge.py";

export async function materializeCompanion(pluginDir: string): Promise<string> {
  const digest = createHash("sha256").update(bridgeSource).digest("hex").slice(0, 16);
  const filename = path.join(pluginDir, `notebooklm-bridge-${digest}.py`);
  try {
    if (await fs.readFile(filename, "utf8") === bridgeSource) return filename;
  } catch { /* materialize below */ }
  const temporary = `${filename}.partial`;
  await fs.writeFile(temporary, bridgeSource, { encoding: "utf8", mode: 0o700 });
  await fs.rename(temporary, filename);
  return filename;
}
