# Terminal

`bin/scout` needs only Python 3, with no packages to install. It is tested with Python 3.14.

## Usage

```sh
bin/scout owner/repo                              # readable report
bin/scout --json owner/repo                       # JSON report
bin/scout --agent owner/repo                      # summary for a coding agent, no repository text
bin/scout --gh-token owner/repo                   # use the GitHub CLI's login for a higher rate limit
gh auth token | bin/scout --token-stdin owner/repo  # or pass any token on standard input
```

The repository can be given as `owner/repo`, `github.com/owner/repo` or a full `https://github.com/` URL.

## Tokens

A token never goes on the command line or into the environment, where other processes could read it. `--gh-token` finds the `gh` you run by default without installing anything: it asks mise (`mise which gh`, which is how Omarchy installs `gh`) and falls back to `/usr/bin/gh`. It then runs `gh auth token` and keeps the result inside the scanner process. If GitHub rejects a token, the scan continues anonymously and the report says so.

## Output

The readable report shows every finding with its file and line. The JSON report is capped at about 1.5 MB. The lowest-severity findings are dropped first, and the report says when that happened.

`--agent` prints a summary built only from fixed rule IDs and descriptions, severities, statuses, counts, the repository name and the commit hash. See [agent skill](agent-skill.md) for what it guarantees.
