import * as dgram from "node:dgram";
import { DeviceInputPacket, HostSyncPacket, KEY_FLAG_FILLED, KEY_FLAG_EDITING, KEY_FLAG_FOCUSED, KEY_FLAG_DISABLED, KEY_FLAG_LIST, KEY_FLAG_LINES } from "../protocol/messages.js";
import { ContextManager } from "../state/context.js";
import { EventEmitter } from "node:events";
import type { V2DeviceState } from "../types.js";

export class UdpTransport extends EventEmitter {
  private socket: dgram.Socket;
  private port: number;
  private targetHost: string = process.env.SNOWBALL_DEVICE_IP || "192.168.1.248";
  private targetPort: number = 7701;
  private syncSeq = 1;

  constructor(port = 7701, targetHost = process.env.SNOWBALL_DEVICE_IP || "192.168.1.248", targetPort = 7701) {
    super();
    this.port = port;
    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.socket = dgram.createSocket("udp4");

    this.socket.on("message", (msg, rinfo) => {
      this.handleIncoming(msg, rinfo);
    });

    this.socket.on("error", (err) => {
      console.error("[UDP] Socket error:", err);
    });
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.bind(this.port, "0.0.0.0", () => {
        console.log(`[UDP] Server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.close(() => resolve());
    });
  }

  private handleIncoming(msg: Buffer, rinfo: dgram.RemoteInfo) {
    // Record client address if from external device or test port
    if (rinfo.address !== "127.0.0.1" && rinfo.address !== "::1") {
      this.targetHost = rinfo.address;
      this.targetPort = rinfo.port;
    } else if (rinfo.port !== this.port) {
      this.targetHost = rinfo.address;
      this.targetPort = rinfo.port;
    }

    const str = msg.toString("utf-8").trim();
    try {
      const packet = JSON.parse(str) as DeviceInputPacket;
      this.emit("device_input", packet);
    } catch {
      // Could be raw legacy string e.g. "PING"
      if (str === "PING") {
        this.emit("device_input", { type: "ping" });
      }
    }
  }

  public sendSync(context: { getDeviceState(): V2DeviceState }) {
    const state = context.getDeviceState();

    const hostKeys = state.keys.map((k) => {
      let flags = 0;
      if (k.isFilled) flags |= KEY_FLAG_FILLED;
      if (k.isEditing) flags |= KEY_FLAG_EDITING;
      if (k.isFocused) flags |= KEY_FLAG_FOCUSED;
      if (k.isDisabled) flags |= KEY_FLAG_DISABLED;
      if (k.isLinesMode) {
        flags |= KEY_FLAG_LINES;
      } else if (k.items && k.items.length > 0) {
        flags |= KEY_FLAG_LIST;
      }

      const obj: any = {
        id: k.keyId,
        top: k.labelTop || "",
        main: k.labelMain || "",
        flags,
      };
      if (k.labelSub) obj.sub = k.labelSub;
      if (k.items && k.items.length > 0) {
        obj.items = k.items;
        obj.activeItem = k.activeItem ?? 0;
      }
      if (k.scrollTotal !== undefined) {
        obj.total = k.scrollTotal;
        obj.activeItem = k.activeItem ?? 0;
      }
      if (k.itemColors && k.itemColors.length > 0) {
        obj.colors = k.itemColors;
      }
      return obj;
    });

    const totalLines = state.topTotalLines || state.topBodyLines.length;
    const windowStart = Math.max(0, Math.min(state.topScrollLine, Math.max(0, totalLines - 1)));
    const windowEnd = Math.min(windowStart + 8, totalLines);
    const visibleLines = state.topBodyLines.slice(windowStart, windowEnd);

    const packet: HostSyncPacket = {
      type: "v2_sync",
      seq: this.syncSeq++,
      viewMode: state.viewMode,
      topTitle: state.topTitle,
      topSubtitle: state.topSubtitle,
      topBody: visibleLines.join("\n"),
      topScroll: state.topScrollLine,
      topTotalLines: totalLines,
      volume: state.volume,
      isMuted: state.isMuted,
      keys: hostKeys,
    };

    const buf = Buffer.from(JSON.stringify(packet), "utf-8");
    const defaultHost = process.env.SNOWBALL_DEVICE_IP || "192.168.1.248";
    // Always send to physical MK20 device
    this.socket.send(buf, 0, buf.length, 7701, defaultHost, (err) => {
      if (err) console.error("[UDP] Device send error:", err);
    });
    // Also send to last client address if different
    if (this.targetHost !== defaultHost || this.targetPort !== 7701) {
      this.socket.send(buf, 0, buf.length, this.targetPort, this.targetHost, (err) => {
        if (err) console.error("[UDP] Client send error:", err);
      });
    }
  }
}
