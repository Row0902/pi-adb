import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Text, SelectList } from "@earendil-works/pi-tui";
import { runAdb, type AdbImageBlock } from "./adb-exec";
import { type AdbAction, type AdbParams } from "./adb-runner";
import { renderAdbCall, renderAdbResult } from "./adb-render";
import {
  ADB_ACTIONS,
  clearDevicesWidget,
  collectParams,
  refreshDevicesWidget,
  setDevicesWidget,
  toggleDevicesWidget,
} from "./adb-interactive";
import { isProjectEnabled, setProjectEnabled } from "./adb-state";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "adb",
    label: "ADB",
    description:
      "Android Debug Bridge tool. List devices (with commercial names), pair/connect/disconnect over Wi-Fi, " +
      "install/uninstall APKs, run shell commands, capture screenshots and logs, transfer files, " +
      "manage port forwarding, reboot, root, and capture bug reports.",
    promptSnippet:
      "Control Android devices via ADB: list, pair, connect, disconnect, install, sideload, " +
      "uninstall, shell, screencap, logcat, push, pull, forward, reverse, list-forward, " +
      "list-reverse, reboot, root, tcpip, usb, bugreport",
    promptGuidelines: [
      "Use adb with action='devices' to list connected Android devices with their commercial names before other operations.",
      "Use adb with action='pair' to pair a device over Wi-Fi (requires target=host:port and source=pairing_code).",
      "Use adb with action='connect' to connect to a paired device over Wi-Fi (requires target=host:port).",
      "Use adb with action='disconnect' to disconnect Wi-Fi device(s) (optionally target=host:port; omit for all).",
      "Use adb with action='install' to install an APK file on a device (requires source=path-to-apk; " +
        "set replace=true for -r, allowTest=true for -t test packages).",
      "Use adb with action='sideload' to install an OTA update zip while the device is in " +
        "recovery/sideload mode (requires source=path-to-zip).",
      "Use adb with action='uninstall' to remove a package by its package name (requires target=package.name; " +
        "set keepData=true to preserve app data with -k).",
      "Use adb with action='shell' to run shell commands on the device (requires command).",
      "Use adb with action='screencap' to capture a device screenshot; returns the PNG as an attached " +
        "image plus a local file path.",
      "Use adb with action='logcat' to stream device logs for `duration` seconds (default 10, max 60); " +
        "optionally set target as filter and clear=true to run logcat -c first.",
      "Use adb with action='push' to copy a local file to the device (requires source and target).",
      "Use adb with action='pull' to copy a file from the device to the host (requires target; optionally destination).",
      "Use adb with action='forward' to forward a local port to the device (target=local_spec, source=remote_spec).",
      "Use adb with action='reverse' to reverse-forward a device port to the host (target=remote_spec, source=local_spec).",
      "Use adb with action='list-forward' to list active port forwards.",
      "Use adb with action='list-reverse' to list active reverse port rules.",
      "Use adb with action='reboot' to reboot the device (optionally target=system|recovery|bootloader).",
      "Use adb with action='root' to restart adbd with root permissions.",
      "Use adb with action='tcpip' to restart adbd in Wi-Fi (TCP/IP) mode (optionally target=port, default 5555).",
      "Use adb with action='usb' to restart adbd in USB mode.",
      "Use adb with action='bugreport' to capture a full bug report (optionally target=local output path; takes several minutes).",
      "When no device serial is given, the tool auto-detects the single connected device; pass device only with multiple devices.",
    ],
    parameters: Type.Object({
      action: StringEnum([
        "devices",
        "pair",
        "connect",
        "disconnect",
        "install",
        "sideload",
        "uninstall",
        "shell",
        "screencap",
        "logcat",
        "push",
        "pull",
        "forward",
        "reverse",
        "list-forward",
        "list-reverse",
        "reboot",
        "root",
        "tcpip",
        "usb",
        "bugreport",
      ] as const),
      device: Type.Optional(
        Type.String({
          description:
            "Device serial number. Auto-detected when exactly one device is connected; " +
            "required when multiple devices are connected.",
        })
      ),
      target: Type.Optional(
        Type.String({
          description:
            "Target host:port for pair/connect/disconnect, package name for uninstall, remote path for push/pull, " +
            "logcat filter, local spec for forward, remote spec for reverse, reboot mode, " +
            "TCP/IP port for tcpip, or local output path for bugreport.",
        })
      ),
      source: Type.Optional(
        Type.String({
          description:
            "Local APK path for install, local file path for push, pairing code for pair, " +
            "remote spec for forward, or local spec for reverse.",
        })
      ),
      destination: Type.Optional(Type.String({ description: "Local destination path for pull." })),
      command: Type.Optional(
        Type.String({ description: "Shell command to execute when action='shell'." })
      ),
      replace: Type.Optional(
        Type.Boolean({
          description: "Reinstall/replace an existing app with -r (action='install').",
        })
      ),
      keepData: Type.Optional(
        Type.Boolean({
          description: "Preserve app data and cache with -k (action='uninstall').",
        })
      ),
      allowTest: Type.Optional(
        Type.Boolean({
          description: "Allow test-only packages with -t (action='install').",
        })
      ),
      clear: Type.Optional(
        Type.Boolean({
          description: "Clear the log buffer (logcat -c) before streaming (action='logcat').",
        })
      ),
      duration: Type.Optional(
        Type.Integer({
          minimum: 1,
          maximum: 60,
          description: "Logcat stream duration in seconds (default 10, max 60).",
        })
      ),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const { text, args, image, devices } = await runAdb(pi, params, signal, onUpdate);

      if (devices) {
        setDevicesWidget(ctx, devices);
      }

      const content: Array<AdbImageBlock | { type: "text"; text: string }> = image
        ? [image, { type: "text", text }]
        : [{ type: "text", text }];

      return {
        content,
        details: { args, exitCode: 0, devices },
      };
    },

    renderCall(args, theme, _context) {
      return renderAdbCall(args, theme);
    },

    renderResult(result, options, theme, _context) {
      return renderAdbResult(result, options, theme);
    },
  });

  pi.registerCommand("adb", {
    description: "Interactive ADB operations (/adb enable | /adb disable to toggle per project)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/adb requires TUI mode", "error");
        return;
      }

      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "enable" || sub === "disable") {
        const enabled = sub === "enable";
        await setProjectEnabled(ctx.cwd, enabled);
        applyEnabled(pi, enabled);
        if (!enabled) clearDevicesWidget(ctx);
        ctx.ui.notify(`ADB ${enabled ? "enabled" : "disabled"} for ${ctx.cwd}`, "info");
        return;
      }
      if (sub) {
        ctx.ui.notify(`Unknown subcommand "${sub}". Use /adb, /adb enable or /adb disable.`, "warning");
        return;
      }

      if (!(await isProjectEnabled(ctx.cwd))) {
        ctx.ui.notify("ADB is disabled for this project — run /adb enable first.", "warning");
        return;
      }

      const action = await pickAction(ctx);
      if (!action) return;

      const params = await collectParams(pi, ctx, action);
      if (!params) return;

      ctx.ui.setStatus("adb", ctx.ui.theme.fg("accent", `● adb ${action}`));

      try {
        const { devices } = await runAdb(pi, params);

        if (devices) {
          setDevicesWidget(ctx, devices);
          ctx.ui.notify(`${devices.length} device(s) connected`, "info");
        } else {
          ctx.ui.notify(`adb ${action} completed`, "info");
        }
      } catch (err) {
        ctx.ui.notify(`adb ${action} failed: ${(err as Error).message}`, "error");
      } finally {
        ctx.ui.setStatus("adb", undefined);
      }
    },
  });

  pi.registerCommand("adb-widget", {
    description: "Toggle the ADB devices widget",
    handler: async (_args, ctx) => {
      const enabled = toggleDevicesWidget(ctx);
      ctx.ui.notify(`ADB widget ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    const enabled = await isProjectEnabled(ctx.cwd);
    applyEnabled(pi, enabled);
    if (enabled) {
      await refreshDevicesWidget(pi, ctx).catch(() => {});
    } else {
      clearDevicesWidget(ctx);
    }
  });
}

function applyEnabled(pi: ExtensionAPI, enabled: boolean): void {
  const active = pi.getActiveTools();
  const has = active.includes("adb");
  if (enabled && !has) pi.setActiveTools([...active, "adb"]);
  if (!enabled && has) pi.setActiveTools(active.filter((n) => n !== "adb"));
}

async function pickAction(ctx: ExtensionContext): Promise<string | null> {
  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold("ADB — Choose action")), 1, 0));

    const list = new SelectList(ADB_ACTIONS, Math.min(ADB_ACTIONS.length, 10), {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
    });
    list.onSelect = (item) => done(item.value);
    list.onCancel = () => done(null);
    container.addChild(list);
    container.addChild(
      new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel"), 1, 0)
    );
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        list.handleInput(data);
        tui.requestRender();
      },
    };
  });
}
