"""The badge files in docs/badges match what docs/badges/make.py writes, so
the version badge cannot fall behind manifest.json."""
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("make_badges", ROOT / "docs" / "badges" / "make.py")
make = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(make)


class Badges(unittest.TestCase):
    def test_files_are_current(self):
        for name, svg in make.badges().items():
            self.assertEqual((ROOT / "docs" / "badges" / name).read_text(encoding="utf-8"), svg, name)

    def test_readme_uses_no_badge_service(self):
        self.assertNotIn("shields.io", (ROOT / "README.md").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
