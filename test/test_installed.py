"""--installed, --plugin and --compare: installed Omarchy shell plugins.

    python3 -m unittest discover -s test
"""
import importlib.machinery
import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
_loader = importlib.machinery.SourceFileLoader("scout", str(ROOT / "bin" / "scout"))
_spec = importlib.util.spec_from_loader("scout", _loader)
scout = importlib.util.module_from_spec(_spec)
_loader.exec_module(scout)

SHA = "a" * 40


def make_plugin(base, pid, url="https://github.com/Owner/Repo.git", packed=False, files=None):
    root = pathlib.Path(base) / "omarchy" / "plugins" / pid
    (root / ".git" / "refs" / "heads").mkdir(parents=True)
    (root / "manifest.json").write_text('{"id": "%s", "name": "Demo", "version": "1.2.3"}' % pid)
    (root / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
    if url:
        (root / ".git" / "config").write_text('[core]\n\tbare = false\n[remote "origin"]\n\turl = %s\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n' % url)
    if packed:
        (root / ".git" / "packed-refs").write_text("# pack-refs with: peeled\n%s refs/heads/main\n" % SHA)
    else:
        (root / ".git" / "refs" / "heads" / "main").write_text(SHA + "\n")
    for name, body in (files or {"Panel.qml": "Item {}\n"}).items():
        (root / name).parent.mkdir(parents=True, exist_ok=True)
        (root / name).write_text(body)
    return root


class Installed(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        patch = mock.patch.dict(os.environ, {"XDG_CONFIG_HOME": self.tmp.name})
        patch.start()
        self.addCleanup(patch.stop)

    def test_lists_plugins_with_source_and_commit(self):
        make_plugin(self.tmp.name, "a.one")
        make_plugin(self.tmp.name, "b.two", url="git@github.com:Owner/Other", packed=True)
        make_plugin(self.tmp.name, "c.three", url="https://example.com/x/y.git")
        make_plugin(self.tmp.name, ".a.one.bak.2026")
        rows = scout.list_installed()["installed"]
        self.assertEqual([r["id"] for r in rows], ["a.one", "b.two", "c.three"])
        self.assertEqual([r["source"] for r in rows], ["Owner/Repo", "Owner/Other", None])
        self.assertEqual([r["commit"] for r in rows], [SHA, SHA, SHA])
        self.assertEqual((rows[0]["name"], rows[0]["version"], rows[0]["linked"]), ("Demo", "1.2.3", False))
        self.assertNotIn("root", rows[0])

    def test_linked_plugin_and_no_git(self):
        real = pathlib.Path(self.tmp.name) / "elsewhere"
        real.mkdir()
        (real / "manifest.json").write_text('{"name": 5}')
        plugins = pathlib.Path(self.tmp.name) / "omarchy" / "plugins"
        plugins.mkdir(parents=True)
        (plugins / "linked.one").symlink_to(real)
        row = scout.list_installed()["installed"][0]
        self.assertEqual((row["linked"], row["source"], row["commit"], row["name"]), (True, None, None, ""))

    def test_plugin_id_is_checked_before_any_path_is_built(self):
        for bad in ("../x", "a/b", "", "-x", "a" * 101):
            with self.assertRaises(ValueError, msg=bad):
                scout.plugin_info(bad)
        with self.assertRaises(scout.ScanError):
            scout.plugin_info("not.installed")

    def test_git_metadata_that_points_elsewhere_is_ignored(self):
        root = make_plugin(self.tmp.name, "a.one")
        (root / ".git" / "HEAD").write_text("ref: refs/heads/../../../../etc/passwd\n")
        self.assertIsNone(scout.git_info(str(root))["commit"])
        (root / ".git" / "HEAD").write_text("not a sha\n")
        self.assertIsNone(scout.git_info(str(root))["commit"])

    def test_scan_plugin_uses_no_network(self):
        make_plugin(self.tmp.name, "a.one")
        with mock.patch.object(scout.Net, "_request", side_effect=AssertionError("no network")):
            report = scout.scan_plugin("a.one")
        self.assertEqual(report["plugin"]["id"], "a.one")
        self.assertEqual(report["commit"], SHA)

    def test_compare_files(self):
        files = {"same.txt": "one\n", "changed.txt": "local\n", "added.txt": "new\n", "__pycache__/x.pyc": "x"}
        root = make_plugin(self.tmp.name, "a.one", files=files)
        blob = lambda s: scout.git_blob_sha(s.encode())
        self.assertEqual(blob("one\n"), "5626abf0f72e58d7a153368ba57db4c673c0e171")
        tree = {"tree": [{"path": "same.txt", "type": "blob", "sha": blob("one\n")},
                         {"path": "changed.txt", "type": "blob", "sha": blob("upstream\n")},
                         {"path": "manifest.json", "type": "blob", "sha": blob((root / "manifest.json").read_text())},
                         {"path": "gone.txt", "type": "blob", "sha": blob("x")},
                         {"path": "dir", "type": "tree", "sha": "0" * 40}]}
        got = scout.compare_files(scout.LocalContext(str(root), scout.Net(None)), tree)
        self.assertEqual((got["changed"], got["added"], got["missing"]), (["changed.txt"], ["added.txt"], ["gone.txt"]))
        self.assertEqual((got["checked"], got["generated"]), (3, 1))

    def test_diff_findings_leaves_out_repository_settings(self):
        f = lambda rule, path, sev="low": {"severity": sev, "rule": rule, "title": rule, "path": path}
        installed = {"checks": [{"id": "S6", "findings": [f("S6.makefile", "Makefile"), f("S6.direnv", ".envrc", "medium")]}]}
        source = {"checks": [{"id": "S1", "findings": [f("S1.no-licence", None)]},
                             {"id": "S6", "findings": [f("S6.makefile", "Makefile"), f("S6.setup-py", "setup.py")]}]}
        got = scout.diff_findings(installed, source)
        self.assertEqual([x["rule"] for x in got["onlyInstalled"]], ["S6.direnv"])
        self.assertEqual([x["rule"] for x in got["onlySource"]], ["S6.setup-py"])

    def test_lists_packages_from_desc_files(self):
        import io
        import tarfile
        local = pathlib.Path(self.tmp.name) / "local"
        sync = pathlib.Path(self.tmp.name) / "sync"
        sync.mkdir()
        def pkg(folder, name, url, reason=None):
            (local / folder).mkdir(parents=True)
            body = "%%NAME%%\n%s\n\n%%VERSION%%\n1.0-1\n\n%%URL%%\n%s\n\n" % (name, url)
            if reason:
                body += "%%REASON%%\n%s\n\n" % reason
            (local / folder / "desc").write_text(body)
        pkg("bat-1.0-1", "bat", "https://github.com/sharkdp/bat")
        pkg("aur-tool-1.0-1", "aur-tool", "https://github.com/someone/aur-tool.git")
        pkg("dep-1.0-1", "dep", "https://github.com/x/dep", reason="1")
        pkg("git-1.0-1", "git", "https://git-scm.com/")
        pkg("odd-1.0-1", "odd", "https://github.com.example.org/x/y")
        with tarfile.open(sync / "extra.db", "w:gz") as tar:
            for d in ("bat-1.0-1", "git-1.0-1"):
                info = tarfile.TarInfo(d)
                info.type = tarfile.DIRTYPE
                tar.addfile(info)
        rows = scout.list_packages(str(local), str(sync))
        self.assertEqual([(r["name"], r["source"], r["foreign"], r["repo"]) for r in rows],
                         [("aur-tool", "someone/aur-tool", True, ""), ("bat", "sharkdp/bat", False, "extra")])
        rows = scout.list_packages(str(local), str(pathlib.Path(self.tmp.name) / "missing"))
        self.assertEqual([r["foreign"] for r in rows], [None, None])

    def test_command_line(self):
        self.assertEqual(scout.main(["--installed", "extra"]), 2)
        self.assertEqual(scout.main(["--plugin", "a.one", "--agent"]), 2)
        self.assertEqual(scout.main(["--plugin", "a.one", "--gh-token"]), 2)
        self.assertEqual(scout.main(["--plugin", "../x", "--json"]), 2)


if __name__ == "__main__":
    unittest.main()
