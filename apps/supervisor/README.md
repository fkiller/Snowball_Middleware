# Local Supervisor — partial onboarding

The trusted runtime can load `loadSupervisorAssets(repositoryRoot)` from
`@snowball/api` and pass the result as `new LocalApi({ journal, workspaces,
devices, supervisor })`. Assets are served on the API origin, with exact Host/Origin
checks and self-only CSP. There is no public bootstrap-minting or root-registration
route. The runtime must privately deliver its one-use `issueBootstrap()` code.

This is a partial browser shell, not a packaged runtime or completed onboarding.
It supports bootstrap, skip/back, snapshot refresh/cancel, workspace recheck and
logout. It never stores bearer credentials in browser storage/URLs. Text from the
service is rendered with textContent. Harness setup and native folder selection are
explicitly unavailable; no simulated control or automatic process/device discovery.
Device overview currently reports registration count, not ready-control capability.

Next: protected per-user persistence, reviewed harness discovery/probe actions,
trusted folder picker/registration, actual Connections detail, runtime startup/tray
bootstrap, and browser end-to-end authenticated recovery/offline checks. Settings and
the full multi-project supervision UX remain separate plan work.

2026-09-19 verification: full build + 110/110 tests before the final recheck deadline
addition; final focused result recorded in HANDOFF. Browser rendered the first
screen and missing-code validation correctly. Authenticated browser wizard flow,
mobile layout, macOS and installer were not verified. Preview used a disposable
journal, no user credentials/projects/harnesses/hardware, and self-terminates with
temporary-directory cleanup after three minutes.
