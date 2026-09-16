# Message queue

Aibo owns the editable waiting queue for every pinned Runtime 2.1 session provider
that declares the shared `aibo.session.open`, `aibo.session.turn`,
`aibo.session.cancel`, and `aibo.session.close` contracts. This includes external
providers without a native queue. Unbound or retired sessions remain history-only.
Sending while a turn is active adds a message to this queue. A successful turn
settles completely before the host dispatches the next message, in insertion
order, through normal turn admission and execution-profile checks.

Each waiting message has a stable ID. Equal text does not imply equal identity.
The UI offers delete, clear, and (when paused) resume. Send now is available at
idle, or during execution only when steering was negotiated. Send now steers
an active turn, or starts a normal turn if the previous invocation has finished.
It does not interrupt the active turn. Codex uses `turn/steer` with the expected
native turn ID; Pi uses `AgentSession.steer`. Pi's native follow-up buffer is not
used for the host waiting queue.

`invoke_agent_capability(sessionId, "queue.manage", input)` exposes these host
operations for these standard sessions:

| Action | Input | Behavior |
| --- | --- | --- |
| `get` | none | Read persisted snapshot without opening the native runtime |
| `followUp` | `message` | Persist the message and its referenced attachments |
| `steer` | `message` | Persist, then attempt immediate delivery |
| `remove` | `id` | Remove one unclaimed message |
| `sendNow` | `id` | Deliver one existing message immediately |
| `clear` | none | Remove all unclaimed messages |
| `resume` | none | Resume ordered delivery after a stop or recoverable failure |

Snapshots and host `queue.updated` events contain `sessionId`, `revision`,
`paused`, `items`, and `updatedAt`. Each item includes `id`, `text`, `status`,
`error`, and `createdAt`. Legacy `steering`/`followUp` arrays remain available to
older presentation consumers. Revisions prevent late reads from overwriting
newer events. Provider queue events cannot overwrite the host snapshot.

The database stores queue membership and attachment ownership. Attachment
references are captured from the submitted message, removed from the composer,
and checked again before delivery. A changed or missing file retains its queue
item with an error. Attachments added to the next draft remain separate.
Deleting a waiting item removes its unsent attachments; already-bound historical
attachments remain intact.

The states are `pending`, `sending`, `failed`, and `uncertain`. Queue mutation and
delivery share a per-session queue gate, independent of idle metadata reads.
An automatic new turn is claimed transactionally and removed from the queue only
when its native start is observed. Steering is removed after acceptance and its
user message is added to the existing host turn. An explicit rejection keeps the
message; an ambiguous acknowledgement loss never triggers an automatic resend.
Uncertain items must be checked against history and removed before resuming.

Stop, turn failure, and application restart pause automatic consumption without
clearing waiting messages. Restart also marks any outstanding send as uncertain.
Selecting another session or changing presentation does not change the queue.
There is a maximum of 100 waiting messages per session.

Verification covers host FIFO and stable deletion, native Codex steering, stop
and restart recovery, attachment isolation and validation, completion races,
composer admission, revision ordering, and presentation action scope. Run
`pnpm run verify` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

## Capability negotiation

The host projects `queue.manage` into public session capabilities after a valid
Runtime 2.1 binding exists and the pinned manifest supplies the four standard
operations above. Providers do not need to declare a native queue operation for
FIFO, persistence, attachment ownership or pause/recovery. Delivery still uses
ordinary turn admission and `turn.started` acknowledgement; providers must emit
truthful lifecycle events. Missing acknowledgement remains `uncertain`.

`queue.steer` is a separate host-derived UI capability. For compatibility with
existing providers, it requires BOTH the provider's negotiated `queue.manage`
capability and a version 1.0.0 `<pluginId>.queue.manage` operation whose
`inputSchema.properties.action.enum` explicitly includes `steer`. The host sends
`{action:"steer",message:"…"}` through the active invocation's control channel.
Success must mean the message was accepted, not merely submitted to an unchecked
background operation. This does not grant write authority beyond that invocation.

The provider's raw negotiated capabilities stay separate from host-added flags.
Declaring `queue.steer` alone cannot enable steering. Existing Codex/Pi releases
with the explicit steer operation remain compatible without migration. A provider
with only follow-up support gains the waiting queue but no running send-now UI.
Unsupported running steer/sendNow requests fail before enqueue or claim; ordinary
messages continue waiting for the current turn to finish.

Presentation workbenches use public `queue.manage` for queue controls and
`queue.steer` for running `queueSteer`/`sendQueuedMessage`. Idle send-now does not
require steering. Stable-ID actions remain bound to host tokens. Attachment
ownership is host-managed; supported attachment content is still limited by the
normal session delivery path (currently queued image context is rejected).

No automatic reconciliation or idempotent resend protocol is added here.
Unknown delivery results still pause the queue and require history review.

Steering failures are conservative: only an error message equal to or beginning
with `no_active_turn:` (the bare `no_active_turn` is also accepted) confirms no
active native turn and permits normal-turn delivery after settlement. An explicit
`steer_rejected` / `steer_rejected:` retains the item as failed. Providers must
use these markers only when delivery definitely did not happen. Timeouts and
other errors remain uncertain; mentioning `expectedTurnId` in diagnostic text
never authorizes a resend.
