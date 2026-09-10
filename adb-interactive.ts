import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SelectItem } from "@earendil-works/pi-tui";
import { runAdb } from "./adb-exec";
import { parseDevices, type AdbAction, type AdbDevice, type AdbParams } from "./adb-runner";

export const ADB_ACTIONS: SelectItem[] = [
  { value: "devices", label: "devices", description: "List connected devices" },
  { value: "connect", label: "connect", description: "Connect to a device over Wi-Fi" },
  { value: "disconnect", label: "disconnect", description: "Disconnect Wi-Fi device(s)" },
  { value: "pair", label: "pair", description: "Pair a device over Wi-Fi" },
  { value: "install", label: "install", description: "Install an APK" },
  { value: "sideload", label: "sideload", description: "Sideload an OTA zip (recovery mode)" },
  { value: "uninstall", label: "uninstall", description: "Uninstall a package" },
  { value: "shell", label: "shell", description: "Run a shell command" },
  { value: "screencap", label: "screencap", description: "Capture a screenshot (returns image)" },
  { value: "logcat", label: "logcat", description: "Stream device logs" },
  { value: "push", label: "push", description: "Push a file to the device" },
  { value: "pull", label: "pull", description: "Pull a file from the device" },
  { value: "forward", label: "forward", description: "Forward a local port to device" },
  { value: "reverse", label: "reverse", description: "Reverse-forward a device port" },
  { value: "list-forward", label: "list-forward", description: "List active forwards" },
  { value: "list-reverse", label: "list-reverse", description: "List active reverse rules" },
  { value: "reboot", label: "reboot", description: "Reboot the device" },
  { value: "root", label: "root", description: "Restart adbd with root permissions" },
  { value: "tcpip", label: "tcpip", description: "Switch adbd to Wi-Fi (TCP/IP) mode" },
  { value: "usb", label: "usb", description: "Switch adbd back to USB mode" },
  { value: "bugreport", label: "bugreport", description: "Capture a full bug report" },
  { value: "tap", label: "tap", description: "Tap at device pixel coordinates" },
  { value: "swipe", label: "swipe", description: "Swipe between two points" },
  { value: "type", label: "type", description: "Type text into the focused field" },
  { value: "key", label: "key", description: "Send a key event (BACK, HOME, ...)" },
  { value: "ui", label: "ui", description: "Dump UI hierarchy with tap coordinates" },
];

const DEVICELESS_ACTIONS = new Set(["devices", "pair", "connect", "disconnect"]);

async function listOnlineDevices(pi: ExtensionAPI): Promise<AdbDevice[]> {
  const result = await pi.exec("adb", ["devices"], { timeout: 10000 });
  return parseDevices(result.stdout || "").filter((d) => d.status === "device");
}

export async function collectParams(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  action: string
): Promise<AdbParams | null> {
  const params: AdbParams = { action: action as AdbAction };

  if (!DEVICELESS_ACTIONS.has(action)) {
    const online = await listOnlineDevices(pi);
    if (online.length === 0) {
      ctx.ui.notify("No online devices found", "error");
      return null;
    }
    if (online.length > 1) {
      const labels = online.map((d) => (d.model ? `${d.serial} (${d.model})` : d.serial));
      const picked = await ctx.ui.select("Multiple devices — pick one:", labels);
      if (!picked) return null;
      params.device = picked.replace(/ \(.*\)$/, "");
    }
  }

  const ask = async (label: string, placeholder?: string): Promise<string | undefined> => {
    const val = await ctx.ui.input(label, placeholder);
    return val ?? undefined;
  };

  switch (action) {
    case "devices":
    case "list-forward":
    case "list-reverse":
    case "root":
    case "usb":
    case "screencap":
      break;
    case "pair":
      params.target = (await ask("Host:port (e.g. 192.168.1.5:42079):")) || undefined;
      params.source = (await ask("Pairing code:")) || undefined;
      break;
    case "connect":
      params.target = (await ask("Host:port (e.g. 192.168.1.5:5555):")) || undefined;
      break;
    case "disconnect":
      params.target =
        (await ask("Host:port (optional, Enter to disconnect all):")) || undefined;
      break;
    case "install": {
      params.source =
        (await ask("APK path:", "app/build/outputs/apk/debug/app-debug.apk")) || undefined;
      if (params.source) {
        params.replace = await ctx.ui.confirm(
          "Replace existing app?",
          "Use -r to reinstall over an existing installation"
        );
        params.allowTest = await ctx.ui.confirm(
          "Allow test packages?",
          "Use -t for test-only APKs"
        );
      }
      break;
    }
    case "sideload":
      params.source = (await ask("OTA zip path:", "ota-update.zip")) || undefined;
      break;
    case "uninstall": {
      params.target = (await ask("Package name:", "com.example.app")) || undefined;
      params.keepData = await ctx.ui.confirm(
        "Keep app data?",
        "Use -k to preserve data and cache directories"
      );
      break;
    }
    case "shell":
      params.command = (await ask("Shell command:", "pm list packages")) || undefined;
      break;
    case "logcat": {
      params.target = (await ask("Filter (optional, e.g. ActivityManager:D):")) || undefined;
      params.clear = await ctx.ui.confirm(
        "Clear log buffer first?",
        "Runs logcat -c before streaming to isolate fresh logs"
      );
      const durationRaw = await ask("Stream duration in seconds (optional, default 10, max 60):");
      const parsed = durationRaw ? Number.parseInt(durationRaw, 10) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) params.duration = parsed;
      break;
    }
    case "push":
      params.source = (await ask("Local path:")) || undefined;
      params.target = (await ask("Remote path:", "/sdcard/")) || undefined;
      break;
    case "pull":
      params.target = (await ask("Remote path:")) || undefined;
      params.destination = (await ask("Local destination:", ".")) || undefined;
      break;
    case "forward":
      params.target = (await ask("Local spec:", "tcp:8080")) || undefined;
      params.source = (await ask("Remote spec:", "tcp:8080")) || undefined;
      break;
    case "reverse":
      params.target = (await ask("Remote spec:", "tcp:8080")) || undefined;
      params.source = (await ask("Local spec:", "tcp:8080")) || undefined;
      break;
    case "reboot":
      params.target =
        (await ask("Reboot mode (optional: system/recovery/bootloader):")) || undefined;
      break;
    case "tcpip":
      params.target = (await ask("TCP/IP port (optional, default 5555):")) || undefined;
      break;
    case "bugreport":
      params.target = (await ask("Local output path (optional, e.g. bugreport.zip):")) || undefined;
      break;
    case "tap": {
      params.x = toInt(await ask("Tap X (device pixels, from 'ui' dump or screenshot):"));
      params.y = toInt(await ask("Tap Y:"));
      break;
    }
    case "swipe": {
      params.x = toInt(await ask("Start X:"));
      params.y = toInt(await ask("Start Y:"));
      params.x2 = toInt(await ask("End X:"));
      params.y2 = toInt(await ask("End Y:"));
      const ms = await ask("Duration in ms (optional, e.g. 300):");
      params.duration = toInt(ms);
      break;
    }
    case "type":
      params.text = (await ask("Text to type:")) || undefined;
      break;
    case "key":
      params.key = (await ask("Key (e.g. BACK, HOME, ENTER, DPAD_UP):")) || undefined;
      break;
    case "ui":
      break;
  }

  const missing = getMissingFields(action, params);
  if (missing.length > 0) {
    ctx.ui.notify(`Missing required fields: ${missing.join(", ")}`, "error");
    return null;
  }

  return params;
}

function toInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getMissingFields(action: string, params: AdbParams): string[] {
  const missing: string[] = [];
  switch (action) {
    case "pair":
      if (!params.target) missing.push("target (host:port)");
      if (!params.source) missing.push("source (pairing code)");
      break;
    case "connect":
      if (!params.target) missing.push("target (host:port)");
      break;
    case "install":
      if (!params.source) missing.push("source (APK path)");
      break;
    case "sideload":
      if (!params.source) missing.push("source (OTA zip path)");
      break;
    case "uninstall":
      if (!params.target) missing.push("target (package name)");
      break;
    case "shell":
      if (!params.command) missing.push("command");
      break;
    case "push":
      if (!params.source) missing.push("source (local path)");
      if (!params.target) missing.push("target (remote path)");
      break;
    case "pull":
      if (!params.target) missing.push("target (remote path)");
      break;
    case "forward":
      if (!params.target) missing.push("target (local spec)");
      if (!params.source) missing.push("source (remote spec)");
      break;
    case "reverse":
      if (!params.target) missing.push("target (remote spec)");
      if (!params.source) missing.push("source (local spec)");
      break;
    case "tap":
      if (params.x === undefined) missing.push("x (device pixels)");
      if (params.y === undefined) missing.push("y (device pixels)");
      break;
    case "swipe":
      if ([params.x, params.y, params.x2, params.y2].some((v) => v === undefined)) {
        missing.push("x, y, x2, y2 (device pixels)");
      }
      break;
    case "type":
      if (!params.text) missing.push("text");
      break;
    case "key":
      if (!params.key) missing.push("key");
      break;
  }
  return missing;
}

let lastDevices: AdbDevice[] = [];
let widgetEnabled = true;

interface WidgetTheme {
  fg: (color: string, text: string) => string;
}

function widgetLines(
  devices: AdbDevice[]
): (_tui: unknown, theme: WidgetTheme) => { render: () => string[]; invalidate: () => void } {
  return (_tui, theme) => {
    if (devices.length === 0) {
      return {
        render: () => [theme.fg("dim", "adb: no devices")],
        invalidate: () => {},
      };
    }
    const lines = devices.map((d) => {
      const color =
        d.status === "device" ? "success" : d.status === "offline" ? "error" : "warning";
      const label = d.name ?? (d.model ? `${d.serial} (${d.model})` : d.serial);
      return `${theme.fg(color, "●")} ${theme.fg("muted", label)}`;
    });
    return { render: () => lines, invalidate: () => {} };
  };
}

export function setDevicesWidget(ctx: ExtensionContext, devices: AdbDevice[]): void {
  if (!ctx.hasUI) return;
  lastDevices = devices;
  if (!widgetEnabled) return;
  ctx.ui.setWidget("adb-devices", widgetLines(devices));
}

export function clearDevicesWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  lastDevices = [];
  if (!widgetEnabled) return;
  ctx.ui.setWidget("adb-devices", widgetLines([]));
}

export function toggleDevicesWidget(ctx: ExtensionContext): boolean {
  widgetEnabled = !widgetEnabled;
  if (!ctx.hasUI) return widgetEnabled;
  if (widgetEnabled) {
    ctx.ui.setWidget("adb-devices", widgetLines(lastDevices));
  } else {
    ctx.ui.setWidget("adb-devices", undefined);
  }
  return widgetEnabled;
}

export async function refreshDevicesWidget(
  pi: ExtensionAPI,
  ctx: ExtensionContext
): Promise<void> {
  const { text, devices } = await runAdb(pi, { action: "devices" });
  setDevicesWidget(ctx, devices ?? parseDevices(text));
}
