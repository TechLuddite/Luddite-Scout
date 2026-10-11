# Luddite Scout

A pre-flight check for a public GitHub repository, run before you point a coding agent at it or build it. Paste a repository URL and get a report a person can read in a few minutes. Everything runs in your browser.

**Status:** experimental, first version under active development.

**Use it:** https://techluddite.github.io/Luddite-Scout/

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

## What it checks

| Check | What it looks for |
| --- | --- |
| S1 Repository setup | Security policy, private vulnerability reporting, licence, archive and fork status, open pull requests |
| S2 Agent instruction files | CLAUDE.md, AGENTS.md, `.claude/`, `.mcp.json`, editor tasks that run on open, dev container commands |
| S3 Hidden Unicode | Bidirectional controls, tag characters and zero-width characters in file contents and names |
| S4 GitHub Actions | `pull_request_target` checking out PR code, untrusted input inside `run:` steps, unpinned actions, broad permissions |
| S5 Dependencies | Lockfiles checked against [OSV](https://osv.dev), plus the [OpenSSF Scorecard](https://scorecard.dev) result where one exists |
| S6 Build-time code | `build.rs`, npm install scripts, `setup.py`, `.envrc` and other code that runs on install, build or entry |

Each check reports whether it ran in full, ran partially, or was skipped, with the reason. A skipped check is never shown as a pass. Findings are pattern matches for a human to judge. A clean report is not proof that a repository is safe.

## Run it locally

The live site is at https://techluddite.github.io/Luddite-Scout/. To run your own copy, there is no build step and there are no dependencies.

```sh
git clone https://github.com/TechLuddite/Luddite-Scout.git
cd Luddite-Scout
python3 -m http.server 8000
```

Open http://localhost:8000 and enter a repository such as `owner/repo`.

## Limitations and data handling

- Public repositories only, default branch only.
- Without a token, GitHub allows 60 API requests an hour per address. A review uses about five. File contents come from `raw.githubusercontent.com`, which does not count against that limit.
- Files over 1 MB and binary files are not scanned for hidden characters. Very large repositories may be covered partially, and the report says so.
- No AI model is used and no code from the scanned repository is run.

There is no backend. Your browser contacts `api.github.com`, `raw.githubusercontent.com`, `api.osv.dev` (package names and versions from lockfiles) and `api.securityscorecards.dev` (the repository name). Those services see your IP address and what you looked up. The page's Content Security Policy blocks every other host. An optional GitHub token is kept in memory for the page session only, sent only to `api.github.com`, and never written to storage. Results are not stored or shareable by link. See [about.html](about.html) for the full statement.

## Development

```sh
npm test        # node --test, Node 22 or later, no packages to install
npm run serve   # python3 -m http.server 8000
```

The checks in `js/checks/` are plain functions with no DOM access, so they run under Node. `js/app.js` is the only file that touches the page, and it inserts repository text through text nodes only.

## Help and security

For bugs and suggestions, open an issue. Please do not report security problems in public issues. Use GitHub private vulnerability reporting as described in [SECURITY.md](SECURITY.md).

## Licence

No licence has been chosen yet. Until one is published, all rights are reserved.
