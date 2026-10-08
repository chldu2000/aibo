# Contributing to Aibo

Help improve a workflow, report an integration problem, or build an extension.
Start with the [user guide](docs/getting-started.md) to understand the current experience and
[development guide](docs/development.md) to run the application.

## Report a problem

Open an [issue](https://github.com/chldu2000/aibo/issues) with:

- The action you tried, what you expected, and what happened.
- Minimal reproduction steps, Aibo build/commit, OS and architecture.
- Agent CLI and plugin versions, selected model/mode, and relevant execution settings.
- Redacted errors or screenshots. Remove credentials and private workspace content.

For Cursor or Claude Code adapter issues, use [aibo-plugins issues](https://github.com/chldu2000/aibo-plugins/issues).
If ownership is unclear, describe the complete workflow in either repository.

## Propose or implement a change

Explain the user problem and the expected behavior. For a larger architectural change, discuss
the affected contracts before implementation. Keep changes focused and preserve unrelated local work.

Read the applicable contracts listed in [AGENTS.md](AGENTS.md). Run `pnpm run verify` from the
Aibo root before submitting a change, and follow the relevant regression matrix for native or UI behavior.
Documentation-only changes also need link checks; unrelated native probes are not required.
Report actual checks and any unverified boundaries in the pull request.

Use Conventional Commits, for example `docs: improve the first-session guide`. If an agent creates
a commit, follow the co-author guidance in AGENTS.md. Keep the English and Chinese README and
getting-started pages aligned when changing the public workflow.

## Build an extension

Use the [plugin guide](docs/plugin-development.md) and
[aibo-plugins templates](https://github.com/chldu2000/aibo-plugins). Keep vendor protocol mapping
inside the adapter and declare only capabilities the integration actually implements.

Individual SDK packages carry their own licenses. The repository has no application-wide LICENSE;
do not infer a license for the entire project from those package files.
