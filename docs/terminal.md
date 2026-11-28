# Terminal

`bin/scout` needs only Python 3, with no packages to install. It is tested with Python 3.14.

## Usage

```sh
bin/scout owner/repo                              # readable report
bin/scout --json owner/repo                       # JSON report
bin/scout --agent owner/repo                      # summary for a coding agent, no repository text
bin/scout --gh-token owner/repo                   # use the GitHub CLI's login for a higher rate limit
gh auth token | bin/scout --token-stdin owner/repo  # or pass any token on standard input
bin/scout --dir PATH                              # scan a local checkout instead
bin/scout --dir PATH --name owner/repo --commit SHA  # and label the report
bin/scout --agent --dir PATH                      # agent summary of a local checkout
```

The repository can be given as `owner/repo`, `github.com/owner/repo` or a full `https://github.com/` URL.

## Local checkouts

`--dir` runs the same checks over a directory on disk, with no GitHub API calls. It is meant for a CI job that has just checked out a pull request, on GitHub Actions or Gitea Actions. Repository settings (S1) are not applicable, and S5 skips OpenSSF Scorecard but still checks lockfiles against OSV.

It reads the tree as it is on disk, including untracked and ignored files, so the result matches a GitHub scan only for a clean checkout. Run it straight after checkout, before installing dependencies or building. It skips the top-level `.git`, never follows a symbolic link, reads only regular files, and runs nothing, not even `git`.

## Tokens

A token never goes on the command line or into the environment, where other processes could read it. `--gh-token` finds the `gh` you run by default without installing anything: it asks mise (`mise which gh`, which is how Omarchy installs `gh`) and falls back to `/usr/bin/gh`. It then runs `gh auth token` and keeps the result inside the scanner process. If GitHub rejects a token, the scan continues anonymously and the report says so.

## Output

The readable report shows every finding with its file and line. Under each S3 finding in a file it lists up to ten of the hidden characters, with the line, the code point, the column and the surrounding text. In that text every character outside printable ASCII is written as a code point in brackets such as `⟦U+202E⟧`, so the terminal displays the line in stored order. The JSON report is capped at about 1.5 MB. The lowest-severity findings are dropped first, and the report says when that happened.

`--agent` prints a summary built only from fixed rule IDs and descriptions, severities, statuses, counts, the repository name and the commit hash. See [agent skill](agent-skill.md) for what it guarantees.

`--agent --dir PATH` gives the same summary for a local checkout, so an agent can scan a folder again after a change. The report names the repository `local-checkout` with no commit, unless `--name owner/repo` and `--commit SHA` are given and valid. The folder path is never printed: the `full_report` command ends in the fixed word `PATH`. A missing folder returns the error code `dir-unreadable`, and a rejected label returns `invalid-dir-label`.

## Installed Omarchy plugins

```sh
bin/scout --installed                 # each plugin, its GitHub source and its commit, then packages with a GitHub home page
bin/scout --plugin ID                 # scan the installed copy
bin/scout --plugin ID --compare       # scan the copy and its source, and report the difference
```

`--compare` reports the installed commit against the source's latest commit, the installed files that differ from the source at the installed commit, and the findings that appear in one report and not the other. S1 is left out of that last list, because a folder on disk has no repository settings. Add `--gh-token` to `--compare` to use the GitHub CLI login, and `--json` to any of the three for JSON.

## AUR build recipes

```sh
bin/scout --aur NAME      # read the PKGBUILD and install script of an AUR package
```

The recipe is fetched from `aur.archlinux.org` and read as text. Nothing in it is run or sourced. The report is one check, S10, with the package's maintainer, dates and votes as facts. Findings cover sources with no checksum or a skipped one, repository checkouts with no commit or tag, sources over http, prebuilt binaries, downloads and package installs inside build functions, a download piped into a shell, `sudo`, setuid bits, encoded or evaluated strings, and an install script and what it does as root. An orphaned package, an out-of-date flag and a recipe changed in the last 14 days are reported too.
