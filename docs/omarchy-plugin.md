# Omarchy plugin

A bar widget and panel for the Omarchy desktop. It runs the same checks as the website and the terminal.

## Install

```sh
omarchy plugin add https://github.com/TechLuddite/Luddite-Scout
omarchy plugin enable io.github.techluddite.luddite-scout
```

The plugin needs `/usr/bin/python3`, which Omarchy ships. It has no settings.

## Use

The bar icon opens a panel. Type a repository as `owner/repo` or a github.com URL and press Enter. The panel runs `bin/scout --json` under `/usr/bin/timeout`, which stops a scan after four minutes, and shows the report.

![The Luddite Scout panel open under the Omarchy bar, showing a report for TechLuddite/luddite-gestures](screenshots/omarchy-desktop.png)

The report starts with the totals for each severity. Each check is a card with a bar down its left edge in the colour of its worst finding.

The button next to Close opens the same view as a normal window, which Hyprland tiles like any other. The panel and the window share one scan, so a report started in one shows in the other.

## Installed plugins

The puzzle button in the title row lists the Omarchy shell plugins in `~/.config/omarchy/plugins`, with the GitHub repository each was cloned from and the commit it is at. Each row has up to three buttons:

- **Installed** scans the copy on this machine. It uses no network unless the plugin has lockfiles.
- **Source** scans the repository the plugin came from, at its latest commit.
- **Compare** runs both scans and shows what differs: the two commits, every installed file that does not match the source at the installed commit, and the findings that appear in one report and not the other.

A plugin with no GitHub origin, such as one linked in from a system package, has the Installed button only. The list is read by `bin/scout --installed`, which reads the manifest and the `.git` folder of each plugin as plain files and does not run git.

The panel shows up to eight findings per check. The website or the terminal shows the rest. Open website, at the bottom of the panel, opens https://techluddite.github.io/Luddite-Scout/ in your browser.

If you are signed in to the GitHub CLI (`gh auth login`), the panel uses that login, which raises GitHub's limit from 60 to 5,000 requests an hour. The token stays inside `bin/scout` and is sent only to `api.github.com`. Without a login the panel works anonymously.

## What it touches

- It starts one process per scan, per listing of installed plugins and per comparison: `/usr/bin/timeout` running `/usr/bin/python3 -I -S bin/scout`, with a cleared environment and a fixed `PATH`. It starts nothing else.
- For the installed plugins list it reads `~/.config/omarchy/plugins`. A plugin ID is checked against a fixed pattern before it reaches the helper, and the helper builds the folder path itself.
- It reads at most about 2 MB of the scan's output and renders all of it as plain text.
- It writes no files and keeps no state, cache, credentials or configuration.
- It contacts the four hosts listed in [data handling](data-handling.md), through `bin/scout` only.

## Remove

```sh
omarchy plugin remove io.github.techluddite.luddite-scout
```

Nothing is left behind, because the plugin keeps nothing outside its own folder.
