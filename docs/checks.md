# Checks

Every front end runs the same nine checks on one commit of the repository's default branch.

| Check | What it looks for |
| --- | --- |
| S1 Repository setup | Security policy, private vulnerability reporting, licence, archive and fork status, open pull requests |
| S2 Agent instruction files | CLAUDE.md, AGENTS.md, GEMINI.md, `.claude/`, `.agents/`, `.gemini/`, `.mcp.json`, editor tasks that run on open, dev container commands. Cross-checks: whether CLAUDE.md, AGENTS.md and GEMINI.md in one folder match or point to each other, or give different agents different instructions. Redirects: `@` imports (including ones outside the repository or from a web address), symbolic links, files the instructions mention, renamed Gemini CLI instruction files, extra folders and endpoint changes in settings, and HTML comments GitHub hides. Files that instructions send an agent to are scanned too |
| S3 Hidden Unicode | Bidirectional controls, tag characters and zero-width characters in file contents and names |
| S4 GitHub Actions | `pull_request_target` checking out PR code, untrusted input inside `run:` steps, unpinned actions, broad permissions. Reads `.github/workflows`, `.gitea/workflows` and `.forgejo/workflows`, and composite `action.yml` files, where only the script and pinning checks apply |
| S5 Dependencies | Lockfiles checked against [OSV](https://osv.dev), plus the [OpenSSF Scorecard](https://scorecard.dev) result where one exists |
| S6 Build-time code | `build.rs`, npm install scripts, `setup.py`, `.envrc` and other code that runs on install, build or entry |
| S7 Omarchy plugin | Only for repositories that are Omarchy plugins: markup-rendering `Text` items, uncapped process output, shell command strings, `sudo`, run-time installs, agent files shipped with the plugin |
| S8 Agent traps | Reads every text file, as S3 does. Text addressed to an AI agent that tells it to stop, refuse, or not analyse the repository: high in an instruction file, medium or low elsewhere. Shell functions and aliases named after an agent command such as `claude` or `codex`, files with those names, and scripts that append to a shell startup file. File and folder names such as `decoy` or `honeypot`. Text about sending agents the wrong way or using up their context, and the names of tools built for that |
| S9 Telemetry | Reads every text file except lockfiles and vendored folders. Host names of known telemetry, analytics and error-reporting services. Packages for those services in a manifest such as `package.json`, `pyproject.toml` or `Cargo.toml`, and at medium a package that reports each install to its maintainer. Code that reads a machine identifier such as `/etc/machine-id`. The names of telemetry settings, at info, so you can see which switch turns reporting off |
| S10 AUR build recipe | Only with `bin/scout --aur NAME` and the plugin's Recipe button. Reads the PKGBUILD and install script of an AUR package as text: checksums, unpinned checkouts, downloads inside build functions, `sudo`, and what the install script does as root |

For S3, the terminal's `--json` report and `--agent` summary also say where each sampled character sits in JavaScript and TypeScript source: code, comment, string, template or regular expression. The website does not work this out. It is information only and never changes a severity. See [agent skill](agent-skill.md).

S1 to S6, S8 and S9 apply to any repository. S7 reports "not applicable" unless the repository has an Omarchy plugin manifest at its root.

## Status and findings

Each check reports one status, with the reason:

| Status | Meaning |
| --- | --- |
| Ran | The check covered everything it looks at |
| Partial | Some files or API calls were not covered, for example because of size or rate limits |
| Skipped | The check could not run |
| Not applicable | The check does not apply to this repository |

A skipped check is never shown as a pass. Findings have a severity of high, medium, low or info. They are pattern matches for a person to judge. A clean report is not proof that a repository is safe.

## Examples

These scan the author's own repositories.

The summary for [TechLuddite/NetReady](https://github.com/TechLuddite/NetReady), a website project, so S7 does not apply:

![Website report summary for TechLuddite/NetReady, listing S1 to S9 with their status and finding counts](screenshots/website-summary.png)

The S7 card for [TechLuddite/luddite-gestures](https://github.com/TechLuddite/luddite-gestures), an Omarchy plugin, with each finding linked to the line it came from:

![S7 Omarchy plugin card for TechLuddite/luddite-gestures, showing one medium finding with file and line links](screenshots/website-omarchy-check.png)
