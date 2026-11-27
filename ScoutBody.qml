import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Commons as Commons
import qs.Ui

// The whole Scout view: title row, input row, status line, report and
// footer. The panel and the window each hold one, and both read the same
// state from `scout`, so a report started in one shows in the other.
ColumnLayout {
  id: view

  // The object that owns the scan: report, running, errorText, target,
  // startScan(target), stopScan(), list(), websiteUrl, shownPerCheck.
  required property var scout
  property bool inWindow: false
  property color foreground: Commons.Color.foreground
  property color accent: Commons.Color.accent
  property color urgent: Commons.Color.urgent
  property string fontFamily: Style.font.family
  property alias inputField: repoField

  signal closeRequested()
  signal windowRequested()

  spacing: Style.spacing.lg

  readonly property var order: ["high", "medium", "low", "info"]
  readonly property bool showList: view.scout.mode === "installed"
  readonly property bool showReport: view.scout.mode === "scan" && view.scout.report !== null
  readonly property var cmp: view.scout.report && view.scout.report.compare ? view.scout.report.compare : null
  // In a Compare run the source report is hidden until asked for.
  property bool showSourceReport: false
  onCmpChanged: showSourceReport = false

  function short(sha) { return sha ? String(sha).slice(0, 12) : "unknown" }

  function severityColor(sev) {
    return sev === "high" ? view.urgent : sev === "medium" ? view.accent : view.foreground
  }

  function counts(findings) {
    var c = { high: 0, medium: 0, low: 0, info: 0 }
    for (var i = 0; i < findings.length; i++) if (c[findings[i].severity] !== undefined) c[findings[i].severity]++
    return c
  }

  // [{ severity, n }] for the severities that have findings, worst first.
  function countList(c) {
    var out = []
    for (var i = 0; i < view.order.length; i++) if (c[view.order[i]]) out.push({ severity: view.order[i], n: c[view.order[i]] })
    return out
  }

  function worst(c) {
    for (var i = 0; i < view.order.length; i++) if (c[view.order[i]]) return view.order[i]
    return ""
  }

  function totals(report) {
    var c = { high: 0, medium: 0, low: 0, info: 0 }
    var checks = view.scout.list(report ? report.checks : null, 20)
    for (var i = 0; i < checks.length; i++) {
      var one = view.counts(view.scout.list(checks[i].findings, 500))
      for (var k in c) c[k] += one[k]
    }
    return c
  }

  function statusLabel(s) {
    return s === "ran" ? "Ran" : s === "partial" ? "Partial" : s === "skipped" ? "Skipped"
      : s === "not-applicable" ? "Not applicable" : String(s).slice(0, 20)
  }

  function location(f) {
    if (!f.path) return ""
    return String(f.path).slice(0, 300) + (f.line ? ":" + Number(f.line) : "")
  }

  // A count with its severity, on a tint of that severity's colour.
  component Chip: Rectangle {
    id: chip
    property string severity: "info"
    property string label: ""
    readonly property color tint: view.severityColor(severity)
    implicitWidth: chipText.implicitWidth + Style.spacing.controlPaddingX * 2
    implicitHeight: chipText.implicitHeight + Style.spacing.xs * 2
    radius: Style.cornerRadius
    color: Util.alpha(tint, severity === "info" ? 0.06 : 0.16)
    border.width: 1
    border.color: Util.alpha(tint, severity === "info" ? 0.2 : 0.5)
    Plain {
      id: chipText
      anchors.centerIn: parent
      text: chip.label
      color: chip.tint
      opacity: chip.severity === "info" ? 0.7 : 1.0
      font.family: view.fontFamily
      font.pixelSize: Style.font.bodySmall
      font.bold: chip.severity === "high"
    }
  }

  RowLayout {
    Layout.fillWidth: true
    spacing: Style.spacing.sm

    ColumnLayout {
      spacing: Style.spacing.xxs
      Plain {
        text: "Luddite Scout"
        color: view.foreground
        font.family: view.fontFamily
        font.pixelSize: Style.font.heading
        font.bold: true
      }
      Plain {
        text: "Checks a public GitHub repository. Runs nothing from it."
        color: view.foreground
        opacity: 0.6
        font.family: view.fontFamily
        font.pixelSize: Style.font.caption
      }
    }

    Item { Layout.fillWidth: true }

    PanelActionButton {
      // nf-md-puzzle, U+F0431, and nf-md-magnify, U+F0349
      iconText: String.fromCodePoint(view.scout.mode === "installed" ? 0xF0349 : 0xF0431)
      tooltipText: view.scout.mode === "installed" ? "Back to scanning a repository" : "Installed plugins and packages"
      foreground: view.foreground
      fontFamily: view.fontFamily
      onClicked: view.scout.mode === "installed" ? view.scout.mode = "scan" : view.scout.showInstalled()
    }

    PanelActionButton {
      visible: !view.inWindow
      // nf-md-open_in_new, U+F03CC
      iconText: String.fromCodePoint(0xF03CC)
      tooltipText: "Open as a window"
      foreground: view.foreground
      fontFamily: view.fontFamily
      onClicked: view.windowRequested()
    }

    PanelActionButton {
      iconText: "󰅖"
      tooltipText: "Close (Esc)"
      foreground: view.foreground
      fontFamily: view.fontFamily
      onClicked: view.closeRequested()
    }
  }

  RowLayout {
    Layout.fillWidth: true
    visible: view.scout.mode === "scan"
    spacing: Style.spacing.controlGap

    TextField {
      id: repoField
      Layout.fillWidth: true
      maximumLength: 300
      placeholderText: "owner/repo or https://github.com/owner/repo"
      foreground: view.foreground
      accent: view.accent
      font.family: view.fontFamily
      onTextEdited: view.scout.target = text
      onAccepted: view.scout.startScan(text)
      Component.onCompleted: text = view.scout.target
    }

    Button {
      text: view.scout.running ? "Stop" : "Scout"
      bordered: true
      foreground: view.foreground
      accent: view.accent
      fontFamily: view.fontFamily
      onClicked: view.scout.running ? view.scout.stopScan() : view.scout.startScan(repoField.text)
    }
  }

  // The panel and the window each have an input field. Keep them level.
  Connections {
    target: view.scout
    function onTargetChanged() { if (repoField.text !== view.scout.target) repoField.text = view.scout.target }
  }

  Plain {
    Layout.fillWidth: true
    visible: view.scout.running || view.scout.errorText !== ""
    text: view.scout.running
      ? (view.scout.mode === "installed" ? "Reading the plugins folder and the package database." : "Scanning. A large repository takes up to a minute.")
      : view.scout.errorText
    color: view.scout.errorText !== "" && !view.scout.running ? view.urgent : view.foreground
    opacity: view.scout.running ? 0.7 : 1.0
    font.family: view.fontFamily
  }

  PanelSeparator { Layout.fillWidth: true; foreground: view.foreground; visible: view.showReport || view.showList }

  // The installed Omarchy shell plugins, with the repository each came from.
  Flickable {
    Layout.fillWidth: true
    Layout.fillHeight: true
    visible: view.showList
    implicitHeight: plugins.implicitHeight
    Layout.minimumHeight: view.showList ? Style.space(160) : 0
    contentWidth: width
    contentHeight: plugins.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds

    ColumnLayout {
      id: plugins
      width: parent.width
      spacing: Style.spacing.md

      PanelSectionHeader {
        text: "INSTALLED PLUGINS"
        foreground: view.foreground
        fontFamily: view.fontFamily
      }

      Plain {
        Layout.fillWidth: true
        visible: view.scout.installed.length === 0 && !view.scout.running
        text: "No plugins found in the Omarchy plugins folder."
        color: view.foreground
        opacity: 0.7
        font.family: view.fontFamily
      }

      Repeater {
        model: view.scout.installed

        delegate: Rectangle {
          id: plugin
          required property var modelData
          readonly property string pluginId: String(modelData.id).slice(0, 100)
          readonly property string source: modelData.source ? String(modelData.source).slice(0, 140) : ""

          Layout.fillWidth: true
          implicitHeight: row.implicitHeight + Style.spacing.lg * 2
          radius: Style.cornerRadius
          color: Util.alpha(view.foreground, Style.normalFillAlpha)

          RowLayout {
            id: row
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.spacing.xxl
            anchors.rightMargin: Style.spacing.xxl
            spacing: Style.spacing.md

            ColumnLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.xxs
              Plain {
                Layout.fillWidth: true
                text: (plugin.modelData.name ? String(plugin.modelData.name).slice(0, 100) : plugin.pluginId)
                  + (plugin.modelData.version ? "  " + String(plugin.modelData.version).slice(0, 40) : "")
                color: view.foreground
                font.family: view.fontFamily
                font.bold: true
              }
              Plain {
                Layout.fillWidth: true
                text: plugin.pluginId
                color: view.foreground
                opacity: 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
              Plain {
                Layout.fillWidth: true
                text: (plugin.source !== "" ? "Source: " + plugin.source : "No GitHub origin recorded")
                  + (plugin.modelData.commit ? " at " + String(plugin.modelData.commit).slice(0, 12) : "")
                  + (plugin.modelData.linked === true ? "  ·  linked from outside the plugins folder" : "")
                color: view.foreground
                opacity: plugin.source !== "" ? 0.85 : 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            Button {
              text: "Installed"
              tooltipText: "Scan the copy on this machine"
              bordered: true
              foreground: view.foreground
              accent: view.accent
              fontFamily: view.fontFamily
              onClicked: view.scout.scanInstalled(plugin.pluginId)
            }
            Button {
              text: "Source"
              tooltipText: "Scan the repository it came from"
              visible: plugin.source !== ""
              bordered: true
              foreground: view.foreground
              accent: view.accent
              fontFamily: view.fontFamily
              onClicked: { view.scout.target = plugin.source; view.scout.startScan(plugin.source) }
            }
            Button {
              text: "Compare"
              tooltipText: "Scan both and show what differs"
              visible: plugin.source !== ""
              bordered: true
              foreground: view.foreground
              accent: view.accent
              fontFamily: view.fontFamily
              onClicked: view.scout.compareInstalled(plugin.pluginId)
            }
          }
        }
      }

      PanelSectionHeader {
        Layout.topMargin: Style.spacing.lg
        visible: view.scout.packages.length > 0
        text: "PACKAGES"
        foreground: view.foreground
        fontFamily: view.fontFamily
      }

      Plain {
        Layout.fillWidth: true
        visible: view.scout.packages.length > 0
        text: "Packages you installed by name that come from outside the pacman repositories, such as AUR builds, then those whose home page is a GitHub repository."
        color: view.foreground
        opacity: 0.6
        font.family: view.fontFamily
        font.pixelSize: Style.font.bodySmall
      }

      TextField {
        id: packageFilter
        Layout.fillWidth: true
        visible: view.scout.packages.length > 8
        maximumLength: 60
        placeholderText: "Filter packages"
        foreground: view.foreground
        accent: view.accent
        font.family: view.fontFamily
      }

      Repeater {
        model: {
          var q = String(packageFilter.text || "").toLowerCase()
          var out = []
          var rows = view.scout.packages
          for (var i = 0; i < rows.length && out.length < 200; i++) {
            if (q === "" || String(rows[i].name).toLowerCase().indexOf(q) !== -1 || String(rows[i].source || "").toLowerCase().indexOf(q) !== -1)
              out.push(rows[i])
          }
          return out
        }

        delegate: Rectangle {
          id: pkg
          required property var modelData
          readonly property string source: modelData.source ? String(modelData.source).slice(0, 140) : ""
          readonly property bool foreign: modelData.foreign === true

          Layout.fillWidth: true
          implicitHeight: pkgRow.implicitHeight + Style.spacing.md * 2
          radius: Style.cornerRadius
          color: Util.alpha(pkg.foreign ? view.accent : view.foreground, pkg.foreign ? 0.08 : 0.02)

          RowLayout {
            id: pkgRow
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.leftMargin: Style.spacing.xxl
            anchors.rightMargin: Style.spacing.xxl
            spacing: Style.spacing.md

            ColumnLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.xxs
              Plain {
                Layout.fillWidth: true
                text: String(pkg.modelData.name).slice(0, 128) + "  " + String(pkg.modelData.version).slice(0, 60)
                color: view.foreground
                font.family: view.fontFamily
                font.bold: pkg.foreign
              }
              Plain {
                Layout.fillWidth: true
                text: (pkg.source !== "" ? "Source: " + pkg.source : "No GitHub home page") + "  ·  "
                  + (pkg.foreign ? "not in a pacman repository" : pkg.modelData.repo ? "from " + String(pkg.modelData.repo).slice(0, 40) : "repository unknown")
                color: view.foreground
                opacity: 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            Button {
              text: "Recipe"
              tooltipText: "Read its AUR build recipe, which is what runs when it is built and installed"
              visible: pkg.foreign
              bordered: true
              foreground: view.foreground
              accent: view.accent
              fontFamily: view.fontFamily
              onClicked: view.scout.scanRecipe(String(pkg.modelData.name))
            }

            Button {
              text: "Source"
              tooltipText: "Scan the repository named as its home page"
              visible: pkg.source !== ""
              bordered: true
              foreground: view.foreground
              accent: view.accent
              fontFamily: view.fontFamily
              onClicked: { view.scout.target = pkg.source; view.scout.startScan(pkg.source) }
            }
          }
        }
      }
    }
  }

  Flickable {
    Layout.fillWidth: true
    Layout.fillHeight: true
    visible: view.showReport
    implicitHeight: body.implicitHeight
    Layout.minimumHeight: view.scout.report ? Style.space(160) : 0
    contentWidth: width
    contentHeight: body.implicitHeight
    clip: true
    boundsBehavior: Flickable.StopAtBounds

    ColumnLayout {
      id: body
      width: parent.width
      spacing: Style.spacing.lg

      // What was scanned, and the totals across every check.
      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.spacing.sm

        Plain {
          Layout.fillWidth: true
          text: !view.scout.report ? ""
            : view.cmp && view.scout.report.plugin ? String(view.scout.report.plugin.id).slice(0, 100) + " against " + String(view.scout.report.repository).slice(0, 140)
            : String(view.scout.report.repository).slice(0, 200)
          color: view.foreground
          font.family: view.fontFamily
          font.pixelSize: Style.font.title
          font.bold: true
        }
        Plain {
          Layout.fillWidth: true
          visible: text !== ""
          text: !view.scout.report ? ""
            : (view.scout.report.plugin && !view.cmp ? "Installed copy of " + String(view.scout.report.plugin.id).slice(0, 100) + ". " : "")
              + (view.cmp ? "" : view.scout.report.commit ? "Commit " + String(view.scout.report.commit).slice(0, 12) : "")
          color: view.foreground
          opacity: 0.6
          font.family: view.fontFamily
          font.pixelSize: Style.font.bodySmall
        }
        Flow {
          Layout.fillWidth: true
          spacing: Style.spacing.sm
          Repeater {
            model: view.cmp === null || view.showSourceReport ? view.countList(view.totals(view.scout.report)) : []
            delegate: Chip {
              required property var modelData
              severity: modelData.severity
              label: modelData.n + " " + modelData.severity
            }
          }
          Plain {
            visible: view.scout.report !== null && view.cmp === null && view.worst(view.totals(view.scout.report)) === ""
            text: "No findings."
            color: view.foreground
            opacity: 0.7
            font.family: view.fontFamily
          }
        }
      }

      // A Compare run shows only what differs. The source report stays one
      // button away.
      ColumnLayout {
        Layout.fillWidth: true
        visible: view.cmp !== null
        spacing: Style.spacing.lg

        readonly property var files: view.cmp ? view.cmp.files : null
        readonly property string verdict: view.cmp ? String(view.cmp.verdict) : ""

        Rectangle {
          Layout.fillWidth: true
          implicitHeight: verdictCol.implicitHeight + Style.spacing.xxl * 2
          radius: Style.cornerRadius
          readonly property color tint: parent.verdict === "modified" ? view.urgent : parent.verdict === "identical" ? view.accent : view.foreground
          color: Util.alpha(tint, 0.08)
          border.width: 1
          border.color: Util.alpha(tint, 0.45)

          ColumnLayout {
            id: verdictCol
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            anchors.margins: Style.spacing.xxl
            spacing: Style.spacing.sm

            Plain {
              Layout.fillWidth: true
              text: !view.cmp ? ""
                : view.cmp.verdict === "modified" ? "The installed copy differs from its source"
                : view.cmp.verdict === "identical" ? "The installed copy matches its source"
                : "The files could not be compared"
              color: view.cmp && view.cmp.verdict === "modified" ? view.urgent : view.foreground
              font.family: view.fontFamily
              font.pixelSize: Style.font.heading
              font.bold: true
            }
            Plain {
              Layout.fillWidth: true
              readonly property var f: view.cmp ? view.cmp.files : null
              text: !view.cmp ? ""
                : !f ? "The installed commit is unknown or is not in the source repository."
                : view.cmp.verdict === "modified"
                  ? Number(f.changedCount) + " changed, " + Number(f.addedCount) + " added, " + Number(f.missingCount) + " missing, of " + Number(f.checked) + " files checked against commit " + view.short(view.cmp.installedCommit) + "."
                  : "All " + Number(f.checked) + " files are byte for byte what the source has at commit " + view.short(view.cmp.installedCommit) + "."
              color: view.foreground
              font.family: view.fontFamily
            }
            Plain {
              Layout.fillWidth: true
              text: !view.cmp ? ""
                : view.cmp.sameCommit === true ? "That is the latest commit."
                : view.cmp.behind !== null && view.cmp.behind !== undefined
                  ? "The source is " + Number(view.cmp.behind) + (Number(view.cmp.behind) === 1 ? " commit" : " commits") + " newer, at " + view.short(view.cmp.sourceCommit) + "."
                  : "The latest source commit is " + view.short(view.cmp.sourceCommit) + "."
              color: view.foreground
              opacity: 0.7
              font.family: view.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
        }

        // Changed files, each with the lines that differ.
        Repeater {
          model: view.cmp && view.cmp.files ? view.scout.list(view.cmp.files.diffs, 8) : []
          delegate: Rectangle {
            id: diff
            required property var modelData
            Layout.fillWidth: true
            implicitHeight: diffCol.implicitHeight + Style.spacing.lg * 2
            radius: Style.cornerRadius
            color: Util.alpha(view.foreground, Style.normalFillAlpha)

            ColumnLayout {
              id: diffCol
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.top: parent.top
              anchors.margins: Style.spacing.xxl
              anchors.topMargin: Style.spacing.lg
              spacing: Style.spacing.xxs

              Plain {
                Layout.fillWidth: true
                text: "Changed  " + String(diff.modelData.path).slice(0, 300)
                color: view.foreground
                font.family: view.fontFamily
                font.bold: true
              }
              Plain {
                Layout.fillWidth: true
                visible: text !== ""
                text: diff.modelData.note ? String(diff.modelData.note).slice(0, 200) : ""
                color: view.foreground
                opacity: 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
              Repeater {
                model: view.scout.list(diff.modelData.lines, 40)
                delegate: Plain {
                  required property var modelData
                  readonly property string kind: String(modelData).charAt(0)
                  Layout.fillWidth: true
                  wrapMode: Text.WrapAnywhere
                  text: String(modelData).slice(0, 200)
                  color: kind === "+" ? view.accent : kind === "-" ? view.urgent : view.foreground
                  opacity: kind === "+" || kind === "-" ? 1.0 : 0.55
                  font.family: view.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }
              Plain {
                Layout.fillWidth: true
                visible: Number(diff.modelData.more) > 0
                text: Number(diff.modelData.more) + " more lines. bin/scout --plugin ID --compare stops at the same point, so compare the file by hand."
                color: view.foreground
                opacity: 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }
          }
        }

        // Files added to or missing from the installed copy, and changed
        // files past the first eight.
        Repeater {
          model: {
            var out = []
            var f = view.cmp ? view.cmp.files : null
            if (!f) return out
            var shown = {}
            var diffs = view.scout.list(f.diffs, 8)
            for (var d = 0; d < diffs.length; d++) shown[String(diffs[d].path)] = true
            var kinds = [["changed", "Changed"], ["added", "Added, not in the source"], ["missing", "Missing from the installed copy"]]
            for (var k = 0; k < kinds.length; k++) {
              var rows = view.scout.list(f[kinds[k][0]], 50)
              for (var i = 0; i < rows.length; i++) if (!shown[String(rows[i])]) out.push([kinds[k][1], String(rows[i]).slice(0, 300)])
            }
            return out
          }
          delegate: RowLayout {
            required property var modelData
            Layout.fillWidth: true
            spacing: Style.spacing.md
            Plain {
              text: modelData[0]
              color: view.urgent
              font.family: view.fontFamily
              font.pixelSize: Style.font.bodySmall
              font.bold: true
            }
            Plain {
              Layout.fillWidth: true
              text: modelData[1]
              color: view.foreground
              font.family: view.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
        }

        // Findings that only one of the two scans reports.
        Repeater {
          model: view.cmp ? [["onlyInstalled", "Findings only in the installed copy"],
                             ["onlySource", view.cmp.sameCommit === true ? "Findings only in the source" : "Findings only in the newer source"]] : []
          delegate: ColumnLayout {
            id: side
            required property var modelData
            readonly property var rows: view.cmp ? view.scout.list(view.cmp[modelData[0]], 100) : []
            readonly property int total: view.cmp ? Number(view.cmp[modelData[0] + "Count"]) || 0 : 0
            Layout.fillWidth: true
            visible: side.total > 0
            spacing: Style.spacing.xxs
            PanelSectionHeader {
              text: (side.modelData[1] + ": " + side.total).toUpperCase()
              foreground: view.foreground
              fontFamily: view.fontFamily
            }
            Repeater {
              model: side.rows
              delegate: Plain {
                required property var modelData
                Layout.fillWidth: true
                text: String(modelData.severity).toUpperCase().slice(0, 6) + "  " + String(modelData.title).slice(0, 200)
                  + (modelData.path ? "  ·  " + String(modelData.path).slice(0, 200) : "")
                color: view.severityColor(modelData.severity)
                opacity: modelData.severity === "info" ? 0.6 : 1.0
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }
          }
        }

        Plain {
          Layout.fillWidth: true
          visible: view.cmp !== null && Number(view.cmp.onlyInstalledCount) === 0 && Number(view.cmp.onlySourceCount) === 0
          text: "Both scans report the same findings."
          color: view.foreground
          opacity: 0.7
          font.family: view.fontFamily
        }

        Button {
          text: view.showSourceReport ? "Hide the source report" : "Show the source report"
          bordered: true
          foreground: view.foreground
          accent: view.accent
          fontFamily: view.fontFamily
          onClicked: view.showSourceReport = !view.showSourceReport
        }
      }

      Repeater {
        model: view.scout.report && (view.cmp === null || view.showSourceReport) ? view.scout.report.checks : []

        // One card for each check, with a bar down its left edge in the
        // colour of its worst finding.
        delegate: Rectangle {
          id: check
          required property var modelData
          readonly property var findings: view.scout.list(modelData.findings, 500)
          readonly property var tally: view.counts(findings)
          readonly property string worstSeverity: view.worst(tally)
          readonly property bool quiet: findings.length === 0

          Layout.fillWidth: true
          implicitHeight: card.implicitHeight + Style.spacing.lg * 2
          radius: Style.cornerRadius
          color: Util.alpha(view.foreground, check.quiet ? 0.02 : Style.normalFillAlpha)

          Rectangle {
            width: Style.space(3)
            height: parent.height
            radius: Style.cornerRadius
            color: check.quiet ? Util.alpha(view.foreground, 0.15) : view.severityColor(check.worstSeverity)
            opacity: check.worstSeverity === "low" || check.worstSeverity === "info" ? 0.5 : 1.0
          }

          ColumnLayout {
            id: card
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.leftMargin: Style.spacing.xxl + Style.space(3)
            anchors.rightMargin: Style.spacing.xxl
            anchors.topMargin: Style.spacing.lg
            spacing: Style.spacing.sm

            RowLayout {
              Layout.fillWidth: true
              spacing: Style.spacing.md
              Plain {
                text: String(check.modelData.id).slice(0, 4)
                color: view.accent
                font.family: view.fontFamily
                font.bold: true
              }
              Plain {
                Layout.fillWidth: true
                text: String(check.modelData.name).slice(0, 60)
                color: view.foreground
                opacity: check.quiet ? 0.75 : 1.0
                font.family: view.fontFamily
                font.bold: true
              }
              Plain {
                text: view.statusLabel(check.modelData.status)
                color: check.modelData.status === "skipped" ? view.urgent : view.foreground
                opacity: check.modelData.status === "ran" ? 0.5 : 0.9
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            Flow {
              Layout.fillWidth: true
              visible: !check.quiet
              spacing: Style.spacing.sm
              Repeater {
                model: view.countList(check.tally)
                delegate: Chip {
                  required property var modelData
                  severity: modelData.severity
                  label: modelData.n + " " + modelData.severity
                }
              }
            }

            Repeater {
              model: view.scout.list(check.modelData.notes, 6)
              delegate: Plain {
                required property var modelData
                Layout.fillWidth: true
                text: String(modelData).slice(0, 300)
                color: view.foreground
                opacity: 0.6
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            Repeater {
              model: view.scout.list(check.modelData.facts, 16)
              delegate: Plain {
                required property var modelData
                Layout.fillWidth: true
                text: String(modelData[0]).slice(0, 60) + ": " + String(modelData[1]).slice(0, 300)
                color: view.foreground
                font.family: view.fontFamily
                font.pixelSize: Style.font.bodySmall
              }
            }

            PanelSeparator { Layout.fillWidth: true; foreground: view.foreground; visible: !check.quiet; strength: 0.08 }

            Repeater {
              model: check.findings.slice(0, view.scout.shownPerCheck)
              delegate: RowLayout {
                id: finding
                required property var modelData
                Layout.fillWidth: true
                spacing: Style.spacing.md

                Plain {
                  Layout.alignment: Qt.AlignTop
                  Layout.preferredWidth: Style.space(52)
                  text: String(finding.modelData.severity).toUpperCase().slice(0, 6)
                  color: view.severityColor(finding.modelData.severity)
                  opacity: finding.modelData.severity === "info" ? 0.6 : 1.0
                  font.family: view.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.bold: true
                }
                ColumnLayout {
                  Layout.fillWidth: true
                  spacing: Style.spacing.xxs
                  Plain {
                    Layout.fillWidth: true
                    text: String(finding.modelData.title).slice(0, 300)
                    color: view.foreground
                    font.family: view.fontFamily
                  }
                  Plain {
                    Layout.fillWidth: true
                    visible: text !== ""
                    text: view.location(finding.modelData)
                    color: view.foreground
                    opacity: 0.6
                    font.family: view.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }
              }
            }

            Plain {
              Layout.fillWidth: true
              visible: check.findings.length > view.scout.shownPerCheck
              text: (check.findings.length - view.scout.shownPerCheck) + " more. The website and bin/scout show the full list."
              color: view.foreground
              opacity: 0.6
              font.family: view.fontFamily
              font.pixelSize: Style.font.bodySmall
            }
          }
        }
      }
    }
  }

  // In a window taller than its content, keep the rows together at the top.
  Item { Layout.fillHeight: true; visible: !view.showReport && !view.showList }

  PanelSeparator { Layout.fillWidth: true; foreground: view.foreground }

  RowLayout {
    Layout.fillWidth: true
    spacing: Style.spacing.sm

    Plain {
      Layout.fillWidth: true
      text: view.scout.report && view.scout.report.api && view.scout.report.api.local === true
        ? "This report used no GitHub API requests."
        : view.scout.report && view.scout.report.api
        ? "GitHub API, " + (view.scout.report.api.authenticated === true ? "signed in through gh" : "anonymous") + ": "
          + Number(view.scout.report.api.remaining) + " of " + Number(view.scout.report.api.limit) + " requests left this hour."
          + (view.scout.report.api.tokenRejected === true ? " GitHub rejected the gh token." : "")
        : "Findings are pattern matches for you to judge, not a verdict."
      color: view.foreground
      opacity: 0.6
      font.family: view.fontFamily
      font.pixelSize: Style.font.caption
    }

    Button {
      text: "Open website"
      bordered: true
      foreground: view.foreground
      accent: view.accent
      fontFamily: view.fontFamily
      onClicked: Qt.openUrlExternally(view.scout.websiteUrl)
    }
  }
}
