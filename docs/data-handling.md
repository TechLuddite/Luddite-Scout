# Limitations and data handling

## Limitations

- Public repositories only, default branch only.
- Without a token, GitHub allows 60 API requests an hour per address. A review uses about five. File contents come from `raw.githubusercontent.com`, which does not count against that limit.
- Files over 1 MB and binary files are not scanned for hidden characters. Very large repositories may be covered partially, and the report says so.
- No AI model is used and no code from the scanned repository is run.

## Network access

All front ends contact the same four hosts and no others:

| Host | What it receives |
| --- | --- |
| `api.github.com` | The repository name and the API requests for its details and file list |
| `raw.githubusercontent.com` | Requests for file contents |
| `api.osv.dev` | Package names and versions from lockfiles |
| `api.securityscorecards.dev` | The repository name |

Those services see your IP address and what you looked up. The website's Content Security Policy and `bin/scout`'s host allowlist block every other host, and `bin/scout` refuses redirects. Results are not stored or shareable by link. See [about.html](../about.html) for the full statement.
