"""Offline RV-19 inspection. Requires PyMuPDF and opencv-python-headless.
Run: python scripts/inspect-seating-print.py file.pdf snapshot.json result.json
Only fixture/public QR content is written to the result, never session credentials.
"""
import hashlib
import json
import sys
from pathlib import Path

import cv2
import fitz
import numpy as np

pdf_path, snapshot_path, result_path = map(Path, sys.argv[1:4])
snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
doc = fitz.open(pdf_path)
assert len(doc) == 2, "Expected two physical pages"
mm = 72 / 25.4
for page in doc:
    assert abs(page.mediabox.width - 154 * mm) < 0.01
    assert abs(page.mediabox.height - 216 * mm) < 0.01
    assert abs(page.trimbox.width - 148 * mm) < 0.01
    assert abs(page.trimbox.height - 210 * mm) < 0.01
    for font in page.get_fonts():
        assert doc.extract_font(font[0])[3], "Font must be embedded"
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                assert "\ufffd" not in span["text"]
                assert fitz.Rect(span["bbox"]) in page.trimbox, "Text crosses trim boundary"
text = "\n".join(page.get_text() for page in doc)
for value in ["Ngọc Ánh", "Đức Minh", "Sơ đồ bàn theo nhóm"]:
    assert value in text, f"Missing Vietnamese text: {value}"
for table in snapshot["seating"]["renderSnapshot"]:
    assert table["tableLabel"] in text
    if table["guestGroupName"]:
        assert table["guestGroupName"] in text
page = doc[1]
pixmap = page.get_pixmap(dpi=200, alpha=False)
pixels = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
qr, points, _ = cv2.QRCodeDetector().detectAndDecode(pixels)
assert qr == snapshot["qrPayload"], "QR payload mismatch"
assert points is not None
# The accepted fixture's catalog has a single round table; inspect actual vector
# geometry rather than trusting text extraction or only a registry receipt.
tables = snapshot["seating"]["renderSnapshot"]
if len(tables) == 1 and tables[0]["shape"] == "ROUND":
    curves = [d for d in page.get_drawings() if sum(item[0] == "c" for item in d["items"]) == 4]
    assert len(curves) == 1, "Expected retained vector ellipse"
    ellipse = curves[0]
    ratio = tables[0]["width"] / tables[0]["height"]
    assert abs(ellipse["rect"].width / ellipse["rect"].height - ratio) < 0.01
    assert ellipse["rect"] in page.trimbox
    expected_color = tuple(int(tables[0]["color"][i:i+2], 16) / 255 for i in (1, 3, 5))
    assert all(abs(a - b) < 0.002 for a, b in zip(ellipse["fill"], expected_color))
result = {"pages": len(doc), "trimMm": [148, 210], "bleedMm": 3,
          "embeddedFonts": True, "vietnameseGlyphs": True, "tableLabelsAndGroups": True,
          "retainedVectorGeometry": True, "qrDecoded": qr,
          "sha256": hashlib.sha256(pdf_path.read_bytes()).hexdigest()}
assert result["sha256"] == snapshot["pdfSha256"]
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"pages": result["pages"], "sha256": result["sha256"], "checks": "PASS"}))
