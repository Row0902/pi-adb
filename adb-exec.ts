import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  truncateHead,
  truncateTail,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDeviceNames, buildAdbArgs, parseDevices, type AdbDevice, type AdbParams } from "./adb-runner";

export interface AdbImageBlock {
  type: "image";
  source: { type: "base64"; mediaType: string; data: string };
}

const LOGCAT_DEFAULT_SECONDS = 10;
const LOGCAT_MAX_SECONDS = 60;
const HOST_ONLY_ACTIONS = new Set(["devices", "pair", "connect", "disconnect"]);
const SLOW_ACTIONS = new Set(["sideload", "bugreport"]);
const DEVICE_NAME_CACHE = new Map<string, string>();

type AdbUpdate = { content: Array<{ type: "text"; text: string }> };
type OnUpdate = (update: AdbUpdate) => void;

export type AdbRunResult = { text: string; args: string[]; image?: AdbImageBlock; devices?: AdbDevice[] };

async function fetchDeviceName(
  pi: ExtensionAPI,
  serial: string,
  signal?: AbortSignal
): Promise<string> {
  const cached = DEVICE_NAME_CACHE.get(serial);
  if (cached) return cached;

  const result = await pi.exec(
    "adb",
    ["-s", serial, "shell", "getprop", "ro.product.marketname"],
    { signal, timeout: 10000 }
  );
  const name = (result.stdout || "").trim();
  if (name) DEVICE_NAME_CACHE.set(serial, name);
  return name;
}

async function enrichDeviceNames(
  pi: ExtensionAPI,
  devices: AdbDevice[],
  signal?: AbortSignal
): Promise<void> {
  for (const d of devices) {
    if (d.status !== "device") continue;
    d.name = await fetchDeviceName(pi, d.serial, signal);
  }
}

async function resolveDeviceSerial(
  pi: ExtensionAPI,
  params: AdbParams,
  signal?: AbortSignal
): Promise<void> {
  if (params.device || HOST_ONLY_ACTIONS.has(params.action)) return;

  const result = await pi.exec("adb", ["devices"], { signal, timeout: 10000 });
  const online = parseDevices(result.stdout || "").filter((d) => d.status === "device");

  if (online.length === 1) params.device = online[0]!.serial;
}

async function streamLogcat(
  pi: ExtensionAPI,
  params: AdbParams,
  signal: AbortSignal | undefined,
  onUpdate?: OnUpdate
): Promise<string> {
  const seconds = Math.min(
    Math.max(params.duration ?? LOGCAT_DEFAULT_SECONDS, 1),
    LOGCAT_MAX_SECONDS
  );
  const adbArgs = buildAdbArgs(params);

  if (params.clear) {
    await pi.exec("adb", [...(params.device ? ["-s", params.device] : []), "logcat", "-c"], {
      signal,
      timeout: 10000,
    });
  }

  let output = "";
  let lineCount = 0;
  let lastUpdate = 0;

  await new Promise<void>((resolve, reject) => {
    const child = spawn("adb", adbArgs, { signal });
    const timer = setTimeout(() => child.kill(), seconds * 1000);

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      lineCount += text.split("\n").length - 1;

      const now = Date.now();
      if (onUpdate && now - lastUpdate > 1000) {
        lastUpdate = now;
        onUpdate({
          content: [
            { type: "text", text: `Streaming logcat... ${lineCount} lines captured` },
          ],
        });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (signal?.aborted || err.name === "AbortError") resolve();
      else reject(err);
    });

    child.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  return output;
}

async function captureScreenshot(
  pi: ExtensionAPI,
  params: AdbParams,
  signal?: AbortSignal
): Promise<{ text: string; image: AdbImageBlock }> {
  const deviceArgs = params.device ? ["-s", params.device] : [];
  const stamp = Date.now();
  const remote = `/data/local/tmp/pi-screencap-${stamp}.png`;
  const local = join(tmpdir(), `pi-adb-screencap-${stamp}.png`);

  const cap = await pi.exec(
    "adb",
    [...deviceArgs, "shell", "screencap", "-p", remote],
    { signal, timeout: 30000 }
  );
  if (cap.code !== 0) {
    throw new Error(`screencap failed: ${cap.stderr || cap.stdout || cap.code}`);
  }

  const pull = await pi.exec("adb", [...deviceArgs, "pull", remote, local], {
    signal,
    timeout: 30000,
  });
  if (pull.code !== 0) {
    throw new Error(`pull failed: ${pull.stderr || pull.stdout || pull.code}`);
  }

  const data = await readFile(local, "base64");
  const kb = Math.round((data.length * 3) / 4 / 1024);
  await pi.exec("adb", [...deviceArgs, "shell", "rm", remote], {
    signal,
    timeout: 10000,
  });

  return {
    text: `Screenshot captured (${kb} KB), saved to: ${local}`,
    image: { type: "image", source: { type: "base64", mediaType: "image/png", data } },
  };
}

export async function runAdb(
  pi: ExtensionAPI,
  params: AdbParams,
  signal?: AbortSignal,
  onUpdate?: OnUpdate
): Promise<AdbRunResult> {
  const { action } = params;

  await resolveDeviceSerial(pi, params, signal);

  if (action === "logcat") {
    const text = await streamLogcat(pi, params, signal, onUpdate);
    return { text, args: buildAdbArgs(params) };
  }

  if (action === "screencap") {
    const shot = await captureScreenshot(pi, params, signal);
    return { text: shot.text, args: buildAdbArgs(params), image: shot.image };
  }

  const adbArgs = buildAdbArgs(params);

  onUpdate?.({
    content: [{ type: "text", text: `Running: adb ${adbArgs.join(" ")}` }],
  });

  const result = await pi.exec("adb", adbArgs, {
    signal,
    timeout:
      action === "shell" ? 15000 : SLOW_ACTIONS.has(action) ? 600000 : 120000,
  });

  const output = result.stdout || result.stderr || "";
  const useTail = action === "shell";

  const truncation = useTail
    ? truncateTail(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
    : truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });

  let text = truncation.content;

  if (truncation.truncated) {
    const tempFile = join(tmpdir(), `pi-adb-${Date.now()}.txt`);
    await writeFile(tempFile, output, "utf8");
    text +=
      `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
      `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
      `Full output saved to: ${tempFile}]`;
  }

  if (result.code !== 0) {
    throw new Error(`adb exited with code ${result.code}\n${text}`);
  }

  if (action === "devices") {
    const devices = parseDevices(output);
    await enrichDeviceNames(pi, devices, signal);
    return { text: appendDeviceNames(text, devices), args: adbArgs, devices };
  }

  return { text, args: adbArgs };
}
