# Aibo contracts

`agent-event.v1.schema.json` is the frozen Phase 0 envelope for durable adapter events. Event-specific `payload` schemas will be added beside it as adapters are implemented; this avoids pretending Codex and Pi expose an identical lowest-common-denominator payload.

`execution-profile.v1.schema.json` is the Phase 4.5 contract for requested and adapter-resolved execution policy. The resolved form is represented by the `resolved` definition in the same schema; it must retain both requested and enforced values and list unsupported capabilities.

Contract invariants:

- `sessionId` is Aibo-owned; native IDs stay in `externalSessionId`.
- `sequence` increases within a `generationId`; Core rejects events from an obsolete generation.
- raw vendor messages are stored separately behind `rawRef` and are not rendered directly by the WebView.
- adapter-specific data is nested under `payload.vendor`, never added as top-level envelope fields.
- session state is one of `created`, `starting`, `idle`, `running`, `waiting_approval`, `interrupted`, `failed`, or `closed`.
- requested execution policy is never treated as enforced policy; capability resolution must remain visible to the UI and durable session record.
- workspace trust is not an OS sandbox. `nativeSandbox` describes the adapter-enforced isolation only.
