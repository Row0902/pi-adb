import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

interface AdbExtensionState {
  defaultEnabled: boolean;
  projects: Record<string, boolean>;
}

const DEFAULT_STATE: AdbExtensionState = { defaultEnabled: false, projects: {} };

function statePath(): string {
  const base = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
  return join(base, "adb-extension.json");
}

export function normalizeProjectKey(cwd: string): string {
  const resolved = resolve(cwd);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

async function loadState(): Promise<AdbExtensionState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as Partial<AdbExtensionState>;
    return { ...DEFAULT_STATE, ...parsed, projects: { ...parsed.projects } };
  } catch {
    return { ...DEFAULT_STATE, projects: {} };
  }
}

async function saveState(state: AdbExtensionState): Promise<void> {
  await mkdir(dirname(statePath()), { recursive: true });
  await writeFile(statePath(), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export async function isProjectEnabled(cwd: string): Promise<boolean> {
  const state = await loadState();
  return state.projects[normalizeProjectKey(cwd)] ?? state.defaultEnabled;
}

export async function setProjectEnabled(cwd: string, enabled: boolean): Promise<void> {
  const state = await loadState();
  state.projects[normalizeProjectKey(cwd)] = enabled;
  await saveState(state);
}
