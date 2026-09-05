# Aibo contracts

`agent-event.v1.schema.json` is the frozen Phase 0 envelope for durable adapter events. Event-specific `payload` schemas will be added beside it as adapters are implemented; this avoids pretending Codex and Pi expose an identical lowest-common-denominator payload.

`execution-profile.v1.schema.json` is the Phase 4.5 contract for requested and adapter-resolved execution policy. The resolved form is represented by the `resolved` definition in the same schema; it must retain both requested and enforced values and list unsupported capabilities.

`turn-changeset.v1.schema.json` is the durable per-turn workspace snapshot contract. It records baseline/result state, file-level changes (including whether each file was already dirty before the turn and the source path for renames), normalized command metadata, and verification projections; checkpoints and artifacts remain separate versioned records rather than being inferred from rendered messages.

`context-attachment.v1.schema.json` is the durable workspace-relative context reference contract used by the composer and future Handoff snapshots.

`artifact.v1.schema.json` is the metadata contract for content-addressed command, verification, diff, and tool output artifacts. Artifact bytes stay in Aibo app data; the database and IPC surface expose typed metadata and hashes.

`checkpoint.v1.schema.json` is the durable baseline-file metadata contract. Checkpoint bytes stay in Aibo app data; unavailable or oversized files remain represented with a null storage reference instead of disappearing from recovery evidence.

`project-action.v1.schema.json` and `project-action-run.v1.schema.json` freeze user-registered argv-based project actions and their audited results. Actions never accept a shell command string.

`restore-operation.v1.schema.json` records every turn-change-set restore attempt, including restored paths and machine-readable conflict/unsupported reasons. It is the durable audit counterpart to the human-readable system timeline message.

Contract invariants:

- `sessionId` is Aibo-owned; native IDs stay in `externalSessionId`.
- `sequence` increases within a `generationId`; Core rejects events from an obsolete generation.
- raw vendor messages are stored separately behind `rawRef` and are not rendered directly by the WebView.
- adapter-specific data is nested under `payload.vendor`, never added as top-level envelope fields.
- session state is one of `created`, `starting`, `idle`, `running`, `waiting_approval`, `interrupted`, `failed`, or `closed`.
- requested execution policy is never treated as enforced policy; capability resolution must remain visible to the UI and durable session record.
- workspace trust is not an OS sandbox. `nativeSandbox` describes the adapter-enforced isolation only.
- a change set is scoped to one Aibo session and turn; partial or failed capture remains visible through `captureStatus` and `captureError`.
