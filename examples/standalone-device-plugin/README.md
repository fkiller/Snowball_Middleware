# Standalone protocol 1 device reference

Copy this directory into an empty repository and run `npm test` with Node >=20.19.
No middleware checkout, hardware, network, account, build tool or npm dependency is needed.
This is a developer example, not a signed end-user installer or a published package.
`private: true` and `UNLICENSED` deliberately prevent accidental publication until the owner chooses licensing.

`manifest.mjs` supplies the SDK v1 manifest. The real PluginHost must parse it and obtain explicit ID/digest approval before starting `worker.mjs`.
Handshake precedes operations; frames and output buffering are bounded; EOF closes the worker.
Two virtual display destinations remain distinct. This example never sends harness commands, probes devices, emits real identity claims, or uses ambient credentials.
Production hardware needs a reviewed report contract, consent, physical identification, unplug cleanup and conformance evidence. Read ../../docs/middleware/PLUGIN_DEVELOPMENT.md in the source repository before copying.

All executable code resides in the single hashed worker. Adding imported files requires complete artifact verification; the current host entrypoint digest alone does not cover those files.
