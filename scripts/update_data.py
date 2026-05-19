"""Generate static demo data for GitHub Pages.

This MVP keeps runtime hosting free by writing JSON files into public/data.
Replace the sample payloads here with official-source fetchers once the data
contracts are approved.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "public" / "data"


def main() -> None:
    manifest_path = DATA_DIR / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["generatedAt"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest["build"] = "demo-static-mvp-v1"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
