# Luddite Scout

A pre-flight check for a public GitHub repository, run before you point a coding agent at it, build it, or install it. Give it a repository and get a report a person can read in a few minutes. It never runs code from the repository.

**Status:** experimental, under active development.

![The Luddite Scout panel open under the Omarchy bar, showing a report for TechLuddite/luddite-gestures](docs/screenshots/omarchy-desktop.png)

Four ways to use it, all running the same checks:

| Front end | How | Documentation |
| --- | --- | --- |
| Website | https://techluddite.github.io/Luddite-Scout/. Everything runs in your browser. | [docs/website.md](docs/website.md) |
| Terminal | `bin/scout owner/repo`. One Python file, standard library only. | [docs/terminal.md](docs/terminal.md) |
| Omarchy | A bar widget and panel for the Omarchy desktop. | [docs/omarchy-plugin.md](docs/omarchy-plugin.md) |
| Agent skill | `luddite-scout.skill` for Claude Code and the Claude apps, from [luddite-scout-skill](https://github.com/TechLuddite/luddite-scout-skill). The agent gets a summary with no text from the scanned repository. | [docs/agent-skill.md](docs/agent-skill.md) |

## What it checks

| Check | Looks for |
| --- | --- |
| S1 Repository setup | Security policy, private vulnerability reporting, licence, archive and fork status |
| S2 Agent instruction files | CLAUDE.md, AGENTS.md, GEMINI.md, `.claude/`, `.mcp.json` and similar, and where they redirect an agent |
| S3 Hidden Unicode | Bidirectional controls, tag characters and zero-width characters |
| S4 GitHub Actions | Risky triggers, untrusted input in `run:` steps, unpinned actions, broad permissions |
| S5 Dependencies | Lockfiles checked against OSV, and the OpenSSF Scorecard result |
| S6 Build-time code | Code that runs on install, build or entry |
| S7 Omarchy plugin | The patterns the Omarchy plugin marketplace reviewers block most often |

Findings are pattern matches for a person to judge. A clean report is not proof that a repository is safe. [docs/checks.md](docs/checks.md) has the full list, what each status means, and example reports.

## Omarchy plugin

```sh
omarchy plugin add https://github.com/TechLuddite/Luddite-Scout
omarchy plugin enable io.github.techluddite.luddite-scout
```

To remove it:

```sh
omarchy plugin remove io.github.techluddite.luddite-scout
```

The plugin keeps no state, cache, credentials or configuration, so nothing is left behind. See [docs/omarchy-plugin.md](docs/omarchy-plugin.md) for what it runs and what it contacts.

## Documentation

- [Checks](docs/checks.md)
- [Website](docs/website.md)
- [Terminal](docs/terminal.md)
- [Omarchy plugin](docs/omarchy-plugin.md)
- [Agent skill](docs/agent-skill.md)
- [Limitations and data handling](docs/data-handling.md)
- [Development](docs/development.md)

## Credits

Luddite Scout is a thin layer over public services and published research. It has no code dependencies.

Data sources:

- [GitHub REST API](https://docs.github.com/en/rest) and raw.githubusercontent.com for repository details, file lists and file contents.
- [OSV](https://osv.dev), the open source vulnerability database and [API](https://google.github.io/osv.dev/api/) run by Google, for dependency advisories (S5).
- [OpenSSF Scorecard](https://scorecard.dev) from the [Open Source Security Foundation](https://openssf.org), for repository security scores where a repository has been scanned (S5).

Research the checks are based on:

- [Trojan Source](https://trojansource.codes) by Nicholas Boucher and Ross Anderson, on bidirectional control characters that make code display differently from how it runs (S3).
- [ASCII Smuggler Tool: Crafting Invisible Text and Decoding Hidden Codes](https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/) on the Embrace The Red blog, on Unicode tag characters used to hide instructions from people while AI models still read them (S3).
- GitHub Security Lab on [pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/) and [untrusted input](https://securitylab.github.com/resources/github-actions-untrusted-input/), and GitHub's [security hardening guide for Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions) (S4).
- The review history of the [Omarchy plugin marketplace](https://github.com/omacom/omarchy-plugin-marketplace), for the patterns its reviewers block most often (S7).

## Help and security

For bugs and suggestions, open an issue. Please do not report security problems in public issues. Use GitHub private vulnerability reporting as described in [SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE).
