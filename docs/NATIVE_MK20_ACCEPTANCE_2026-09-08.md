# Native MK20 dictation acceptance — 2026-09-08

User explicitly confirmed that text spoken into MK20 appeared in the Windows PoC. This completes one user-verified MK20 MIC3 → live PCM → virtual cable → native Codex recognition → editable external draft acceptance. No agent Send is implemented in the PoC. Accuracy across a corpus, cancellation, repeatability and production integration are not established by this one acceptance.

Following a reported unresponsive Finish, hardware logs showed K20 and K16 down/up; no recorder remained. Windows accessibility showed the app waiting for a transcript, with its 15-second delay notice. Later the user confirmed successful MK20 text and accessibility showed a draft-change interval of 2.3s. These observations do not establish that the same request took over 15 seconds; the interval is not a provider benchmark. The earlier wording that implied Finish failure is superseded.

Latest build: host/poc/native-dictation/artifacts/finish-diagnostics/Snowball.Dictation.Poc.exe. Adds live byte-duration/peak metrics, explicit Finish received status, disables/relabels inactive Finish, and labels long waiting as delayed rather than failed. Late successful insertion remains accepted. Includes Cancel after draft completion and late-insertion quarantine from panel-next. Release build 0 warnings/errors; loopback panel protocol passes; host npm test passes 6 lifecycle regressions.

The successful initial artifacts/panel app remains open to preserve its draft. User was asked to copy/save it, close normally, open the new build, connect the device, and test Talk/Cancel with preservation of an existing baseline draft. Physical cancellation acceptance remains pending. Neither replacing the executable on disk nor tests updates an already running process.

HUD promotion: /mnt/SDCARD/mk20-hud now byte-matches verified recovery-0908c. Previous default executable backed up as /mnt/SDCARD/mk20-hud.before-0908. Current running recovery-c process was not interrupted. Boot inspection found vendor qt_app2/appLunch ownership, so no competing startup service was installed and no reboot was performed. Persistent binary promotion is verified; automatic HUD startup after reboot remains unverified.

Next: cancellation/late-result and repeated Talk/Finish; then integrate the native worker with the destination-bound host lifecycle. Legacy host recorder and default fallback STT remain unsuitable for this acceptance route. Retain explicit app input selection CABLE Output and configured native shortcut until guided setup is implemented.
