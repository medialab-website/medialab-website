import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type LocalSourcePathName =
  | "P02_M16_C_SOURCE_VAULT"
  | "P02_M16_D_SOURCE_PATH"
  | "P02_M16_E_SOURCE_PATH";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let localEnvironmentAttempted = false;

function loadIgnoredLocalEnvironment(): void {
  if (localEnvironmentAttempted) return;
  localEnvironmentAttempted = true;
  const environmentPath = resolve(moduleRoot, ".env");
  if (existsSync(environmentPath)) process.loadEnvFile(environmentPath);
}

export function resolveLocalSourcePath(name: LocalSourcePathName, explicitValue?: string): string {
  const explicit = explicitValue?.trim();
  if (explicit) return resolve(explicit);
  loadIgnoredLocalEnvironment();
  const configured = process.env[name]?.trim();
  if (!configured) {
    throw new Error(`${name} is required through the process environment or the ignored module-local .env file`);
  }
  return resolve(configured);
}
