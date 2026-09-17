import * as path from "node:path";
import * as os from "node:os";
import { existsSync } from "node:fs";
import { CodexAdapter } from "./codex/adapter.js";
import { CodexDesktopClient } from "./codex/desktop.js";
import { ContextManager } from "./state/context.js";
import { UdpTransport } from "./transport/udp.js";
import { DeviceInputPacket } from "./protocol/messages.js";
import { VoiceDraft } from "./audio/draft.js";
import { LocalWhisperProvider } from "./audio/local-whisper.js";
import { MeshRouter } from "./peer/mesh.js";
import { CodexHarness } from "./harness/codex.js";
import { AntigravityAdapter } from "./harness/antigravity.js";
import { OpenCodeAdapter } from "./harness/opencode.js";
import { AgentHarness } from "./harness/types.js";
import { GitProvider } from "./vcs/git.js";

async function main() {
  console.log("=== Snowball Control Host (V2 - Multi-Harness & Mesh) ===");

  const context = new ContextManager();
  const voiceDraft = new VoiceDraft();
  const deviceIp = process.env.SNOWBALL_DEVICE_IP || "192.168.1.248";
  const udp = new UdpTransport(7701, deviceIp, 7701);
  await udp.start();
  const codex = new CodexAdapter();
  const desktop = new CodexDesktopClient();
  const nativeVoice = new LocalWhisperProvider();

  // Multi-machine mesh & multi-harness setup
  const mesh = new MeshRouter({
    localId: "dev-pc",
    localName: os.hostname(),
    port: 7702,
  });

  const codexHarness = new CodexHarness(codex);
  const antigravity = new AntigravityAdapter();
  const opencode = new OpenCodeAdapter({ autoSpawn: true });

  mesh.registerHarness(codexHarness);
  mesh.registerHarness(antigravity);
  mesh.registerHarness(opencode);

  let activeApprovalHarness: AgentHarness | null = null;

  const shutdown = async () => {
    try { nativeVoice.close(); } catch {}
    try { udp.stop(); } catch {}
    try { await mesh.stop(); } catch {}
    try { await antigravity.stop(); } catch {}
    try { await opencode.stop(); } catch {}
    try { await codexHarness.stop(); } catch {}
  };
  process.on("SIGINT", () => { void shutdown().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { void shutdown().then(() => process.exit(0)); });
  process.on("exit", () => { void shutdown(); });

  try {
    await mesh.start();
    console.log("[Main] Peer mesh router started on port 7702.");
  } catch (err: any) {
    console.warn("[Main] Peer mesh router start error:", err.message);
  }

  // Start Antigravity adapter if available
  try {
    if (await antigravity.isAvailable()) {
      await antigravity.start();
      console.log("[Main] Antigravity harness started.");
      const agProjects = await antigravity.listProjects();
      if (agProjects.length) {
        context.projectsByScope["dev-pc/antigravity"] = agProjects;
        for (const p of agProjects) {
          const agSessions = await antigravity.listSessions(p.id);
          if (agSessions.length) {
            context.sessionsByScope[`dev-pc/antigravity/${p.id}`] = agSessions;
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("[Main] Antigravity harness initialization warning:", err.message);
  }

  // Start OpenCode adapter if available
  try {
    if (await opencode.isAvailable()) {
      await opencode.start();
      console.log("[Main] OpenCode harness started.");
      const ocProjects = await opencode.listProjects();
      if (ocProjects.length) {
        context.projectsByScope["dev-pc/opencode"] = ocProjects;
        for (const p of ocProjects) {
          const ocSessions = await opencode.listSessions(p.id);
          if (ocSessions.length) {
            context.sessionsByScope[`dev-pc/opencode/${p.id}`] = ocSessions;
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("[Main] OpenCode harness initialization warning:", err.message);
  }

  let desktopActive = false;
  try {
    console.log("[Main] Checking for active Codex Desktop instance...");
    desktopActive = process.env.SNOWBALL_DESKTOP_EXPERIMENTAL === "1" ? await desktop.connect() : false;
    if (desktopActive) {
      console.log("[Main] Connected to Codex Desktop owner IPC!");

      // Discover real projects registered in Codex Desktop
      const dProjects = await desktop.listProjects();
      if (dProjects.length > 0) {
        console.log(`[Main] Discovered ${dProjects.length} projects from Codex Desktop.`);
        context.projectsByScope["dev-pc/codex"] = dProjects.map((p) => ({
          id: p.projectId,
          name: p.label.slice(0, 10),
          path: p.path || p.label,
        }));
      }

      // Discover real threads from Codex Desktop
      const dThreads = await desktop.listThreads(15);
      if (dThreads.length > 0) {
        console.log(`[Main] Discovered ${dThreads.length} threads from Codex Desktop.`);
        const curProj = context.getCurrentProject();
        const curProjKey = `dev-pc/codex/${curProj.id}`;
        context.sessionsByScope[curProjKey] = dThreads.map((t, idx) => {
          const asciiTitle = (t.title || "").replace(/[^\x20-\x7E]/g, "").trim();
          const cleanTitle = asciiTitle.length > 2 ? asciiTitle.slice(0, 14) : `Task ${idx + 1}`;
          return {
            id: t.id,
            title: cleanTitle,
            createdAt: t.updatedAt,
            preview: t.title,
          };
        });
        context.sessionsByScope["dev-pc/codex/snowball"] = context.sessionsByScope[curProjKey];
        context.updateReaderForCurrentSession();
      }

      // Inspect usage limits
      const limits = await desktop.getUsageLimits();
      if (limits) {
        console.log(`[Main] Codex Live Rate Limits: 5-hr=${limits.primary.usedPercent}%, weekly=${limits.secondary.usedPercent}%`);
      }
    }
  } catch (err) {
    console.warn("[Main] Desktop owner connection failed, falling back to CLI app-server:", err);
  }

  // 2. Start fallback Codex CLI app-server if desktop is not handling CLI execution
  try {
    console.log("[Main] Connecting to Codex CLI app-server...");
    await codex.start();
    console.log("[Main] Codex app-server connected successfully.");

    if (!desktopActive) {
      const projs = await codexHarness.listProjects();
      if (projs.length) {
        context.projectsByScope["dev-pc/codex"] = projs;
        for (const pr of projs) {
          const sess = await codexHarness.listSessions(pr.id);
          context.sessionsByScope[`dev-pc/codex/${pr.id}`] = sess;
        }
        context.updateReaderForCurrentSession();
      }
    }
  } catch (err) {
    console.warn("[Main] Warning: Could not connect to Codex app-server immediately:", err);
  }

  async function loadCurrentSessionTurns() {
    const h = context.getCurrentHarness();
    const curSess = context.getCurrentSession();
    if (curSess && curSess.id && curSess.id !== "none") {
      try {
        const harness = [codexHarness, antigravity, opencode].find((hn) => hn.id === h.id);
        if (harness && typeof harness.getTurns === "function") {
          const turns = await harness.getTurns(curSess.id);
          context.setSessionTurns(turns);
          udp.sendSync(context);
          return;
        }
      } catch (e: any) {
        console.warn(`[Main] Failed to load turns for ${curSess.id}:`, e.message);
      }
    }
    context.setSessionTurns([]);
    udp.sendSync(context);
  }

  async function refreshCurrentScope() {
    const m = context.getCurrentMachine();
    const h = context.getCurrentHarness();
    const scopeKey = `${m.id}/${h.id}`;

    try {
      const projects = await mesh.listProjects(m.id, h.id);
      if (projects && projects.length > 0) {
        context.projectsByScope[scopeKey] = projects;
        if (context.selectedProjectIdx >= projects.length) {
          context.selectedProjectIdx = 0;
        }
      }
    } catch (e: any) {
      console.warn(`[Main] Failed to list projects for ${scopeKey}:`, e.message);
    }

    const curProj = context.getCurrentProject();
    if (curProj) {
      const sessKey = `${scopeKey}/${curProj.id}`;
      try {
        const sessions = await mesh.listSessions(m.id, h.id, curProj.id);
        if (sessions && sessions.length > 0) {
          context.sessionsByScope[sessKey] = sessions;
          if (context.selectedSessionIdx >= sessions.length) {
            context.selectedSessionIdx = 0;
          }
        }
      } catch (e: any) {
        console.warn(`[Main] Failed to list sessions for ${sessKey}:`, e.message);
      }
    }

    await loadCurrentSessionTurns();
    context.updateReaderForCurrentSession();
    udp.sendSync(context);
  }

  // Initial scope and session turns refresh
  await refreshCurrentScope();

  // Handle streaming deltas from all harnesses
  function handleStreamDelta(source: string, sessionId: string, content: string) {
    console.log(`[${source}] Delta: ${content}`);
    if (context.getCurrentMachine().id !== "dev-pc" ||
        context.getCurrentHarness().id !== source.toLowerCase() ||
        context.getCurrentSession().id !== sessionId ||
        context.viewMode !== "session" || context.activeEditor !== "none" ||
        context.isRecordingVoice || context.isTranscribingVoice || context.voiceDraftText) return;
    context.readerLines.push(content);
    udp.sendSync(context);
  }

  codexHarness.on("delta", (d) => handleStreamDelta("Codex", d.sessionId, d.content));
  antigravity.on("delta", (d) => handleStreamDelta("Antigravity", d.sessionId, d.content));
  opencode.on("delta", (d) => handleStreamDelta("OpenCode", d.sessionId, d.content));

  // Handle approvals from any harness
  function handleApproval(harness: AgentHarness, app: any) {
    console.log(`[${harness.name}] Incoming approval request:`, app);
    activeApprovalHarness = harness;
    context.viewMode = "question";
    context.activeQuestion = {
      id: app.id,
      prompt: app.prompt || "Approval Required",
      isMultiSelect: false,
      hasOther: false,
      isPermission: true,
      options: app.options && app.options.length ? app.options : [
        { id: "approve", label: "Approve and Execute", isSelected: true },
        { id: "deny", label: "Deny Command", isSelected: false },
      ],
    };
    context.readerTitle = `${harness.name} Approval`;
    context.readerSubtitle = "Select option & press K16";
    context.readerLines = [
      app.prompt || "Agent requested execution permission.",
      "",
      "Use knob to choose, K16 to submit.",
    ];
    udp.sendSync(context);
  }

  codexHarness.on("approval_request", (app) => handleApproval(codexHarness, app));
  antigravity.on("approval_request", (app) => handleApproval(antigravity, app));
  opencode.on("approval_request", (app) => handleApproval(opencode, app));

  // Handle Device Input from MK20
  udp.on("device_input", (packet: DeviceInputPacket) => {
    if (packet.type === "ping") {
      udp.sendSync(context);
      return;
    }

    if (packet.type === "knob_left") {
      if (packet.isClick) {
        const wasEditor = context.activeEditor;
        context.onLeftKnobClick();
        if (wasEditor === "project" || wasEditor === "harness" || wasEditor === "machine") {
          refreshCurrentScope();
        } else if (wasEditor === "session") {
          loadCurrentSessionTurns();
        }
      } else if (packet.delta) {
        context.onLeftKnob(packet.delta);
      }
      udp.sendSync(context);
      return;
    }

    if (packet.type === "knob_right") {
      if (packet.isClick) {
        context.onRightKnobClick();
      } else if (packet.delta) {
        context.onRightKnob(packet.delta);
      }
      udp.sendSync(context);
      return;
    }

    if (packet.type === "key" && packet.isDown && packet.keyId) {
      const kid = packet.keyId;
      handleKeyPress(kid);
      udp.sendSync(context);
    }
  });

  function handleKeyPress(kid: number) {
    console.log(`[Main] Key pressed: K${kid}`);
    const key = context.getDeviceState().keys.find(k => k.keyId === kid);
    if (!key || key.isDisabled) return;

    // Files / Settings Fullscreen Modal Navigation
    if (context.viewMode === "workspace") {
      if (kid === 17) {
        // K17 Files/Close anchor: exit modal
        context.viewMode = "session";
        context.updateReaderForCurrentSession();
        return;
      }
      if (kid === 13) {
        // Up directory
        context.workspaceScrollRow = 0;
        return;
      }
      if (kid === 9) {
        // Prev row
        context.onLeftKnob(-1);
        return;
      }
      if (kid === 5) {
        // Next row
        context.onLeftKnob(+1);
        return;
      }
      if (kid === 1) {
        // K1: Agent Stop button in Files (Workspace) modal
        console.log("[Main] Agent STOP pressed from Files modal!");
        const curM = context.getCurrentMachine();
        const curH = context.getCurrentHarness();
        const curSess = context.getCurrentSession();
        if (curSess?.id && curSess.id !== "none") {
          mesh.interrupt(curM.id, curH.id, curSess.id).catch(console.error);
        }
        context.viewMode = "session";
        context.readerTitle = "Turn Stopped";
        context.readerSubtitle = "Interrupted from Files modal";
        context.readerLines = [
          "[AGENT TURN STOPPED]",
          "Stop signal dispatched to active agent.",
          "",
          "Returned to session surface.",
        ];
        context.updateReaderForCurrentSession();
        return;
      }
    }

    if (context.viewMode === "workspace") return;
    if (context.viewMode === "settings") {
      if (kid === 17) {
        context.viewMode = "session";
        context.updateReaderForCurrentSession();
      }
      return;
    }

    if (context.viewMode === "changes") {
      if (kid === 17 || kid === 1 || kid === 7) {
        context.viewMode = "session";
        context.updateReaderForCurrentSession();
        return;
      }
      if (kid === 9) {
        context.pageChangesFiles(-1);
        return;
      }
      if (kid === 5) {
        context.pageChangesFiles(+1);
        return;
      }
      if (kid === 18 || kid === 19 || kid === 20) {
        const slot = kid === 18 ? 0 : kid === 19 ? 1 : 2;
        const fileIdx = context.changesFilePage * 3 + slot;
        if (fileIdx < context.changedFiles.length) {
          const f = context.changedFiles[fileIdx];
          const curP = context.getCurrentProject();
          GitProvider.getFileDiff(f.path, curP.path || process.cwd()).then((diffLines) => {
            context.selectChangesFile(fileIdx, diffLines);
            udp.sendSync(context);
          }).catch(console.error);
        }
        return;
      }
      return;
    }

    // Question view handling
    if (context.viewMode === "question" && context.activeQuestion) {
      // Row 0: Option 1
      if ([17, 13, 9, 5, 1].includes(kid)) {
        selectQuestionOption(0);
        return;
      }
      // Row 1: Option 2
      if ([18, 14, 10, 6, 2].includes(kid)) {
        selectQuestionOption(1);
        return;
      }
      // Row 2: Option 3
      if ([19, 15, 11, 7, 3].includes(kid)) {
        selectQuestionOption(2);
        return;
      }
      // Row 3: Submit (K16), Later (K8), Stop (K4)
      if (kid === 16) {
        // Submit
        console.log("[Main] Submitting question/permission answer...");
        const selectedOpt = context.activeQuestion.options.find((o) => o.isSelected);
        if (selectedOpt && context.activeQuestion.isPermission) {
          const decision = selectedOpt.id === "deny" ? "deny" : "allow";
          if (activeApprovalHarness) {
            activeApprovalHarness.respondApproval(context.activeQuestion.id, decision).catch(console.error);
          } else {
            codex.respondServerRequest(context.activeQuestion.id, {
              decision: selectedOpt.id === "deny" ? "denied" : "approved",
            });
          }
        }
        context.viewMode = "session";
        context.activeQuestion = undefined;
        context.updateReaderForCurrentSession();
        return;
      }
      if (kid === 8) {
        // Later
        context.viewMode = "session";
        context.updateReaderForCurrentSession();
        return;
      }
      if (kid === 4) {
        // Stop
        context.viewMode = "session";
        context.activeQuestion = undefined;
        context.updateReaderForCurrentSession();
        return;
      }
      return;
    }

    // Default session layout
    // Row 0: Context
    if (kid === 17) {
      context.cycleMachine();
      refreshCurrentScope();
    } else if (kid === 13) {
      context.cycleHarness();
      refreshCurrentScope();
    } else if (kid === 9) context.openEditor("project");
    else if (kid === 5) context.openEditor("session");
    else if (kid === 1) {
      // New session
      const curM = context.getCurrentMachine();
      const curH = context.getCurrentHarness();
      const curP = context.getCurrentProject();
      const harness = [codexHarness, antigravity, opencode].find(h => h.id === curH.id);
      if (harness && (curM.id === "dev-pc" || curM.id === "local")) {
        harness.createSession(curP.id).then((newSess) => {
          const sessKey = `${curM.id}/${curH.id}/${curP.id}`;
          if (!context.sessionsByScope[sessKey]) context.sessionsByScope[sessKey] = [];
          context.sessionsByScope[sessKey].unshift(newSess);
          context.selectSession(0);
          udp.sendSync(context);
        }).catch(console.error);
      } else {
        context.selectSession(0);
      }
    }

    // Row 1: Config / Modals
    else if (kid === 18) context.openEditor("model");
    else if (kid === 14) context.openEditor("effort");
    else if (kid === 10) context.openEditor("access");
    else if (kid === 6) {
      context.activeEditor = "none";
      context.viewMode = "workspace";
      if (context.viewMode === "workspace") {
        context.readerTitle = "Files Browser";
        context.readerSubtitle = context.getCurrentProject().path;
        context.workspaceScrollRow = 0;
      } else {
        context.updateReaderForCurrentSession();
      }
    }
    else if (kid === 2) {
      context.activeEditor = "none";
      context.viewMode = "settings";
      context.updateReaderForCurrentSession();
    }
    // Row 2: Choices (when in active editor) or Navigation
    else if ([19, 15, 11, 7, 3].includes(kid)) {
      if (context.activeEditor !== "none") {
        const choiceMap: Record<number, number> = { 19: 0, 15: 1, 11: 2, 7: 3, 3: 4 };
        const choiceOffset = choiceMap[kid];
        const wasEditor = context.activeEditor;
        context.commitActiveEditorChoice(context.editorChoiceWindowStart + choiceOffset);
        if (wasEditor === "project" || wasEditor === "harness" || wasEditor === "machine") {
          refreshCurrentScope();
        } else if (wasEditor === "session") {
          loadCurrentSessionTurns();
        }
        if (wasEditor === "session" && desktop.isConnected) {
          const curSess = context.getCurrentSession();
          if (curSess?.id) {
            console.log(`[Main] Navigating Codex Desktop window to session: ${curSess.id}`);
            desktop.navigateToCodexPage(curSess.id).catch((e) => console.warn("[Main] Failed to navigate desktop window:", e.message));
          }
        }
      } else {
        // Standard Contextual Navigation in Session mode
        if (kid === 19) {
          // K19: Prev User Prompt line jump
          context.jumpPrevPrompt();
        } else if (kid === 15) {
          // K15: Next User Prompt line jump
          context.jumpNextPrompt();
        } else if (kid === 11) {
          // K11: Toggle Detail filter (Show/Hide internal steps)
          context.toggleDetails();
        } else if (kid === 7) {
          // K7: Git Changes Diff View
          const curP = context.getCurrentProject();
          GitProvider.getChangedFiles(curP.path || process.cwd()).then(async (files) => {
            context.openChangesView(files);
            if (files.length > 0) {
              const diffLines = await GitProvider.getFileDiff(files[0].path, curP.path || process.cwd());
              context.selectChangesFile(0, diffLines);
            }
            udp.sendSync(context);
          }).catch(console.error);
        }
      }
    }
    // Helper to finish recording and transcribe audio
    async function finishRecordingAndTranscribe() {
      if (!context.isRecordingVoice) return;
      console.log("[Main] Stopping voice recording on MK20 & processing transcription...");
      const captureId = voiceDraft.snapshot?.id;
      if (!captureId || !voiceDraft.transcribing(captureId)) return;
      context.isRecordingVoice = false;
      context.isTranscribingVoice = true;
      context.updateReaderForCurrentSession();
      udp.sendSync(context);

      try {
        const text = await nativeVoice.finish(captureId);
        if (!voiceDraft.complete(captureId, text)) return;
        context.isTranscribingVoice = false;
        if (text.trim()) {
          context.voiceDraftText = text.trim();
        } else {
          context.voiceDraftText = "";
        }
        context.updateReaderForCurrentSession();
        udp.sendSync(context);
      } catch (err: any) {
        if (!voiceDraft.fail(captureId)) return;
        console.error("[Main] Voice processing error:", err.message);
        try {
          const workerStatus = await nativeVoice.status();
          console.error("[Main] Worker status at failure:", workerStatus);
        } catch { /* Worker gone; the error above already says so. */ }
        context.isTranscribingVoice = false;
        context.readerTitle = "Voice Error";
        context.readerSubtitle = "Audio capture failed";
        context.readerLines = [
          "Failed to process voice utterance:",
          err.message || String(err),
          "",
          "Press K20 to try again.",
        ];
        udp.sendSync(context);
      }
    }

    // Row 3: Actions
    if (kid === 20) {
      // K20 Talk / Finish Recording / Re-record (replaces an existing draft)
      if (context.isTranscribingVoice) {
        return; // Ignore while transcribing
      }
      if (context.isRecordingVoice) {
        finishRecordingAndTranscribe();
      } else {
        // MVP: pressing Talk with a draft on screen discards it and starts a
        // fresh capture. No separate discard step before re-recording.
        if (context.voiceDraftText) {
          if (!voiceDraft.cancel()) return;
          context.voiceDraftText = "";
        }
        let captureId: string;
        try {
          captureId = voiceDraft.begin({
            machineId: context.getCurrentMachine().id,
            harnessId: context.getCurrentHarness().id,
            projectId: context.getCurrentProject().id,
            sessionId: context.getCurrentSession().id,
            owner: desktop.isConnected ? "desktop" : "cli",
          }).id;
          context.voiceDestinationLabel = `${context.getCurrentProject().name} > ${context.getCurrentSession().title}`;
        } catch (error) {
          context.readerTitle = "Existing voice draft";
          context.readerLines = [String(error), "Resolve the existing draft before recording again."];
          return;
        }
        console.log("[Main] Starting voice recording on MK20...");
        context.isRecordingVoice = true;
        context.voiceDraftText = "";
        context.updateReaderForCurrentSession();
        udp.sendSync(context);
        const reportStartFailure = (e: any) => {
          if (!voiceDraft.fail(captureId)) return;
          console.error(`[Main] Voice start failed (capture ${captureId}):`, e.message);
          context.isRecordingVoice = false; context.isTranscribingVoice = false;
          context.readerTitle = "Voice start failed";
          context.readerSubtitle = "See reason below";
          context.readerLines = [e.message || String(e), "", "Press K20 (Talk) to try again."];
          udp.sendSync(context);
        };
        nativeVoice.start(captureId).catch((e) => {
          // Self-heal a worker-side orphan (e.g. after a middleware timeout):
          // release it, then retry the same capture once.
          if (String(e.message || e).includes("still busy")) {
            console.warn(`[Main] Worker busy; releasing orphaned capture then retrying (capture ${captureId})...`);
            nativeVoice.resetStuck()
              .then(() => {
                if (voiceDraft.snapshot?.id === captureId && voiceDraft.snapshot.phase === "recording")
                  return nativeVoice.start(captureId);
              })
              .catch(reportStartFailure);
            return;
          }
          reportStartFailure(e);
        });
      }
    }
    else if (kid === 16) {
      // K16 Action / Done (when recording) / Send (when draft ready)
      if (context.isTranscribingVoice) {
        return; // Ignore while transcribing
      }
      if (context.isRecordingVoice) {
        // Pressing K16 while recording also finishes recording and transcribes!
        finishRecordingAndTranscribe();
        return;
      }
      if (context.voiceDraftText) {
        const snapshot = voiceDraft.snapshot;
        if (!snapshot || snapshot.phase !== "review") {
          context.readerTitle = "Check submission status";
          context.readerLines = ["Draft is pending or its delivery is unknown.", "Do not retry until the original task is checked."];
          return;
        }
        const target = snapshot.destination;
        if (!target.sessionId || target.sessionId === "none") {
          context.readerTitle = "Draft destination unavailable";
          context.readerLines = ["No active session selected.", "Select a session on MK20 before submitting."];
          return;
        }
        voiceDraft.edit(context.voiceDraftText);
        context.voiceSubmission = "sending";
        context.readerTitle = "Sending voice draft";
        context.readerSubtitle = `${target.harnessId || "agent"}: ${target.sessionId.slice(0, 12)}`;
        context.readerLines = ["Destination fixed when recording started.", context.voiceDraftText];
        udp.sendSync(context);
        void voiceDraft.submit(async (destination, text) => {
          const destMachine = destination.machineId || context.getCurrentMachine().id;
          const destHarness = destination.harnessId || context.getCurrentHarness().id;
          const curModel = context.models[context.selectedModelIdx];
          const curEffort = context.efforts[context.selectedEffortIdx];
          const curAccess = context.accessLevels[context.selectedAccessIdx];

          if (destHarness === "codex" && destination.owner === "desktop") {
            if (!desktop.isConnected) throw new Error("Original desktop owner disconnected. No alternate-owner dispatch was attempted.");
            const result = await desktop.sendMessageToThread(destination.sessionId, text);
            if (result?.isError) throw new Error("Desktop returned a tool error; submission needs verification.");
          } else {
            await mesh.sendPrompt(destMachine, destHarness, destination.sessionId, text, {
              model: curModel,
              effort: curEffort,
              access: curAccess,
            });
          }
        }).then(() => {
          context.voiceSubmission = "idle";
          context.voiceDraftText = "";
          context.readerTitle = "Submission acknowledged";
          context.readerLines = ["The agent harness received your prompt.", "Check the panel for response streaming."];
          udp.sendSync(context);
        }).catch((error) => {
          context.voiceSubmission = "unknown";
          context.readerTitle = "Submission unconfirmed";
          context.readerLines = ["Draft preserved. Check task state before retrying.", String(error)];
          udp.sendSync(context);
        });
      }
    }
    else if (kid === 4) {
      // K4 Stop / Cancel / Discard
      if (context.isRecordingVoice || context.isTranscribingVoice) {
        const cancelledId = voiceDraft.snapshot?.id;
        voiceDraft.cancel();
        console.log("[Main] Cancelled voice recording/transcription.");
        context.isRecordingVoice = false;
        context.isTranscribingVoice = false;
        if (cancelledId) nativeVoice.cancel(cancelledId).catch(error => console.warn("[Voice] Native cancellation needs attention:", error.message));
        context.readerTitle = "Recording Cancelled";
        context.readerSubtitle = "Voice discarded";
        context.readerLines = [
          "[RECORDING CANCELLED]",
          "Voice utterance discarded.",
          "",
          "Returned to session view.",
        ];
        context.updateReaderForCurrentSession();
      } else if (context.voiceDraftText) {
        if (!voiceDraft.cancel()) {
          context.readerTitle = "Submission unconfirmed";
          context.readerLines = ["Cannot discard a pending or uncertain submission.", "Check the original task first."];
          return;
        }
        console.log("[Main] Discarded voice prompt draft.");
        context.voiceDraftText = "";
        context.updateReaderForCurrentSession();
      } else {
        // Emergency Stop / Turn Interrupt
        console.log("[Main] STOP pressed!");
        const curM = context.getCurrentMachine();
        const curH = context.getCurrentHarness();
        const curSess = context.getCurrentSession();
        if (curSess && curSess.id && curSess.id !== "none") {
          mesh.interrupt(curM.id, curH.id, curSess.id).catch(console.error);
        }
        context.readerTitle = "Turn Stopped";
        context.readerSubtitle = "Interrupted by user";
        context.readerLines = [
          "[TURN INTERRUPTED]",
          `Stop signal dispatched to ${curH.name || curH.id}.`,
          "",
          "Agent execution halted.",
        ];
      }
    }

  }

  function selectQuestionOption(optIdx: number) {
    if (!context.activeQuestion) return;
    context.activeQuestion.options.forEach((opt, idx) => {
      opt.isSelected = (idx === optIdx);
    });
  }

  // Send initial frame
  console.log("[Main] Sending initial V2 sync frame to MK20...");
  udp.sendSync(context);

  // Periodic heartbeat sync to keep MK20 active and avoid 5-second "Host disconnected" timeout
  setInterval(() => {
    udp.sendSync(context);
  }, 2000);

  console.log("[Main] Host daemon ready.");
}

main().catch(console.error);
