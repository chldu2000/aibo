# Aibo

**Your coding agents. One workbench.**

[English](README.md) | [简体中文](README_zh.md)

Aibo is a local desktop workbench for coding agents. Bring Codex, Pi, and plugin-based
integrations for Claude Code and Cursor into one workspace. Keep conversations organized,
follow tool activity and approvals, and reference earlier conversations as you continue working.

[Get started](docs/getting-started.md) · [Explore plugins](https://github.com/chldu2000/aibo-plugins) · [Documentation](docs/README.md)

## A workspace for the way you work

- **Use different agents in the same project.** Create separate sessions for investigation,
  implementation, and review, with a shared place to find their history.
- **Carry context into the next conversation.** Type `@` in the composer to reference another
  session in the workspace. Include an earlier discussion when asking a new question or using another agent.
- **Follow the work as it happens.** Read streamed replies, inspect tool activity, and respond
  to the approvals and questions your agent exposes.
- **Find the work you already did.** Search sessions, messages, and files with `⌘ K` / `Ctrl K`.
  Inspect changes across Git repositories in your workspace.
- **Make the workbench your own.** Choose built-in Material 3 or ak-ui, install a presentation
  package, or extend Aibo with agent and capability plugins.

### Try a complete workflow

1. Open a project and ask an agent to explain the part you want to change.
2. Create another session in that workspace, using the same agent or a different one.
3. Type `@`, select the earlier conversation, and ask for a plan using that context.
4. Continue with implementation, review tool activity and approvals, and inspect the Git diff.

Session references attach selected saved messages. They do not transfer an agent's native
session or automatically delegate the task. See the [walkthrough](docs/getting-started.md#continue-from-an-earlier-conversation).

## Choose your agent

| Agent | Integration | Before your first session |
| --- | --- | --- |
| Codex | Built in | Install `codex` and complete its native authentication |
| Pi | Built-in SDK | Configure credentials for your model provider |
| Cursor | [Plugin](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/cursor) | Install Cursor CLI and log in |
| Claude Code | [Plugin](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/claude-code) | Install a compatible Claude Code CLI and log in |
| Other ACP agents | [Adapter template](https://github.com/chldu2000/aibo-plugins/tree/main/plugins/acp-template) | Configure a compatible Agent Client Protocol implementation |

Features vary by agent and model. Branching, goals, image input, model controls, and recovery
appear according to each integration's supported capabilities. See [agent requirements](docs/getting-started.md#prepare-an-agent)
and the individual plugin guides before choosing an integration.

## Get started

The reproducible setup below runs Aibo from source. You need Node.js 22+, pnpm, Rust, and
the build dependencies for Tauri 2 on your platform.

```sh
git clone https://github.com/chldu2000/aibo.git
cd aibo
pnpm install
pnpm tauri dev
```

Then add a workspace, choose an agent, and send your first message. The
[getting-started guide](docs/getting-started.md) covers agent setup, runtime diagnostics,
and common startup problems. If you already have an Aibo desktop build, start with
[preparing an agent](docs/getting-started.md#prepare-an-agent).

Native acceptance evidence currently covers **macOS on Apple Silicon**. Other platforms have
implementation and validation limits; consult the [platform matrix](docs/plugin-platform-support-matrix.md).
Development builds use a separate app data directory from release builds.

## Extend Aibo

The [aibo-plugins repository](https://github.com/chldu2000/aibo-plugins) contains Cursor and
Claude Code integrations, an ACP agent template, and capability and presentation examples.
Install built capability packages and presentation packages through their respective settings entries.

For appearance, Aibo includes **Material 3** by default and **ak-ui** as an alternative.
Installable [shadcn](packages/presentation-shadcn/README.md) and
[Material 3](packages/presentation-material3/README.md) packages provide additional workbench options.

Building your own extension? Start with the [plugin guide](docs/plugin-development.md),
[ACP adapter](packages/acp-adapter/README.md), or [presentation contract](docs/presentation-package.md).

## Local workspace, connected agents

Aibo stores its workspace and conversation history locally. Agents and model providers may
send prompts, code, and tool results to their services; local storage does not mean offline inference.
You bring the authentication and model access required by each integration.

Aibo manages session state and host authorization. Native agents retain their own execution
rules, and workspace trust is not an operating-system sandbox. See the
[FAQ](docs/getting-started.md#common-questions) and [session controls](docs/session-controls.md).

## Documentation and contributions

- [Getting started](docs/getting-started.md) / [中文入门](docs/getting-started_zh.md): first session, conversation references, and troubleshooting.
- [Documentation index](docs/README.md): user guides, extension development, and technical references.
- [Development](docs/development.md): architecture, repository map, builds, and verification.
- [Contributing](CONTRIBUTING.md): report a problem or propose a change.

Aibo is licensed under the [MIT License](LICENSE). Third-party dependencies and marks retain
their respective licenses and ownership.
