import * as dgram from "node:dgram";
import { HostSyncPacket, KEY_FLAG_FILLED, KEY_FLAG_EDITING, KEY_FLAG_FOCUSED } from "./protocol/messages.js";

async function main() {
  const socket = dgram.createSocket("udp4");
  const targetHost = process.env.SNOWBALL_DEVICE_IP || "192.168.1.248";
  const targetPort = 7701;

  console.log(`[VerifySync] Sending V2 test sync frame to ${targetHost}:${targetPort}...`);

  const keys = [
    // Row 0: K17 (Machine), K13 (Harness), K9 (Project - EDITING!), K5 (Session), K1 (New)
    { id: 17, top: "MACHINE", main: "DEV-PC", sub: "", flags: KEY_FLAG_FILLED },
    { id: 13, top: "HARNESS", main: "Codex", sub: "", flags: KEY_FLAG_FILLED },
    { id: 9,  top: "PROJECT", main: "Snowball", sub: "", flags: KEY_FLAG_FILLED | KEY_FLAG_EDITING }, // AMBER BORDER & EDITING TAG!
    { id: 5,  top: "SESSION", main: "DualKnob", sub: "", flags: KEY_FLAG_FILLED },
    { id: 1,  top: "ACTION",  main: "New", sub: "", flags: 0 },

    // Row 1: Model, Effort, Access, Files, Settings
    { id: 18, top: "MODEL",   main: "o3-mini", sub: "", flags: KEY_FLAG_FILLED },
    { id: 14, top: "EFFORT",  main: "high", sub: "", flags: KEY_FLAG_FILLED },
    { id: 10, top: "ACCESS",  main: "on-req", sub: "", flags: KEY_FLAG_FILLED },
    { id: 6,  top: "VIEW",    main: "Files", sub: "", flags: 0 },
    { id: 2,  top: "SYSTEM",  main: "Settings", sub: "", flags: 0 },

    // Row 2: Choices for Project
    { id: 19, top: "ITEM 1",  main: "Snowball", sub: "", flags: KEY_FLAG_FILLED | KEY_FLAG_FOCUSED },
    { id: 15, top: "ITEM 2",  main: "GnuNae", sub: "", flags: 0 },
    { id: 11, top: "ITEM 3",  main: "TwitterB", sub: "", flags: 0 },
    { id: 7,  top: "ITEM 4",  main: "MK20-Dev", sub: "", flags: 0 },
    { id: 3,  top: "ITEM 5",  main: "Docs", sub: "", flags: 0 },

    // Row 3: Actions
    { id: 20, top: "VOICE",   main: "Talk", sub: "", flags: 0 },
    { id: 16, top: "ACTION",  main: "Send", sub: "", flags: 0 },
    { id: 12, top: "AUDIO",   main: "Speak", sub: "", flags: 0 },
    { id: 8,  top: "",        main: "", sub: "", flags: 8 }, // Disabled
    { id: 4,  top: "ABORT",   main: "Stop", sub: "", flags: 0 },
  ];

  const packet: HostSyncPacket = {
    type: "v2_sync",
    seq: 42,
    viewMode: "editor",
    topTitle: "Editing: Project Selection",
    topSubtitle: "Rotate Left Knob to browse, Push to select",
    topBody: "Active project: Snowball_Control\nPath: E:\\developments\\projects\\Snowball_Control\nSelect target project from Row 3 keys.",
    topScroll: 0,
    volume: 85,
    isMuted: false,
    keys,
  };

  const buf = Buffer.from(JSON.stringify(packet), "utf-8");
  socket.send(buf, 0, buf.length, targetPort, targetHost, (err) => {
    if (err) console.error("Send error:", err);
    else console.log("[VerifySync] Frame sent successfully!");
    socket.close();
  });
}

main().catch(console.error);
