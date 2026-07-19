import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const PACKAGE_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

export function resolveProviderAsset(projectDir: string, projectRelativePath: string, packageRelativePath: string): string {
  const projectOverride = join(projectDir, projectRelativePath);
  if (existsSync(projectOverride)) {
    return projectOverride;
  }
  return join(PACKAGE_ROOT, "templates", "providers", packageRelativePath);
}
