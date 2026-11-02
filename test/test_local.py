"""--dir: scanning a local checkout, for the GitHub and Gitea Actions action.

    python3 -m unittest discover -s test
"""
import importlib.machinery
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest
from contextlib import redirect_stdout
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
_loader = importlib.machinery.SourceFileLoader("scout", str(ROOT / "bin" / "scout"))
_spec = importlib.util.spec_from_loader("scout", _loader)
scout = importlib.util.module_from_spec(_spec)
_loader.exec_module(scout)

ZWSP = chr(0x200B)
WORKFLOW = """on: pull_request_target
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: echo "${{ github.event.pull_request.title }}"
"""


def offline(*_a, **_k):
    raise AssertionError("a local scan with no lockfiles must not use the network")


def check(report, cid):
    return next(c for c in report["checks"] if c["id"] == cid)


def rules(report, cid):
    return {f["rule"] for f in check(report, cid)["findings"]}


class LocalScan(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name) / "demo"
        (self.root / ".github" / "workflows").mkdir(parents=True)
        (self.root / ".github" / "workflows" / "ci.yml").write_text(WORKFLOW, encoding="utf-8")
        (self.root / "CLAUDE.md").write_text(f"Be helpful.{ZWSP}\n", encoding="utf-8")
        (self.root / "README.md").write_text("Demo\n", encoding="utf-8")
        (self.root / ".git").mkdir()
        (self.root / ".git" / "notes.md").write_text(f"hidden{ZWSP}\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def scan(self, **kw):
        with mock.patch.object(scout.Net, "_request", offline):
            return scout.scan_dir(str(self.root), **kw)

    def test_report_shape(self):
        r = self.scan()
        self.assertEqual(r["tool"], "luddite-scout")
        self.assertEqual(r["repository"], "demo")
        self.assertEqual([c["id"] for c in r["checks"]], ["S1", "S2", "S3", "S4", "S5", "S6", "S7"])
        for c in r["checks"]:
            self.assertIn(c["status"], scout.STATUSES, c["id"])

    def test_name_and_commit_are_reported(self):
        sha = "a" * 40
        r = self.scan(name="owner/demo", commit=sha)
        self.assertEqual(r["repository"], "owner/demo")
        self.assertEqual(r["commit"], sha)

    def test_commit_must_be_a_full_sha(self):
        with self.assertRaises(ValueError):
            self.scan(commit="main")

    def test_repository_settings_are_not_applicable(self):
        self.assertEqual(check(self.scan(), "S1")["status"], "not-applicable")

    def test_file_checks_run_on_the_checkout(self):
        r = self.scan()
        self.assertTrue(check(r, "S3")["findings"], "S3 should flag the zero-width space in CLAUDE.md")
        self.assertTrue(check(r, "S4")["findings"], "S4 should flag the workflow")
        self.assertIn("CLAUDE.md", json.dumps(check(r, "S2")), "S2 should see CLAUDE.md")

    def test_git_directory_is_not_scanned(self):
        paths = {f.get("path") for f in check(self.scan(), "S3")["findings"]}
        self.assertNotIn(".git/notes.md", paths)
        self.assertIn("CLAUDE.md", paths)

    def test_symbolic_link_is_not_followed(self):
        outside = pathlib.Path(self.tmp.name) / "secret.md"
        outside.write_text(f"outside{ZWSP}\n", encoding="utf-8")
        os.symlink(outside, self.root / "AGENTS.md")
        ctx = scout.LocalContext(str(self.root))
        entry = next(e for e in ctx.entries if e["path"] == "AGENTS.md")
        self.assertEqual(entry["mode"], "120000")
        self.assertEqual(ctx.fetch_text("AGENTS.md"), {"text": str(outside)})

    def test_paths_outside_the_checkout_are_refused(self):
        ctx = scout.LocalContext(str(self.root))
        for p in ("../secret.md", "/etc/passwd", "a/../../x"):
            self.assertIn("skipped", ctx.fetch_text(p), p)

    def test_oversized_and_binary_files_are_skipped(self):
        (self.root / "big.txt").write_text("x" * 50, encoding="utf-8")
        (self.root / "bin.dat").write_bytes(b"ab" + bytes(1) + b"cd")
        ctx = scout.LocalContext(str(self.root))
        self.assertEqual(ctx.fetch_text("big.txt", max_bytes=10), {"skipped": "over size limit"})
        self.assertEqual(ctx.fetch_text("bin.dat"), {"skipped": "binary"})

    def test_fifo_does_not_block(self):
        os.mkfifo(self.root / "pipe.md")
        ctx = scout.LocalContext(str(self.root))
        self.assertNotIn("pipe.md", {e["path"] for e in ctx.entries})
        ctx._kinds["pipe.md"] = "100644"
        self.assertIn("skipped", ctx.fetch_text("pipe.md"))

    def test_symbolic_link_text_is_capped(self):
        os.symlink("x" * 60, self.root / "long.md")
        ctx = scout.LocalContext(str(self.root))
        self.assertEqual(ctx.fetch_text("long.md", max_bytes=10), {"skipped": "over size limit"})

    def test_link_to_a_directory_is_not_entered(self):
        outside = pathlib.Path(self.tmp.name) / "elsewhere"
        outside.mkdir()
        (outside / "AGENTS.md").write_text("outside\n", encoding="utf-8")
        os.symlink(outside, self.root / "linked")
        ctx = scout.LocalContext(str(self.root))
        self.assertNotIn("linked/AGENTS.md", {e["path"] for e in ctx.entries})
        self.assertEqual(ctx.fetch_text("linked/AGENTS.md"), {"skipped": "not found"})

    def test_entry_cap_marks_the_scan_partial(self):
        with mock.patch.object(scout, "LOCAL_MAX_ENTRIES", 3):
            ctx = scout.LocalContext(str(self.root))
            self.assertLessEqual(len(ctx.entries), 3)
            self.assertTrue(ctx.truncated)
            r = self.scan()
        self.assertEqual(check(r, "S3")["status"], "partial")

    @unittest.skipIf(os.geteuid() == 0, "root can read any directory")
    def test_unreadable_directory_marks_the_scan_partial(self):
        locked = self.root / "locked"
        locked.mkdir()
        os.chmod(locked, 0)
        try:
            self.assertTrue(scout.LocalContext(str(self.root)).truncated)
        finally:
            os.chmod(locked, 0o755)

    def test_missing_directory_is_an_error(self):
        with self.assertRaises(scout.ScanError):
            scout.scan_dir(str(self.root / "nope"))

    def test_cli_json(self):
        out = io.StringIO()
        with mock.patch.object(scout.Net, "_request", offline), redirect_stdout(out):
            code = scout.main(["--json", "--dir", str(self.root)])
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(out.getvalue())["repository"], "demo")


if __name__ == "__main__":
    unittest.main()
