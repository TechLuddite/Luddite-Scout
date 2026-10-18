"""Runs the shared cases in test/fixtures/cases.json against bin/scout.

    python3 -m unittest discover -s test
"""
import importlib.machinery
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
_loader = importlib.machinery.SourceFileLoader("scout", str(ROOT / "bin" / "scout"))
_spec = importlib.util.spec_from_loader("scout", _loader)
scout = importlib.util.module_from_spec(_spec)
_loader.exec_module(scout)

CASES = json.loads((ROOT / "test" / "fixtures" / "cases.json").read_text(encoding="utf-8"))


def text(t):
    return "".join(t) if isinstance(t, list) else t


class SharedCases(unittest.TestCase):
    def assert_findings(self, findings, c):
        name = c.get("name", "")
        for f in findings:
            self.assertIn(f.get("rule"), scout.RULES, f'{name}: no rule ID for "{f["title"]}"')
        if not c["has"]:
            self.assertEqual([f["title"] for f in findings], [], f"{name}: expected no findings")
        for want in c["has"]:
            hit = next((f for f in findings if f["severity"] == want["severity"] and want["title"] in f["title"]), None)
            self.assertIsNotNone(hit, f'{name}: missing {want["severity"]} "{want["title"]}" in {[(f["severity"], f["title"]) for f in findings]}')
            if "line" in want:
                self.assertEqual(hit.get("line"), want["line"], f'{name}: line for {want["title"]}')
            if "count" in want:
                self.assertEqual(hit.get("count"), want["count"], f'{name}: count for {want["title"]}')
        for missing in c.get("lacks", []):
            self.assertFalse(any(missing in f["title"] for f in findings), f'{name}: unexpected "{missing}"')
        if "highCount" in c:
            self.assertEqual(sum(f["severity"] == "high" for f in findings), c["highCount"], f"{name}: high count")

    def test_repo_input(self):
        for c in CASES["repo_input"]:
            if c["expect"]:
                self.assertEqual(scout.parse_repo_input(c["input"]), c["expect"], c["input"])
            else:
                with self.assertRaises(ValueError, msg=c["input"]):
                    scout.parse_repo_input(c["input"])

    def test_unicode(self):
        for c in CASES["unicode"]:
            hit = scout.scan_text(text(c["text"]))
            self.assertEqual(hit["severity"] if hit else None, c["severity"], c["name"])
            if "firstLine" in c:
                self.assertEqual(hit["samples"][0]["line"], c["firstLine"], c["name"])
        self.assertEqual(scout.reveal("a\u202Eb"), "a⟦U+202E⟧b")

    def test_workflows(self):
        for c in CASES["workflow"]:
            self.assert_findings(scout.analyze_workflow(text(c["text"])), c)

    def test_agent_files(self):
        for c in CASES["agent_path"]:
            got = scout.classify_agent_path(c["path"])
            self.assertEqual(got["kind"] if got else None, c["kind"], c["path"])
        for c in CASES["agent_file"]:
            self.assert_findings(scout.analyze_agent_file(c["path"], text(c["text"])), c)

    def test_agent_cross_checks(self):
        def tree(rows):
            return [{"path": r[0], "type": r[1], **({"mode": r[2]} if len(r) > 2 else {})} for r in rows]
        for c in CASES["agent_resolve"]:
            self.assertEqual(scout.resolve_ref(c["from"], c["target"]).get("path"), c["expect"], f'{c["from"]} -> {c["target"]}')
        for c in CASES["agent_follow"]:
            by_path = {e["path"]: e for e in tree(c["entries"])}
            got = [[t["path"], t["via"]] for t in scout.follow_targets(by_path, c["path"], c["text"], c["link"])]
            self.assertEqual(got, c["expect"], c["name"])
        for c in CASES["agent_cross"]:
            texts = {k: text(v) for k, v in c["texts"].items()}
            self.assert_findings(scout.cross_check_agents(tree(c["entries"]), texts, c["links"], c.get("extraNames", [])), c)

    def test_build(self):
        for c in CASES["build_path"]:
            got = scout.classify_build_path(c["path"])
            self.assertEqual(got["severity"] if got else None, c["severity"], c["path"])
        for c in CASES["install_scripts"]:
            self.assertEqual(scout.install_scripts(c["text"]), c["expect"])

    def test_security_policy(self):
        for c in CASES["security_policy"]:
            entries = [{"type": "blob", "path": p} for p in c["paths"]]
            self.assertEqual(scout.find_security_policy(entries), c["expect"])

    def test_lockfiles(self):
        for c in CASES["lockfile"]:
            parse = scout.lockfile_parser(c["path"])
            if c["expect"] is None:
                self.assertIsNone(parse, c["path"])
                continue
            got = [f'{p["ecosystem"]}|{p["name"]}|{p["version"]}' for p in parse(text(c["text"]))]
            self.assertEqual(got, c["expect"], c["path"])

    def test_advisories(self):
        for c in CASES["advisories"]:
            f = scout.advisory_findings([c["hit"]], c["details"])[0]
            self.assertEqual(f["rule"], "S5.known-advisories", c["name"])
            self.assertEqual(f["title"], c["expect"]["title"], c["name"])
            self.assertEqual(f["severity"], c["expect"]["severity"], c["name"])
            self.assertEqual([s["osv"] for s in f["samples"]], c["expect"]["samples"], c["name"])
            if "texts" in c["expect"]:
                self.assertEqual([s["text"] for s in f["samples"]], c["expect"]["texts"], c["name"])

    def test_omarchy_plugin(self):
        for c in CASES["plugin_manifest"]:
            self.assertEqual(bool(scout.read_manifest(c["text"])), c["plugin"], c["text"])
        for c in CASES["plugin_file"]:
            self.assert_findings(scout.analyze_plugin_file(c["path"], text(c["text"])), c)
        for c in CASES["plugin_tree"]:
            entries = [{"type": "blob", "path": p, "size": s} for p, s in c["entries"]]
            self.assert_findings(scout.analyze_plugin_tree(entries, c["readme"]), c)


