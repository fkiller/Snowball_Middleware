import { randomUUID } from "node:crypto";

export type DraftDestination = Readonly<{
  machineId: string; harnessId: string; projectId: string; sessionId: string;
  owner: "desktop" | "cli";
}>;
export type DraftPhase = "recording" | "transcribing" | "review" | "empty" | "cancelled" | "sending" | "unknown" | "sent" | "failed";
type Entry = {
  id: string; destination: DraftDestination; phase: DraftPhase;
  text: string; controller: AbortController;
};

/** Provider-independent lifecycle. UI selection is never a submission destination. */
export class VoiceDraft {
  private entry?: Entry;
  get snapshot() {
    const e = this.entry;
    return e ? Object.freeze({ id: e.id, destination: e.destination, phase: e.phase, text: e.text }) : undefined;
  }
  begin(destination: DraftDestination): { id: string; signal: AbortSignal } {
    if (this.entry && !["sent", "cancelled", "empty", "failed"].includes(this.entry.phase))
      throw new Error("Finish or discard the existing draft first.");
    if (Object.values(destination).some(value => !value)) throw new Error("A complete destination is required.");
    const e: Entry = { id: randomUUID(), destination: Object.freeze({ ...destination }), phase: "recording", text: "", controller: new AbortController() };
    this.entry = e;
    return { id: e.id, signal: e.controller.signal };
  }
  transcribing(id: string) {
    if (this.entry?.id !== id || this.entry.phase !== "recording") return false;
    this.entry.phase = "transcribing"; return true;
  }
  complete(id: string, text: string) {
    if (this.entry?.id !== id || this.entry.phase !== "transcribing") return false;
    this.entry.text = text.trim();
    this.entry.phase = this.entry.text ? "review" : "empty";
    return true;
  }
  fail(id: string) {
    if (this.entry?.id !== id || !["recording", "transcribing"].includes(this.entry.phase)) return false;
    this.entry.phase = "failed"; this.entry.controller.abort(); return true;
  }
  cancel() {
    const e = this.entry;
    if (!e || ["sending", "unknown", "sent", "cancelled"].includes(e.phase)) return false;
    e.phase = "cancelled"; e.text = ""; e.controller.abort(); return true;
  }
  discard() {
    const e = this.entry;
    if (!e) return false;
    e.phase = "cancelled"; e.text = ""; e.controller.abort(); return true;
  }
  edit(text: string) {
    if (!this.entry || this.entry.phase !== "review") throw new Error("Draft is not editable.");
    this.entry.text = text;
  }
  restore(saved: { destination: DraftDestination; text: string; phase: DraftPhase; id: string }) {
    if (this.entry) throw new Error("Cannot replace a live draft from storage.");
    if (!saved.id || !saved.destination || Object.values(saved.destination).some(v => !v)) throw new Error("Invalid saved draft");
    this.entry = { ...saved, destination: Object.freeze({ ...saved.destination }),
      phase: saved.phase === "review" ? "review" : "unknown", controller: new AbortController() };
  }
  confirmDelivered(id: string) {
    if (this.entry?.id !== id || this.entry.phase !== "unknown") return false;
    this.entry.phase = "sent"; this.entry.text = ""; return true;
  }
  async submit(send: (destination: DraftDestination, text: string, requestId: string) => Promise<void>) {
    const e = this.entry;
    if (!e || e.phase !== "review" || !e.text.trim()) throw new Error("No sendable draft.");
    e.phase = "sending";
    try {
      await send(e.destination, e.text, e.id);
      e.phase = "sent"; e.text = "";
    } catch (error) {
      // Rejection may occur after delivery. Preserve text; never switch owner or retry.
      e.phase = "unknown";
      throw error;
    }
  }
}
