# Development

```sh
npm test        # node --test and python3 -m unittest, no packages to install
npm run serve   # python3 -m http.server 8000
```

## Layout

| Path | Contents |
| --- | --- |
| `index.html`, `about.html`, `css/`, `js/` | The website |
| `js/checks/` | The checks, as used by the website |
| `bin/scout` | The checks, as used by the terminal, the Omarchy panel and the agent skill |
| `BarIcon.qml`, `Panel.qml`, `Plain.qml`, `manifest.json`, `preview.png` | The Omarchy plugin |
| `test/` | Tests for both implementations, and shared cases in `test/fixtures/cases.json` |
| `docs/` | This documentation |

## Two implementations, one set of cases

The checks exist twice: in `js/checks/` for the website and in `bin/scout` for everything else. Both run the same cases from `test/fixtures/cases.json`, and finding titles must match, so a rule changed in one place and not the other fails the tests. A further test runs S3 over this repository itself.

Every finding in `bin/scout` carries a `rule` ID from the `RULES` table, which `--agent` mode uses in place of the title. A new finding needs a new entry there, and the shared-case tests fail if a finding has no known rule.

## The agent skill

The skill is built and released from [TechLuddite/luddite-scout-skill](https://github.com/TechLuddite/luddite-scout-skill), which pins a commit of `bin/scout` from this repository. A change to `bin/scout` reaches the skill when that pin is updated there.

## Continuous integration

`.github/workflows/test.yml` runs `npm test` on every push to `main` and on every pull request, with read-only permissions.
