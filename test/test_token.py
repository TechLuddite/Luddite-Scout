"""Token validation for --token-stdin and gh_token().

    python3 -m unittest discover -s test
"""
import importlib.machinery
import importlib.util
import io
import pathlib
import subprocess
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parent.parent
_loader = importlib.machinery.SourceFileLoader("scout_token", str(ROOT / "bin" / "scout"))
_spec = importlib.util.spec_from_loader("scout_token", _loader)
scout = importlib.util.module_from_spec(_spec)
_loader.exec_module(scout)

# Synthetic values with the shape of real tokens. None of these is a credential.
CLASSIC_PAT = "ghp_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
CLASSIC_OAUTH = "gho_" + "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"
# ghs_APPID_JWT: header.payload.signature in base64url, 377 chars like a measured Actions token.
_JWT = "eyJhbGciOiJSUzI1NiJ9" + "." + ("eyJpc3MiOiIxMjM0NSJ9-_" * 12) + "." + "Sig-nat_ure0" * 9
ACTIONS = ("ghs_123456_" + _JWT + "x" * 377)[:377]


def run_stdin(line):
    """main() with --token-stdin; returns (exit code, token handed to scan or None, stderr)."""
    seen = {}

    def fake_scan(target, token):
        seen["token"] = token
        return {"ok": True}

    err = io.StringIO()
    with mock.patch.object(scout, "scan", fake_scan), mock.patch.object(scout, "bounded_json", lambda r: "{}"), \
            mock.patch("sys.stdin", io.StringIO(line)), mock.patch("sys.stderr", err), mock.patch("sys.stdout", io.StringIO()):
        code = scout.main(["--json", "--token-stdin", "owner/repo"])
    return code, seen.get("token"), err.getvalue()


def run_gh(output):
    with mock.patch.object(scout, "gh_executable", lambda: "/usr/bin/gh"), \
            mock.patch.object(scout.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=output)):
        return scout.gh_token()


GOOD = [CLASSIC_PAT, CLASSIC_OAUTH, ACTIONS, "ghs_" + "a" * 36, "x" * scout.TOKEN_MAX_CHARS]
BAD = ["a" * 19, "x" * (scout.TOKEN_MAX_CHARS + 1), "ghp_abc def0123456789abcdef", "ghp_abc\tdef0123456789abcdef",
       "ghp_abc\x00def0123456789abcdef", "ghp_abc\x1bdef0123456789abcdef", "ghp_abc\x7fdef0123456789abcdef",
       "ghp_abc$(id)0123456789abcdef", "ghp_abc/def+0123456789abc=", "ghp_é" + "a" * 30]


class TokenStdin(unittest.TestCase):
    def test_actions_token_shape(self):
        self.assertEqual(len(ACTIONS), 377)
        self.assertEqual(ACTIONS.count("."), 2)
        self.assertIn("-", ACTIONS)

    def test_accepts(self):
        for t in GOOD:
            for line in (t + "\n", t + "\r\n", t):
                code, token, err = run_stdin(line)
                self.assertEqual((code, token, err), (0, t, ""), f"len {len(t)}")

    def test_rejects(self):
        for t in BAD:
            code, token, err = run_stdin(t + "\n")
            self.assertEqual(code, 2, repr(t[:30]))
            self.assertIsNone(token)
            self.assertIn("does not look like a GitHub token", err)

    def test_overlong_line_is_rejected_not_truncated(self):
        code, token, _ = run_stdin("a" * 5000 + "\n")
        self.assertEqual((code, token), (2, None))

    def test_empty_means_no_token(self):
        for line in ("", "\n", "   \n"):
            code, token, err = run_stdin(line)
            self.assertEqual((code, token, err), (0, None, ""))


class GhToken(unittest.TestCase):
    def test_accepts(self):
        for t in GOOD:
            self.assertEqual(run_gh((t + "\n").encode()), t)

    def test_rejects(self):
        for t in BAD + ["", "a" * 5000]:
            self.assertIsNone(run_gh(t.encode("utf-8")), repr(t[:30]))


if __name__ == "__main__":
    unittest.main()
