# Goal pause and resume

A goal and a running turn have separate lifecycles. An active goal on an idle
session is waiting to continue; the goal alone is not evidence of tool execution.

## Host responsibilities

The host displays the objective, status and reported usage above the composer.
Buttons depend on the pinned session's advertised `goal.pause` and `goal.resume`
capabilities. Older providers can continue supplying `goal.manage` without
receiving operations they do not support. Both built-in kits and installed
presentation workbenches expose the same semantic actions.

`goal.resume` is a host intent. The session host admits it through the existing
session operation lock and persisted execution policy, allocates a host turn,
and dispatches `aibo.session.goal.resume` or
`aibo.session.goal.resume.write`. These additive core capabilities use an empty
input and the same terminal output as a normal turn. The write variant requires
the same session-scoped approval authority as `aibo.session.turn.write`; it
cannot authorize another session or nested arbitrary writes. Resume does not
consume the composer draft or pending attachments.

The resumed run owns the event stream, approvals, cancellation and workspace
change capture until its logical execution ends. `goal.updated` is an additive
session event, accepted only from providers advertising `goal.manage`. It
updates goal presentation without changing the host's execution state. Goal
reads use live controls during an invocation instead of waiting for it to end.

## Codex plugin responsibilities

Creating a goal through `goal.manage set` stores it paused. The `/goal` command
then requests host-admitted resume. This prevents a metadata call from starting
untracked work outside the host's execution policy.

Resume reserves the logical run before calling `thread/goal/set` with only
`threadId` and `status: active`. Codex starts its own native turn; Aibo does not
send a second continuation prompt. The plugin tracks successive native turns
under the admitted host run, scopes repeated native item IDs, and emits a single
terminal host event once the goal stops continuing. A missing native start is
bounded by a 30-second timeout that attempts to pause the goal and fails the run.

Pause first persists `status: paused`, then interrupts the current native turn.
It does not replace the objective, budget, token usage or elapsed time. Controls
wait for an in-progress activation before pausing, and a new native turn ID is
retried if continuation races interruption. A failed interrupt remains an error;
the UI retains the running state and allows another pause attempt.

Native `thread/goal/updated` and `thread/goal/cleared` notifications become
`goal.updated` events. Host status normalization preserves `paused`, `blocked`,
`usageLimited`, `budgetLimited`, and maps native `complete` to `completed`.
Budget exhaustion is never silently bypassed by resume.

The bundled Codex capability package is version 2.0.6. Existing sessions remain
pinned to their installed release; older releases do not acquire the new buttons
until their binding uses a release advertising the new capabilities.

Protocol reference: [Codex App Server goal management](https://learn.chatgpt.com/docs/app-server#manage-a-thread-goal).
Native behavior reference: [Codex Python SDK goal operations](https://github.com/openai/codex/blob/main/sdk/python/src/openai_codex/client.py).
