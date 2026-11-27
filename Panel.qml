import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
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

  // The helper gets a fixed PATH and only what the GitHub CLI needs to reach
  // its stored login: the home and config directories, and the session bus
  // for a token kept in the keyring. bin/scout reads the token from gh's
  // output itself, so it never passes through this panel.
  readonly property var processEnvironment: ({
    PATH: "/usr/bin:/bin",
    HOME: Quickshell.env("HOME"),
    LANG: "C.UTF-8",
    XDG_CONFIG_HOME: Quickshell.env("XDG_CONFIG_HOME") || "",
    XDG_RUNTIME_DIR: Quickshell.env("XDG_RUNTIME_DIR") || "",
    DBUS_SESSION_BUS_ADDRESS: Quickshell.env("DBUS_SESSION_BUS_ADDRESS") || ""
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
  // What is typed in the input field, shared by the panel and the window.
  property string target: ""
  // "scan" shows the input and a report, "installed" the plugin list.
  property string mode: "scan"
  property var installed: []
  property var packages: []

  readonly property color foreground: bar ? bar.foreground : Commons.Color.popups.text
  readonly property color accent: Commons.Color.accent
  readonly property color urgent: bar ? bar.urgent : Commons.Color.urgent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  // owner/repo, github.com/owner/repo or https://github.com/owner/repo[...].
  // Checked here so nothing option-shaped or odd reaches the helper's argv;
  // bin/scout validates it again.
  function validInput(s) {
    return /^(https:\/\/)?(www\.)?(github\.com\/)?[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}(\/[A-Za-z0-9._\/-]{0,200})?$/.test(s)
  }

  // Starts bin/scout with the given arguments. One helper process at a
  // time: a new run stops the one before it.
  function run(args) {
    scanProc.running = false
    root.generation += 1
    root.reportBuffer = ""
    root.errorBuffer = ""
    root.overflowed = false
    root.errorText = ""
    root.running = true
    scanProc.runGeneration = root.generation
    scanProc.command = ["/usr/bin/timeout", "-k", "5", "240",
                        "/usr/bin/python3", "-I", "-S", root.pluginDir + "/bin/scout", "--json"].concat(args)
    scanProc.running = true
  }

  function startScan(text) {
    var target = String(text || "").trim()
    if (!validInput(target)) {
      root.errorText = "Enter a public repository as owner/repo or a github.com URL."
      return
    }
    root.report = null
    root.mode = "scan"
    root.run(["--gh-token", target])
  }

  // Plugin IDs come from bin/scout's own listing of the plugins folder.
  // Checked again here so nothing option-shaped reaches the helper's argv.
  function validId(s) {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(s)
  }

  function showInstalled() {
    root.mode = "installed"
    root.run(["--installed"])
  }

  function scanInstalled(id) {
    if (!validId(String(id))) return
    root.report = null
    root.mode = "scan"
    root.run(["--plugin", String(id)])
  }

  // Package names come from bin/scout's listing of the pacman database.
  function validPackage(s) {
    return /^[a-z0-9@._+][a-z0-9@._+-]{0,127}$/.test(s)
  }

  function scanRecipe(name) {
    if (!validPackage(String(name))) return
    root.report = null
    root.mode = "scan"
    root.run(["--aur", String(name)])
  }

  function compareInstalled(id) {
    if (!validId(String(id))) return
    root.report = null
    root.mode = "scan"
    root.run(["--gh-token", "--compare", "--plugin", String(id)])
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
    } else if (data && data.installed !== undefined) {
      root.installed = root.list(data.installed, 500)
      root.packages = root.list(data.packages, 500)
    } else if (data && root.list(data.checks, 21).length > 0 && root.list(data.checks, 21).length <= 20) {
      root.report = data
    } else if (code === 124 || code === 137) {
      root.errorText = "The scan took longer than four minutes and was stopped."
    } else {
      var err = root.errorBuffer.trim().slice(0, 300)
      root.errorText = err !== "" ? err : "The scan failed (exit " + code + ")."
    }
  }

  // Lists inside a Repeater's modelData arrive as Qt sequence types, for
  // which Array.isArray is false. Copy any list-like value into a plain
  // array, capped at max items.
  function list(v, max) {
    var out = []
    if (!v || typeof v === "string") return out
    var n = Math.min(Number(v.length) || 0, max)
    for (var i = 0; i < n; i++) out.push(v[i])
    return out
  }

  // The same view as a normal window, which Hyprland tiles like any other.
  function openWindow() {
    root.close()
    window.visible = true
    Qt.callLater(function () { windowBody.inputField.forceActiveFocus() })
  }

  Component.onDestruction: stopScan()

  FloatingWindow {
    id: window
    visible: false
    title: "Luddite Scout"
    color: Commons.Color.background
    implicitWidth: 860
    implicitHeight: 900
    minimumSize: Qt.size(480, 360)

    FocusScope {
      anchors.fill: parent
      focus: true
      Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Escape) { window.visible = false; event.accepted = true }
      }

      ScoutBody {
        id: windowBody
        anchors.fill: parent
        anchors.margins: Style.spacing.huge
        scout: root
        inWindow: true
        onCloseRequested: window.visible = false
      }
    }
  }

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
    focusTarget: column.inputField
    contentWidth: panel.fittedContentWidth(Style.space(760))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(700))

    Item {
      id: keys
      anchors.fill: parent
      Keys.onPressed: function (event) {
        if (event.key === Qt.Key_Escape) { root.close(); event.accepted = true }
      }

      ScoutBody {
        id: column
        anchors.fill: parent
        scout: root
        foreground: root.foreground
        accent: root.accent
        urgent: root.urgent
        fontFamily: root.fontFamily
        onCloseRequested: root.close()
        onWindowRequested: root.openWindow()
      }
    }
  }
}