class Network(unittest.TestCase):
    def test_refuses_hosts_outside_allowlist(self):
        net = scout.Net()
        with self.assertRaises(scout.ScanError):
            net._request("https://example.com/", 10)
        with self.assertRaises(scout.ScanError):
            net._request("http://api.github.com/", 10)

    def test_jsonc(self):
        self.assertEqual(scout.parse_jsonc('{ // c\n "a": "x//y", /* b */ "b": [1,], }'), {"a": "x//y", "b": [1]})


class TerminalOutput(unittest.TestCase):
    # An OSC 52 clipboard write, a C1 CSI, DEL, a bidi override and a tag
    # character, as a repository could put them in a server name or a path.
    HOSTILE = "\x1b]52;c;SGVsbG8=\x07\x9b31m\x7f\u202e\U000e0041"

    def report(self):
        findings = scout._mcp_findings({self.HOSTILE: {"command": "node"}})
        findings.append({"severity": "low", "rule": "S6.husky", "title": "t", "path": self.HOSTILE, "line": 1})
        return {"repository": "o/r", "commit": "a" * 40,
                "api": {"calls": 1, "remaining": 59, "limit": 60, "authenticated": False, "tokenRejected": False},
                "checks": [{"id": "S2", "name": "Agent instruction files", "status": "ran", "findings": findings,
                            "notes": [self.HOSTILE], "facts": [[self.HOSTILE, self.HOSTILE]]}]}

    def test_readable_report_shows_controls_as_code_points(self):
        out = scout.format_text(self.report())
        self.assertIsNone(scout.TERMINAL_UNSAFE.search(out.replace("\n", "")))
        for cp in ("U+001B", "U+0007", "U+009B", "U+007F", "U+202E", "U+E0041"):
            self.assertIn("⟦%s⟧" % cp, out)

    def test_json_report_escapes_controls_and_parses_back(self):
        report = self.report()
        out = scout.bounded_json(report)
        self.assertIsNone(scout.TERMINAL_UNSAFE.search(out))
        self.assertEqual(json.loads(out)["checks"][0]["notes"], [self.HOSTILE])

    def test_error_message_is_escaped(self):
        self.assertEqual(scout.term_safe("a\x1bb\nc"), "a⟦U+001B⟧b⟦U+000A⟧c")


if __name__ == "__main__":
    unittest.main()
