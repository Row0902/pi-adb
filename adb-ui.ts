import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdbParams } from "./adb-runner";

export async function captureUiTree(
  pi: ExtensionAPI,
  params: AdbParams,
  signal?: AbortSignal
): Promise<{ text: string; args: string[] }> {
  const deviceArgs = params.device ? ["-s", params.device] : [];
  const stamp = Date.now();
  const remote = `/data/local/tmp/pi-uidump-${stamp}.xml`;
  const local = join(tmpdir(), `pi-adb-uidump-${stamp}.xml`);

  const dump = await pi.exec(
    "adb",
    [...deviceArgs, "shell", "uiautomator", "dump", remote],
    { signal, timeout: 30000 }
  );
  if (dump.code !== 0) {
    throw new Error(`uiautomator dump failed: ${dump.stderr || dump.stdout || dump.code}`);
  }

  const pull = await pi.exec("adb", [...deviceArgs, "pull", remote, local], {
    signal,
    timeout: 30000,
  });
  if (pull.code !== 0) {
    throw new Error(`pull failed: ${pull.stderr || pull.stdout || pull.code}`);
  }

  const xml = await readFile(local, "utf8");
  const summary = summarizeUiNodes(xml);
  await pi.exec(
    "adb",
    [...deviceArgs, "shell", "rm", "-f", "/data/local/tmp/pi-uidump-*.xml"],
    { signal, timeout: 10000 }
  );

  return { text: summary, args: ["ui"] };
}

interface UiNodeInfo {
  center: [number, number];
  text: string;
  desc: string;
  id: string;
  cls: string;
  clickable: boolean;
}

function summarizeUiNodes(xml: string): string {
  const nodes: UiNodeInfo[] = [];

  for (const match of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = match[1] ?? "";
    const bounds = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(attrs);
    if (!bounds) continue;

    const x1 = Number(bounds[1]);
    const y1 = Number(bounds[2]);
    const x2 = Number(bounds[3]);
    const y2 = Number(bounds[4]);
    if (![x1, y1, x2, y2].every(Number.isFinite)) continue;

    nodes.push({
      center: [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)],
      text: getAttr(attrs, "text"),
      desc: getAttr(attrs, "content-desc"),
      id: getAttr(attrs, "resource-id"),
      cls: getAttr(attrs, "class"),
      clickable: getAttr(attrs, "clickable") === "true",
    });
  }

  const interesting = nodes.filter((n) => n.clickable || n.text || n.desc || n.id);

  if (interesting.length === 0) {
    return "UI hierarchy: no interactive or labeled nodes found.";
  }

  const lines = interesting.map(
    (n) =>
      `- (${n.center[0]},${n.center[1]})` +
      (n.clickable ? " [clickable]" : "") +
      (n.text && ` text="${n.text}"`) +
      (n.desc && ` desc="${n.desc}"`) +
      (n.id && ` id="${n.id}"`) +
      (n.cls && ` class="${n.cls}"`)
  );

  const truncation = truncateHead(lines.join("\n"), {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  let text = `UI hierarchy: ${interesting.length} of ${nodes.length} nodes\n${truncation.content}`;
  if (truncation.truncated) {
    text += `\n[Truncated: ${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}]`;
  }
  return text;
}

function getAttr(attrs: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return match ? match[1]! : "";
}
