import { Text } from "@earendil-works/pi-tui";
import { parseDevices, parsePortRules, type AdbDevice, type AdbPortRule } from "./adb-runner";

type Theme = {
  fg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

interface AdbToolResult {
  content: unknown;
  details?: { args?: string[] };
  isError?: boolean;
}

function statusColor(status: string): string {
  if (status === "device") return "success";
  if (status === "offline") return "error";
  return "warning";
}

export function renderDevicesTable(devices: AdbDevice[], theme: Theme): string {
  if (devices.length === 0) return theme.fg("muted", "No devices connected.");

  const maxSerial = Math.max(8, ...devices.map((d) => d.serial.length));
  const maxStatus = Math.max(6, ...devices.map((d) => d.status.length));

  let out = theme.bold("ADB Devices") + "\n";
  out += theme.fg("dim", "─".repeat(maxSerial + maxStatus + 30)) + "\n";

  for (const d of devices) {
    const info = [
      d.model && `model:${d.model}`,
      d.product && `product:${d.product}`,
      d.transport && `transport:${d.transport}`,
    ]
      .filter(Boolean)
      .join(" ");

    out +=
      theme.fg("accent", d.serial.padEnd(maxSerial + 2)) +
      theme.fg(statusColor(d.status), d.status.padEnd(maxStatus + 2)) +
      theme.fg("muted", info) +
      "\n";
  }

  return out;
}

export function renderPortRulesTable(rules: AdbPortRule[], theme: Theme): string {
  if (rules.length === 0) return theme.fg("muted", "No active port rules.");

  const maxSerial = Math.max(8, ...rules.map((r) => r.serial.length));
  const maxLocal = Math.max(8, ...rules.map((r) => r.local.length));

  let out = theme.bold("ADB Port Rules") + "\n";
  out += theme.fg("dim", "─".repeat(maxSerial + maxLocal + 20)) + "\n";

  for (const r of rules) {
    out +=
      theme.fg("accent", r.serial.padEnd(maxSerial + 2)) +
      theme.fg("success", r.local.padEnd(maxLocal + 2)) +
      theme.fg("muted", r.remote) +
      "\n";
  }

  return out;
}

export function renderAdbCall(args: { action?: string; device?: string }, theme: Theme): Text {
  const text =
    theme.fg("toolTitle", theme.bold("adb ")) +
    theme.fg("accent", args.action ?? "") +
    (args.device ? ` ${theme.fg("muted", "-s")} ${theme.fg("accent", args.device)}` : "");
  return new Text(text, 0, 0);
}

function resultText(result: AdbToolResult): string {
  if (typeof result.content === "string") return result.content;
  if (Array.isArray(result.content)) {
    return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
  }
  return "";
}

export function renderAdbResult(
  result: AdbToolResult,
  options: { expanded: boolean; isPartial: boolean },
  theme: Theme
): Text {
  if (options.isPartial) {
    return new Text(theme.fg("warning", "Running adb..."), 0, 0);
  }

  const content = resultText(result);

  if (options.expanded) {
    return new Text(content || theme.fg("success", "Done"), 0, 0);
  }

  const args = result.details?.args ?? [];
  const sIndex = args.indexOf("-s");
  const action = sIndex >= 0 ? args[sIndex + 2] : args[0];

  if (action === "devices") {
    return new Text(renderDevicesTable(parseDevices(content), theme), 0, 0);
  }

  if (action === "list-forward" || action === "list-reverse") {
    return new Text(renderPortRulesTable(parsePortRules(content), theme), 0, 0);
  }

  const success = result.isError !== true;
  const firstLine = content.split("\n")[0] ?? "";
  const summary = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;

  return new Text(
    success
      ? theme.fg("success", "✓ ") + theme.fg("muted", summary || "Done")
      : theme.fg("error", "✗ ") + theme.fg("error", summary || "Failed"),
    0,
    0
  );
}
