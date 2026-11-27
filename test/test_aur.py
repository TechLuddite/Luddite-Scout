"""--aur: reading an AUR build recipe as text.

    python3 -m unittest discover -s test
"""
import importlib.machinery
import importlib.util
import json
import pathlib
import time
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
_loader = importlib.machinery.SourceFileLoader("scout", str(ROOT / "bin" / "scout"))
_spec = importlib.util.spec_from_loader("scout", _loader)
scout = importlib.util.module_from_spec(_spec)
_loader.exec_module(scout)

CLEAN = """pkgname=demo
pkgver=1.0
source=("https://example.org/demo-$pkgver.tar.gz"
        "fix.patch")
sha256sums=('aaaa'
            'bbbb')
build() {
  cd demo-$pkgver
  make
}
"""
# Kept in parts so the sample lines do not appear whole in this file.
RISKY = "".join(["""pkgname=demo-git
source=("git+https://example.org/demo.git" "http://example.org/data.bin" "tool::https://example.org/tool.tar.gz")
md5sums=('SKIP' 'SKIP' 'SKIP')
install=demo.install
prepare() {
  cu""", """rl -L https://example.org/x.sh | ba""", """sh
  # curl in a comment is ignored
}
build() {
  np""", """m install
  su""", """do make install
}
"""])
INSTALL = "".join(["""post_install() {
  system""", """ctl enable demo.service
  wg""", """et https://example.org/extra
}
post_remove() { :; }
"""])


def rules(findings):
    return {f["rule"]: f for f in findings}


class Recipe(unittest.TestCase):
    def test_clean_recipe(self):
        findings, install = scout.analyze_pkgbuild(CLEAN)
        self.assertEqual([f["rule"] for f in findings], ["S10.source-hosts"])
        self.assertEqual(install, "")

    def test_risky_recipe(self):
        findings, install = scout.analyze_pkgbuild(RISKY)
        got = rules(findings)
        self.assertEqual(install, "demo.install")
        self.assertEqual(got["S10.skip-checksum"]["count"], 2)       # one SKIP belongs to the git source
        self.assertEqual(got["S10.unpinned-vcs"]["count"], 1)
        self.assertEqual(got["S10.insecure-source"]["count"], 1)
        self.assertEqual(got["S10.download-to-shell"]["severity"], "high")
        self.assertEqual(got["S10.download-to-shell"]["line"], 6)
        self.assertEqual(got["S10.sudo"]["severity"], "high")
        self.assertEqual(got["S10.fetch-in-build"]["count"], 2)      # the piped download and the package install
        self.assertIn("S10.weak-checksum", got)
        for f in findings:
            self.assertIn(f["rule"], scout.RULES)

    def test_no_checksums_and_pinned_checkout(self):
        got = rules(scout.analyze_pkgbuild('source=("https://example.org/a.tar.gz")\n')[0])
        self.assertEqual(got["S10.no-checksums"]["severity"], "high")
        got = rules(scout.analyze_pkgbuild('source=("git+https://example.org/a.git#commit=abc")\nsha256sums=(SKIP)\n')[0])
        self.assertNotIn("S10.unpinned-vcs", got)
        self.assertNotIn("S10.skip-checksum", got)

    def test_prebuilt_binary(self):
        got = rules(scout.analyze_pkgbuild('pkgname=x-bin\nsource_x86_64=("https://example.org/x.deb")\nsha256sums_x86_64=(aa)\n')[0])
        self.assertIn("S10.prebuilt-binary", got)

    def test_install_script(self):
        got = rules(scout.analyze_install_script(INSTALL))
        self.assertIn("post_install, post_remove", got["S10.install-script"]["title"])
        self.assertEqual(got["S10.install-script-fetch"]["severity"], "high")
        self.assertIn("S10.install-script-services", got)


class Fetch(unittest.TestCase):
    def fake(self, pages, meta):
        def request(_self, url, max_bytes, data=None, headers=None):
            self.assertTrue(url.startswith("https://aur.archlinux.org/"), url)
            if "/rpc/" in url:
                return 200, {}, json.dumps({"results": [meta] if meta else []}).encode()
            name = url.split("/plain/")[1].split("?")[0]
            return (200, {}, pages[name].encode()) if name in pages else (404, {}, b"")
        return mock.patch.object(scout.Net, "_request", request)

    def test_report_with_install_script_and_metadata(self):
        meta = {"PackageBase": "demo-git", "Version": "1-1", "Maintainer": None, "NumVotes": 3,
                "FirstSubmitted": 1700000000, "LastModified": int(time.time()) - 86400, "URL": "https://github.com/Owner/Demo"}
        with self.fake({"PKGBUILD": RISKY, "demo.install": INSTALL}, meta):
            report = scout.scan_aur("demo-git")
        check = report["checks"][0]
        got = rules(check["findings"])
        self.assertEqual((report["repository"], check["id"], check["status"]), ("aur/demo-git", "S10", "ran"))
        self.assertEqual(got["S10.install-script-fetch"]["path"], "demo.install")
        self.assertIn("S10.orphaned", got)
        self.assertIn("S10.recently-changed", got)
        self.assertIn(["Upstream", "Owner/Demo"], check["facts"])
        self.assertIn(["Maintainer", "none (orphaned)"], check["facts"])
        self.assertEqual(check["findings"][0]["severity"], "high")

    def test_missing_package_and_bad_name(self):
        with self.fake({}, None):
            with self.assertRaises(scout.NotFoundError):
                scout.scan_aur("nope")
        for bad in ("../x", "A", "a b", "-x", ""):
            with self.assertRaises(ValueError, msg=bad):
                scout.scan_aur(bad)
        self.assertEqual(scout.main(["--aur", "x", "--agent"]), 2)
        self.assertEqual(scout.main(["--aur", "x", "extra"]), 2)

    def test_allowlist_has_the_aur_host_and_no_other_new_one(self):
        self.assertEqual(scout.ALLOWED_HOSTS, {"api.github.com", "raw.githubusercontent.com", "api.osv.dev", "api.securityscorecards.dev", "aur.archlinux.org"})


if __name__ == "__main__":
    unittest.main()
