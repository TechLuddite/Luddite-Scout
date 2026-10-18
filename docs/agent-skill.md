# Agent skill

The skill lets a coding agent check a repository before it touches it, without reading anything the repository wrote. A repository under review may be hostile, and its instruction files, file names, settings and package metadata are exactly where it would put text aimed at an agent. The skill keeps that text out of the agent's context.

The skill is maintained in a separate repository, [TechLuddite/luddite-scout-skill](https://github.com/TechLuddite/luddite-scout-skill). It packages `bin/scout` from this repository at a pinned commit and SHA-256. Installation and build instructions are in that repository's README.

## How it works

The skill runs `scout --agent owner/repo`. That mode prints only:

- rule IDs such as `S2.hooks`, with a fixed description written by Luddite Scout
- severity, status and counts
- the repository name you asked for and the commit hash that was scanned
- the command for the full report

File names, file contents, line text, settings values, MCP server names, script names, repository descriptions and advisory summaries are never printed. Before printing, `scout` checks every string in its output against an allowlist of those fixed values. If anything else gets through, it prints a `guard` error instead of the report. Errors are fixed codes too, because an error message can quote the repository.

`test/test_agent_mode.py` runs the real scan against a fake repository with injection text in every name, file, setting, description and advisory. It checks that the text appears in the full report and nowhere in the agent report.

You read the detail. The agent's summary ends with a command such as `python3 -I -S ~/.claude/skills/luddite-scout/scripts/scout owner/repo`. Run it in a separate terminal. Do not run it with the `!` prefix in Claude Code, because that puts its output, repository text included, into the conversation.

## What it does not protect against

The skill's instructions to the agent are listed at the top of its `SKILL.md` and in its description, so the agent sees them before it decides to use the skill. Only the output allowlist is enforced by code.

| | Gap | Status |
| --- | --- | --- |
| G1 | The agent can still read the repository with its other tools: web fetch, `git clone`, `gh`, `curl`, or search results that quote the README. | Instruction only. See hardening below. |
| G2 | You can paste repository text into the conversation yourself, or run the full report with `!`. | Instruction only. The skill tells the agent not to ask for it. |
| G3 | The agent knows which rules fired and how often, but not which file or why. It can't advise on a specific line. | By design. The detail is for you. |
| G4 | The repository name is printed. You typed it, and GitHub limits names to letters, digits, `.`, `-` and `_`, but a name can still read like an instruction. | Accepted. |
| G5 | The scan covers one commit of the default branch. The repository can change after the scan. | The commit hash in the output records what was scanned. |
| G6 | The skill runs `scout` with network access on your machine. A compromised release would run with your permissions. | Check the attestation before installing. Releases are built only by CI, and the build refuses a `bin/scout` whose hash does not match the pin. |
| G7 | `allowed-tools` pre-approves only the scan command, and only in Claude Code. Other clients will ask you to approve it. | Expected. |
| G8 | A summary with no findings is not proof that a repository is safe. Findings are pattern matches. | The output and the skill both say so. |

## Hardening G1 in Claude Code

To make it harder for the agent to read a repository during a review, run the review from a dedicated folder with a `.claude/settings.json` like this:

```json
{
  "permissions": {
    "deny": [
      "WebFetch(domain:github.com)",
      "WebFetch(domain:*.github.com)",
      "WebFetch(domain:*.githubusercontent.com)",
      "Bash(git clone *)",
      "Bash(gh repo *)",
      "Bash(gh api *)",
      "Bash(curl *)",
      "Bash(wget *)"
    ]
  }
}
```

Deny rules take precedence over allow rules. Claude Code's [permissions documentation](https://code.claude.com/docs/en/permissions) says Bash deny rules match the command as Claude writes it, not every way of running the same program, so treat them as a speed bump rather than a boundary. A sandbox network allowlist can't close the gap either, because `scout` needs the same GitHub hosts the agent would use to read the repository.

## Earlier releases

Releases up to `skill-v0.3.1-cbeb849` were built from this repository and are still on its [releases page](https://github.com/TechLuddite/Luddite-Scout/releases). Verify those with `gh attestation verify luddite-scout.skill --repo TechLuddite/Luddite-Scout`.
