"""Build a one-glyph webfont from the official Saudi riyal SVG.

Source: https://www.sama.gov.sa/ar-sa/Currency/Documents/Saudi_Riyal_Symbol-2.svg
Mirror: https://commons.wikimedia.org/wiki/File:Saudi_Riyal_Symbol.svg
The simple currency symbol is public domain. No third-party font outlines are used.
Build dependency: fonttools==4.60.1 (not shipped with the app).
Rebuild: python -m pip install --target tools/riyal-font-build fonttools==4.60.1
         python scripts/build-riyal-font.py
"""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "riyal-font-build"))
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.svgLib.path import parse_path
from fontTools.ttLib import TTFont

svg = ET.parse(ROOT / "public" / "saudi-riyal.svg").getroot()
_, _, width, height = map(float, svg.attrib["viewBox"].split())
scale = 800 / height
pen = TTGlyphPen(None)
# SVG coordinates run downwards. Fit the original proportions above the baseline.
outline = TransformPen(Cu2QuPen(pen, max_err=0.5, reverse_direction=True),
                       (scale, 0, 0, -scale, 40, 800))
for element in svg.findall("{http://www.w3.org/2000/svg}path"):
    parse_path(element.attrib["d"], outline)

font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder([".notdef", "saudiRiyal"])
font.setupCharacterMap({0x20C1: "saudiRiyal"})
font.setupGlyf({".notdef": TTGlyphPen(None).glyph(), "saudiRiyal": pen.glyph()})
font.setupHorizontalMetrics({".notdef": (600, 0), "saudiRiyal": (round(width * scale) + 80, 40)})
font.setupHorizontalHeader(ascent=900, descent=-200)
font.setupNameTable({
    "familyName": "Partners Saudi Riyal", "styleName": "Regular",
    "uniqueFontIdentifier": "PartnersSaudiRiyal-1.0", "fullName": "Partners Saudi Riyal",
    "psName": "PartnersSaudiRiyal", "version": "Version 1.0",
    "copyright": "Public-domain Saudi riyal symbol; original outline from the Saudi Central Bank (SAMA).",
})
font.setupOS2(sTypoAscender=900, sTypoDescender=-200, usWinAscent=900, usWinDescent=200)
font.setupPost()
font.setupMaxp()
output = ROOT / "public" / "saudi-riyal.ttf"
font.save(output)

# Verify we ship an actual outline, not a missing-character box.
check = TTFont(output)
assert check.getBestCmap()[0x20C1] == "saudiRiyal"
assert check["glyf"]["saudiRiyal"].numberOfContours >= 2
print(f"Verified U+20C1 Saudi riyal font: {output.stat().st_size} bytes")
