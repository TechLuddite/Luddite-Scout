#!/usr/bin/python3 -IS
"""Write the README badges as SVG files in this folder.

The README shows these files, so a reader's browser fetches them from the
same host as the README and from no badge service. Run this after changing
the version in manifest.json. test/test_badges.py fails when a file here
differs from what this script writes.
"""
import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent.parent
# Approximate advance of an 11px sans-serif glyph, in pixels.
WIDE, NARROW = set("mwMW@%"), set("iljtfI.,:;!|' ")


def width(text):
    return sum(9.5 if c in WIDE else 3.8 if c in NARROW else 6.6 for c in text) + 12


def badge(label, value, colour):
    lw, vw = round(width(label)), round(width(value))
    total = lw + vw
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{total}" height="20" role="img" aria-label="{label}: {value}">'
        f'<title>{label}: {value}</title>'
        f'<clipPath id="r"><rect width="{total}" height="20" rx="3"/></clipPath>'
        f'<g clip-path="url(#r)"><rect width="{lw}" height="20" fill="#555"/>'
        f'<rect x="{lw}" width="{vw}" height="20" fill="{colour}"/></g>'
        f'<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">'
        f'<text x="{lw / 2}" y="14">{label}</text><text x="{lw + vw / 2}" y="14">{value}</text></g></svg>\n')


def badges():
    version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
    return {
        "version.svg": badge("version", version, "#007ec6"),
        "licence.svg": badge("licence", "MIT", "#4c9a2a"),
        "status.svg": badge("status", "experimental", "#c9601a"),
        "dependencies.svg": badge("runtime dependencies", "none", "#2e8b3d"),
        "python.svg": badge("Python", "standard library only", "#3776ab"),
        "javascript.svg": badge("JavaScript", "no build step", "#8a7a00"),
        "qml.svg": badge("QML", "Omarchy plugin", "#2f9e44"),
    }


if __name__ == "__main__":
    for name, svg in badges().items():
        (HERE / name).write_text(svg, encoding="utf-8")
