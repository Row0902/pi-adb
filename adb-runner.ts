export type AdbAction =
  | "devices"
  | "pair"
  | "connect"
  | "disconnect"
  | "install"
  | "sideload"
  | "uninstall"
  | "shell"
  | "screencap"
  | "logcat"
  | "push"
  | "pull"
  | "forward"
  | "reverse"
  | "list-forward"
  | "list-reverse"
  | "reboot"
  | "root"
  | "tcpip"
  | "usb"
  | "bugreport"
  | "tap"
  | "swipe"
  | "type"
  | "key"
  | "ui";

export interface AdbParams {
  action: AdbAction;
  device?: string;
  target?: string;
  source?: string;
  destination?: string;
  command?: string;
  replace?: boolean;
  keepData?: boolean;
  allowTest?: boolean;
  clear?: boolean;
  duration?: number;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  text?: string;
  key?: string;
}

export interface AdbDevice {
  serial: string;
  status: string;
  name?: string;
  product?: string;
  model?: string;
  device?: string;
  transport?: string;
}

export interface AdbPortRule {
  serial: string;
  local: string;
  remote: string;
}

const INPUT_ACTIONS = new Set(["tap", "swipe", "type", "key"]);

export function buildAdbArgs(params: AdbParams): string[] {
  const { action, device, target, source, destination, command } = params;

  const adbArgs: string[] = [];
  if (device) adbArgs.push("-s", device);
  if (!INPUT_ACTIONS.has(action) && action !== "ui") adbArgs.push(action);

  switch (action) {
    case "devices":
      adbArgs.push("-l");
      break;
    case "pair":
      if (!target) throw new Error("pair requires target (host:port)");
      adbArgs.push(target);
      if (source) adbArgs.push(source);
      break;
    case "connect":
      if (!target) throw new Error("connect requires target (host:port)");
      adbArgs.push(target);
      break;
    case "disconnect":
      if (target) adbArgs.push(target);
      break;
    case "install":
      if (!source) throw new Error("install requires source (APK path)");
      if (params.replace) adbArgs.push("-r");
      if (params.allowTest) adbArgs.push("-t");
      adbArgs.push(source);
      break;
    case "sideload":
      if (!source) throw new Error("sideload requires source (OTA zip path)");
      adbArgs.push(source);
      break;
    case "uninstall":
      if (!target) throw new Error("uninstall requires target (package name)");
      if (params.keepData) adbArgs.push("-k");
      adbArgs.push(target);
      break;
    case "shell":
      if (!command) throw new Error("shell requires command");
      adbArgs.push(command);
      break;
    case "logcat":
      if (target) adbArgs.push(target);
      break;
    case "push":
      if (!source) throw new Error("push requires source (local path)");
      if (!target) throw new Error("push requires target (remote path)");
      adbArgs.push(source, target);
      break;
    case "pull":
      if (!target) throw new Error("pull requires target (remote path)");
      adbArgs.push(target);
      if (destination) adbArgs.push(destination);
      break;
    case "forward":
      if (!target) throw new Error("forward requires target (local spec, e.g. tcp:8080)");
      if (!source) throw new Error("forward requires source (remote spec, e.g. tcp:8080)");
      adbArgs.push(target, source);
      break;
    case "reverse":
      if (!target) throw new Error("reverse requires target (remote spec, e.g. tcp:8080)");
      if (!source) throw new Error("reverse requires source (local spec, e.g. tcp:8080)");
      adbArgs.push(target, source);
      break;
    case "list-forward":
    case "list-reverse":
      adbArgs.push("--list");
      break;
    case "reboot":
      if (target) adbArgs.push(target);
      break;
    case "root":
      break;
    case "tcpip":
      if (target) adbArgs.push(target);
      break;
    case "usb":
      break;
    case "bugreport":
      if (target) adbArgs.push(target);
      break;
    case "screencap":
      break;
    case "tap": {
      if (params.x === undefined || params.y === undefined) {
        throw new Error("tap requires x and y (device pixel coordinates)");
      }
      adbArgs.push("shell", "input", "tap", String(params.x), String(params.y));
      break;
    }
    case "swipe": {
      const coords = [params.x, params.y, params.x2, params.y2];
      if (coords.some((v) => v === undefined)) {
        throw new Error("swipe requires x, y, x2 and y2 (device pixel coordinates)");
      }
      adbArgs.push("shell", "input", "swipe", ...coords.map(String));
      if (params.duration) adbArgs.push(String(params.duration));
      break;
    }
    case "type": {
      if (!params.text) throw new Error("type requires text");
      adbArgs.push("shell", "input", "text", params.text.replace(/ /g, "%s"));
      break;
    }
    case "key": {
      if (!params.key) throw new Error("key requires key (e.g. BACK, HOME)");
      adbArgs.push("shell", "input", "keyevent", `KEYCODE_${params.key}`);
      break;
    }
    case "ui":
      break;
  }

  return adbArgs;
}

const DEVICE_STATUSES = new Set(["device", "offline", "unauthorized", "recovery", "sideload", "bootloader"]);

export function parseDevices(output: string): AdbDevice[] {
  const lines = output.split("\n").filter((l) => l.trim());
  const devices: AdbDevice[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const serial = parts[0];
    const status = parts[1] ?? "";
    if (!serial || !DEVICE_STATUSES.has(status)) continue;

    const meta: Record<string, string> = {};
    for (let i = 2; i < parts.length; i++) {
      const kv = parts[i]?.split(":");
      if (kv && kv.length === 2) meta[kv[0]!] = kv[1]!;
    }

    devices.push({
      serial,
      status,
      name: meta["name"],
      product: meta["product"],
      model: meta["model"],
      device: meta["device"],
      transport: meta["transport"],
    });
  }

  return devices;
}

export function appendDeviceNames(output: string, devices: AdbDevice[]): string {
  const named = devices.filter((d) => d.name);
  if (named.length === 0) return output;

  const lines = named.map((d) => `- ${d.model ?? d.serial}: ${d.name}`);
  return output.trimEnd() + "\n\nDevice names:\n" + lines.join("\n");
}

export function parsePortRules(output: string): AdbPortRule[] {
  const lines = output.split("\n").filter((l) => l.trim());
  const rules: AdbPortRule[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    const [serial, local, remote] = parts;
    if (!serial || !local || !remote) continue;
    rules.push({ serial, local, remote });
  }

  return rules;
}
