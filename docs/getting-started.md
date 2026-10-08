# Get started with Aibo

[English](getting-started.md) | [简体中文](getting-started_zh.md) · [Back to Aibo](../README.md)

This guide takes you from a desktop build to a first conversation, then shows how to bring
that conversation into your next task. Native acceptance currently covers macOS arm64;
see the [platform matrix](plugin-platform-support-matrix.md) for other environments.

## Run Aibo

If you already have a desktop build, open it and continue below. To run from source, install
Node.js 22+, pnpm, Rust, and your platform's Tauri 2 build dependencies, then run:

```sh
git clone https://github.com/chldu2000/aibo.git
cd aibo
pnpm install
pnpm tauri dev
```

Wait for the desktop window. `pnpm dev` alone starts a browser preview and does not provide
the desktop execution backend. Development/debug builds start with separate data from release
builds; an empty development workspace does not mean your release history was deleted.

In an installed build, check **Settings → 运行与诊断 (Run & diagnostics)** if Node is missing.
Aibo can locate a compatible local Node, use a file you select, or download a private runtime
when requested. Installing plugins does not run npm. See [runtime details](host-sdk.md).

## Prepare an agent

| Agent | Setup | Ready when |
| --- | --- | --- |
| Codex | Install the native CLI, make `codex` discoverable, and complete its authentication | A Codex session opens and can send a model request |
| Pi | Configure Pi provider credentials for the model you want | The chosen model accepts your request |
| Cursor | Install and log in to Cursor CLI; install and enable the [Cursor plugin](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/cursor) | Plugin diagnostics pass and a new Cursor session opens |
| Claude Code | Install and authenticate the CLI required by the [Claude Code plugin](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/claude-code); install and enable the plugin | Plugin diagnostics pass and a new Claude Code session opens |

Pi uses the SDK included by the project; its CLI is not required for ordinary sessions.
The default Pi configuration stores provider credentials in `~/.pi/agent/auth.json`. Existing
Pi login credentials can be reused. For API-key setup, use the auth-file format documented in
[Pi's provider guide](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/providers.md);
keep existing provider entries when adding one. The locked SDK's copy is available at
`node_modules/@earendil-works/pi-coding-agent/docs/providers.md` after dependency installation.
For external agents, use their native login or the documented plugin settings. Do not assume
API keys exported in a terminal are inherited by plugin processes. A model appearing in a
selector does not establish account entitlement or available quota.

For plugin packages and compatibility, follow the [installation guide](https://github.com/chldu2000/aibo-plugins/blob/main/docs/installation.md).
The source checkout and a released Aibo build may supply different SDK versions.

## Send your first message

1. Choose **添加工作区 (Add workspace)** and select your project directory. It should appear in the sidebar.
2. Create a session in that workspace and choose an available agent.
3. Choose a model and session mode if the integration offers those controls. Resolve any dependency or authentication error before continuing.
4. Send: “Explain this project's structure and suggest where to start reading.”
5. Follow the streamed response and tool activity. Answer questions or approvals when requested.

Before asking for edits, review the workspace trust and session execution settings. Approval
behavior depends on the selected policy and native agent; not every tool operation produces a prompt.
After an implementation task, open the Git panel to review the changes in the relevant repository.

## Continue from an earlier conversation

1. Keep the first conversation in the workspace and create another session there.
2. Type `@` in the message composer and select the earlier session. The picker also contains files.
3. Review the attached reference and send: “Use the referenced discussion to propose a small implementation plan.”
4. Continue in the new session. The original conversation remains available in history.

References default to the latest 12 user/assistant messages. Change the default under
**工作台设置 → 工作区 → 会话引用** to include another count or all messages. Size limits still apply;
reduce the selected range if a reference is too large.

The attachment captures selected saved conversation text. Tool-output bodies are not included
by default. Agents that negotiate Aibo's history tool can request additional persisted history;
other integrations receive only the excerpt. References do not transfer permissions, native
session state, or automatic responsibility for a task.

## Find work and change appearance

Open global search with `⌘ K` / `Ctrl K` or double Shift. Search sessions, messages, and files;
use the workspace scope to narrow results. The [search guide](global-search.md) explains indexing limits.

Choose Material 3 or ak-ui in the workbench appearance settings. For an external presentation
package, select **安装皮肤插件**, choose the built directory containing `presentation.json`,
then select that presentation. Capability plugins use a separate installation entry.

## Common questions

### Does Aibo include model access?

You supply the authentication, subscription, or API credentials required by your agent and model
provider. Aibo does not make a listed model available to an account that cannot use it.

### Is everything offline?

Workspace records and Aibo's saved conversation history are local. Agents may send prompts,
code, and results to remote services. Connectivity and data handling depend on the integration
and provider you choose.

### Can I import or move any native agent conversation?

Do not assume native CLI or desktop histories are automatically imported. Recovery depends on
the integration and its native session support. Aibo's conversation reference shares saved
messages between Aibo sessions; it is not a native-session migration.

### Why is my agent or model unavailable?

Check runtime diagnostics, CLI discovery and login, plugin enablement, platform support, and
host SDK compatibility. For model errors, check the provider's actual response and account access.
A plugin can install successfully while still being unable to start a real model request.

### Why did installing a new plugin not update my old conversation?

Sessions keep their provider release binding until a supported host-managed migration succeeds.
Create a new session to try a newly installed release. Follow the plugin's upgrade notes for existing sessions.

### Why is a control missing?

Aibo shows capabilities offered by the current integration, model, and session state. Image input,
branching, goals, reasoning controls, and recovery are not universal. See the relevant plugin guide.

### Does workspace trust create a sandbox?

No. Aibo's host authorization and native-agent enforcement are separate. Cursor and Claude Code
manage their native file, command, and network permissions; Aibo forwards the approvals they emit.
See [session controls](session-controls.md) for the execution boundaries.

For unresolved problems, include the Aibo build, OS/architecture, agent/plugin versions, reproduction
steps, and a redacted error in an [issue](https://github.com/chldu2000/aibo/issues).
