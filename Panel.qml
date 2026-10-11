import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

// Luddite Scout: type a public GitHub repository, get the same report the
// website gives, without leaving the desktop.
//
// All network access and all checking happens in bin/scout, a separate
// Python process with a fixed host allowlist, response caps and an overall
// deadline. This panel only starts it, reads at most maxReportChars of its
// JSON output, and shows the result. Nothing is written to disk.
Panel {
  id: root
  moduleName: "io.github.techluddite.luddite-scout"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null

  readonly property string pluginDir:
    String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "").replace(/\/$/, "")
  readonly property string websiteUrl: "https://techluddite.github.io/Luddite-Scout/"

  // The helper gets a fixed PATH and nothing else from the shell's environment.
  readonly property var processEnvironment: ({
    PATH: "/usr/bin:/bin",
    HOME: Quickshell.env("HOME"),
    LANG: "C.UTF-8"
  })

  readonly property int maxReportChars: 2000000
  readonly property int maxErrorChars: 2000
  readonly property int shownPerCheck: 8

  property string reportBuffer: ""
  property string errorBuffer: ""
  property bool overflowed: false
  property int generation: 0
  property bool running: false

  property var report: null
  property string errorText: ""

  readonly property color foreground: bar ? bar.foreground : Color.popups.text
  readonly property color accent: Color.accent
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // owner/repo, github.com/owner/repo or https://github.com/owner/repo[...].
  // Checked here so nothing option-shaped or odd reaches the helper's argv;
  // bin/scout validates it again.
  function validInput(s) {
    return /^(https:\/\/)?(www\.)?(github\.com\/)?[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._\/-]{0,200})?$/.test(s)
  }

  function startScan() {
    var target = String(repoField.text || "").trim()
    if (!validInput(target)) {
      root.errorText = "Enter a public repository as owner/repo or a github.com URL."
      return
    }
    scanProc.running = false
    root.generation += 1
    root.reportBuffer = ""
    root.errorBuffer = ""
    root.overflowed = false
    root.report = null
    root.errorText = ""
    root.running = true
    scanProc.runGeneration = root.generation
    scanProc.command = ["/usr/bin/timeout", "-k", "5", "240",
                        "/usr/bin/python3", "-I", "-S", root.pluginDir + "/bin/scout", "--json", target]
    scanProc.running = true
  }

  function stopScan() {
    if (scanProc.running) scanProc.running = false
    root.running = false
  }

  function finish(code, gen) {
    if (gen !== root.generation) return
    root.running = false
    if (root.overflowed) {
      root.errorText = "The report was larger than the panel accepts. Use the website or bin/scout in a terminal."
      return
    }
    var data = null
    try { data = JSON.parse(root.reportBuffer) } catch (e) { data = null }
    root.reportBuffer = ""
    if (data && typeof data.error === "string") {
      root.errorText = data.error.slice(0, 300)
    } else if (data && Array.isArray(data.checks) && data.checks.length <= 20) {
      root.report = data
    } else if (code === 124 || code === 137) {
      root.errorText = "The scan took longer than four minutes and was stopped."
    } else {
      var err = root.errorBuffer.trim().slice(0, 300)
      root.errorText = err !== "" ? err : "The scan failed (exit " + code + ")."
    }
  }

  function severityColor(sev) {
    return sev === "high" ? root.urgent : sev === "medium" ? root.accent : root.foreground
  }

  function countsText(findings) {
    var c = { high: 0, medium: 0, low: 0, info: 0 }
    for (var i = 0; i < findings.length; i++) if (c[findings[i].severity] !== undefined) c[findings[i].severity]++
    var parts = []
    var order = ["high", "medium", "low", "info"]
    for (var j = 0; j < order.length; j++) if (c[order[j]]) parts.push(c[order[j]] + " " + order[j])
    return parts.join(", ")
  }

  function statusLabel(s) {
    return s === "ran" ? "Ran" : s === "partial" ? "Partial" : s === "skipped" ? "Skipped"
      : s === "not-applicable" ? "Not applicable" : String(s).slice(0, 20)
  }

  function location(f) {
    if (!f.path) return ""
    return String(f.path).slice(0, 300) + (f.line ? ":" + Number(f.line) : "")
  }

  Component.onDestruction: stopScan()

  Process {
    id: scanProc
    property int runGeneration: 0
    clearEnvironment: true
    environment: root.processEnvironment
    stdout: SplitParser {
      splitMarker: ""
      onRead: function (chunk) {
        if (scanProc.runGeneration !== root.generation || root.overflowed) return
        if (root.reportBuffer.length + chunk.length > root.maxReportChars) {
          root.overflowed = true
          root.reportBuffer = ""
          scanProc.signal(15)
          return
        }
        root.reportBuffer += chunk
      }
    }
    stderr: SplitParser {
      splitMarker: ""
      onRead: function (chunk) {
        if (root.errorBuffer.length < root.maxErrorChars)
          root.errorBuffer = (root.errorBuffer + chunk).slice(0, root.maxErrorChars)
      }
    }
    onExited: function (code) { root.finish(code, scanProc.runGeneration) }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.hostWidget || root
    bar: root.bar
    open: root.opened
    focusTarget: repoField
    contentWidth: panel.fittedContentWidth(Style.space(760))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(700))

    Item {
      id: keys
      anchors.fill: parent
      Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Escape) { root.close(); event.accepted = true }
      }

      ColumnLayout {
        id: column
        anchors.fill: parent
        spacing: Style.spacing.md

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          ColumnLayout {
            spacing: 0
            Plain {
              text: "Luddite Scout"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }
            Plain {
              text: "Checks a public GitHub repository. Runs nothing from it."
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }
          }

          Item { Layout.fillWidth: true }

          PanelActionButton {
            iconText: "󰅖"
            tooltipText: "Close (Esc)"
            foreground: root.foreground
            fontFamily: root.fontFamily
            onClicked: root.close()
          }
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          TextField {
            id: repoField
            Layout.fillWidth: true
            maximumLength: 300
            placeholderText: "owner/repo or https://github.com/owner/repo"
            foreground: root.foreground
            accent: root.accent
            font.family: root.fontFamily
            onAccepted: root.startScan()
          }

          Button {
            text: root.running ? "Stop" : "Scout"
            bordered: true
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.running ? root.stopScan() : root.startScan()
          }
        }

        Plain {
          Layout.fillWidth: true
          visible: root.running || root.errorText !== ""
          text: root.running ? "Scanning. A large repository takes up to a minute." : root.errorText
          color: root.errorText !== "" && !root.running ? root.urgent : root.foreground
          opacity: root.running ? 0.7 : 1.0
          font.family: root.fontFamily
        }

        PanelSeparator { Layout.fillWidth: true; foreground: root.foreground; visible: root.report !== null }

        Flickable {
          Layout.fillWidth: true
          Layout.fillHeight: true
          visible: root.report !== null
          implicitHeight: body.implicitHeight
          Layout.minimumHeight: root.report ? Style.space(160) : 0
          contentWidth: width
          contentHeight: body.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds

          ColumnLayout {
            id: body
            width: parent.width
            spacing: Style.spacing.md

            Plain {
              Layout.fillWidth: true
              text: root.report ? String(root.report.repository).slice(0, 200) + " at " + String(root.report.commit).slice(0, 12) : ""
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.title
            }

            Repeater {
              model: root.report ? root.report.checks : []

              delegate: ColumnLayout {
                id: check
                required property var modelData
                readonly property var findings: Array.isArray(modelData.findings) ? modelData.findings : []
                Layout.fillWidth: true
                spacing: Style.spacing.xs

                Plain {
                  Layout.fillWidth: true
                  text: String(check.modelData.id).slice(0, 4) + "  " + String(check.modelData.name).slice(0, 60)
                    + "  ·  " + root.statusLabel(check.modelData.status)
                    + (check.findings.length ? "  ·  " + root.countsText(check.findings) : "")
                  color: root.foreground
                  font.family: root.fontFamily
                  font.bold: true
                }

                Repeater {
                  model: Array.isArray(check.modelData.notes) ? check.modelData.notes.slice(0, 6) : []
                  delegate: Plain {
                    required property var modelData
                    Layout.fillWidth: true
                    text: String(modelData).slice(0, 300)
                    color: root.foreground
                    opacity: 0.6
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }

                Repeater {
                  model: Array.isArray(check.modelData.facts) ? check.modelData.facts.slice(0, 16) : []
                  delegate: Plain {
                    required property var modelData
                    Layout.fillWidth: true
                    text: String(modelData[0]).slice(0, 60) + ": " + String(modelData[1]).slice(0, 300)
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.bodySmall
                  }
                }

                Repeater {
                  model: check.findings.slice(0, root.shownPerCheck)
                  delegate: ColumnLayout {
                    id: finding
                    required property var modelData
                    Layout.fillWidth: true
                    spacing: 0

                    Plain {
                      Layout.fillWidth: true
                      text: String(finding.modelData.severity).toUpperCase().slice(0, 6) + "  " + String(finding.modelData.title).slice(0, 300)
                      color: root.severityColor(finding.modelData.severity)
                      font.family: root.fontFamily
                    }
                    Plain {
                      Layout.fillWidth: true
                      visible: text !== ""
                      text: root.location(finding.modelData)
                      color: root.foreground
                      opacity: 0.6
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }
                  }
                }

                Plain {
                  Layout.fillWidth: true
                  visible: check.findings.length > root.shownPerCheck
                  text: (check.findings.length - root.shownPerCheck) + " more. The website and bin/scout show the full list."
                  color: root.foreground
                  opacity: 0.6
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                }
              }
            }
          }
        }

        RowLayout {
          Layout.fillWidth: true
          spacing: Style.spacing.sm

          Plain {
            Layout.fillWidth: true
            text: root.report && root.report.api
              ? "GitHub API: " + Number(root.report.api.remaining) + " of " + Number(root.report.api.limit) + " requests left this hour."
              : "Findings are pattern matches for you to judge, not a verdict."
            color: root.foreground
            opacity: 0.6
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Button {
            text: "Open website"
            bordered: true
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: Qt.openUrlExternally(root.websiteUrl)
          }
        }
      }
    }
  }
}
