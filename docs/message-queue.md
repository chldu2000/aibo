# Message queue

Aibo owns the editable waiting queue for the built-in Codex and Pi sessions.
Sending while a turn is active adds a message to this queue. A successful turn
settles completely before the host dispatches the next message, in insertion
order, through normal turn admission and execution-profile checks.

Each waiting message has a stable ID. Equal text does not imply equal identity.
The UI offers delete, send now, clear, and (when paused) resume. Send now steers
an active turn, or starts a normal turn if the previous invocation has finished.
It does not interrupt the active turn. Codex uses `turn/steer` with the expected
native turn ID; Pi uses `AgentSession.steer`. Pi's native follow-up buffer is not
used for the host waiting queue.

`invoke_agent_capability(sessionId, "queue.manage", input)` exposes these host
operations for the built-in sessions:

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
newer events. Native Pi queue events cannot overwrite the host snapshot.

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
