"""The secret-scan allowlist must remain exact and value-scoped."""
from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_EXACT_REGEXES = {
    "^528e871c2a26c4f0f7773b9754e2e1acae20899d$",
    "^hf_abcdefghijklmnopqrstuvwxyz01234567890abcd$",
    "^hf_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF$",
    "^hf_QWERTYUIOPasdfghjklZXCVBNM0123456789xyzAB$",
    "^max_length=400$",
}


def test_gitleaks_allowlist_contains_only_reviewed_exact_values():
    config = tomllib.loads((ROOT / ".gitleaks.toml").read_text(encoding="utf-8"))
    allowlist = config["allowlist"]

    assert set(allowlist) == {"description", "regexes"}
    assert set(allowlist["regexes"]) == EXPECTED_EXACT_REGEXES
    assert all(
        regex.startswith("^") and regex.endswith("$")
        for regex in allowlist["regexes"]
    )
    assert "rules" not in config


def test_no_posthog_token_remains_anywhere():
    """Local MVP fork removed analytics: a real `phc_` token (20+ chars) must
    not exist in any tracked source file (the old allowlist entry is gone
    too). The synthetic `phc_test_token` scrubber fixture is deliberately
    short and allowed."""
    import os
    import re

    token_re = re.compile(r"phc_[A-Za-z0-9]{20,}")
    ROOTS = ["backend", "frontend/src", "scripts", "tests", "docs", ".github"]
    for root in ROOTS:
        for dirpath, dirnames, filenames in os.walk(ROOT / root):
            dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".venv", "target")]
            for fn in filenames:
                if fn.endswith((".lock", ".png", ".icns", ".wav", ".woff", ".woff2", ".ttf")):
                    continue
                path = Path(dirpath) / fn
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                except Exception:
                    continue
                assert not token_re.search(text), f"posthog token literal found in {path}"
    for fn in ("pyproject.toml", "uv.lock", ".gitleaks.toml"):
        p = ROOT / fn
        if p.exists():
            assert not token_re.search(
                p.read_text(encoding="utf-8", errors="ignore")
            ), f"in {fn}"
