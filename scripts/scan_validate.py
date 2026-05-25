#!/usr/bin/env python3
"""Run /api/order/scan_ticket against every image in scripts/scan_samples/
and write the extracted fields to scripts/scan_accuracy.md.

Workflow:
  1. Drop Phil's ticket photos (.jpg/.png) into scripts/scan_samples/
  2. Start the framing stack (./start.sh) — needs ANTHROPIC_API_KEY set
  3. Run:  python3 scripts/scan_validate.py
  4. Open scripts/scan_accuracy.md and fill in the "Ground truth" column
     by eyeballing each ticket photo. The diff is for Drew's eyes, not
     auto-scored — 80% is a human judgment call.

Usage:
    python3 scripts/scan_validate.py [--url http://127.0.0.1:8080] \\
        [--samples PATH] [--out PATH]
"""

import argparse
import base64
import json
import mimetypes
import sys
import urllib.request
import urllib.error
from pathlib import Path

# Fields the iPad uses on intake. If any of these are wrong, Phil's
# eye will catch it during demo. Order matches roughly what a counter
# operator scans top-to-bottom on the paper ticket.
CRITICAL = [
    "customer_name", "customer_phone",
    "date_received", "date_promised",
    "frame_size", "frame_molding_no",
    "mat1_color",
    "mat1_margin_top_in", "mat1_margin_sides_in", "mat1_margin_bottom_in",
    "glass_kind",
    "deposit_amount", "total",
]


def scan_one(url, image_path):
    media_type, _ = mimetypes.guess_type(str(image_path))
    if not media_type:
        media_type = "image/jpeg"
    data = image_path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    data_url = f"data:{media_type};base64,{b64}"
    req = urllib.request.Request(
        url.rstrip("/") + "/api/order/scan_ticket",
        data=json.dumps({"image_data_url": data_url}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read())


def fmt(v):
    if v is None or v == "":
        return "_(null)_"
    return str(v).replace("|", "\\|").replace("\n", " ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:8080",
                    help="base URL for serve.py (default: http://127.0.0.1:8080)")
    ap.add_argument("--samples", default=None,
                    help="path to samples dir (default: scripts/scan_samples)")
    ap.add_argument("--out", default=None,
                    help="output markdown path (default: scripts/scan_accuracy.md)")
    args = ap.parse_args()

    here = Path(__file__).resolve().parent
    samples = Path(args.samples) if args.samples else here / "scan_samples"
    out = Path(args.out) if args.out else here / "scan_accuracy.md"

    if not samples.is_dir():
        print(f"No samples dir at {samples}. Drop ticket photos there first.",
              file=sys.stderr)
        sys.exit(1)

    images = sorted(
        p for p in samples.iterdir()
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    if not images:
        print(f"No images found in {samples}. Expected .jpg / .jpeg / .png / .webp.",
              file=sys.stderr)
        sys.exit(1)

    lines = [
        "# Scan accuracy",
        "",
        f"Server: `{args.url}`",
        f"Samples: `{samples}`  ({len(images)} images)",
        "",
        "Hand-fill the *Ground truth* column from each ticket photo.",
        "Leave blank if the scanned value is correct as-is. The diff is",
        "for visual inspection — 80% on critical fields is the bar for demo.",
        "",
    ]

    ok_count = 0
    for img in images:
        print(f"  scanning {img.name}…")
        try:
            result = scan_one(args.url, img)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")[:400]
            print(f"    HTTP {e.code}: {body}", file=sys.stderr)
            lines += [f"## {img.name}", "",
                      f"_Scan failed: HTTP {e.code}_", "",
                      "```", body, "```", ""]
            continue
        except Exception as e:
            print(f"    FAIL: {e}", file=sys.stderr)
            lines += [f"## {img.name}", "",
                      f"_Scan request failed: {e}_", ""]
            continue

        if not result.get("ok"):
            err = result.get("error", "unknown")
            print(f"    NOT OK: {err}", file=sys.stderr)
            lines += [f"## {img.name}", "",
                      f"_Scan returned error: {err}_", ""]
            if result.get("raw"):
                lines += ["", "```", result["raw"][:2000], "```", ""]
            continue

        f = result.get("fields", {})
        ok_count += 1
        lines += [f"## {img.name}", "",
                  "| Field | Scanned | Ground truth |",
                  "|---|---|---|"]
        for key in CRITICAL:
            lines.append(f"| {key} | {fmt(f.get(key))} | |")
        lines += ["",
                  "<details><summary>All extracted fields</summary>",
                  "",
                  "```json",
                  json.dumps(f, indent=2, sort_keys=True),
                  "```",
                  "",
                  "</details>",
                  ""]

    out.write_text("\n".join(lines))
    print(f"\nWrote {out} ({ok_count}/{len(images)} scans ok).")
    if ok_count == 0:
        sys.exit(2)


if __name__ == "__main__":
    main()
