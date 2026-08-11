"""No telemetry wiring survives the Local MVP fork.

Upstream VoiceStudio shipped an opt-in PostHog analytics path whose publishable
project token lived in two canonical files (backend/core/analytics.py and
frontend/src/utils/analytics.ts), with a build-time override chain (release
secret → tauri-action → shell → child process). The fork removed analytics
entirely: `core/analytics.py` is an inert stub and the frontend has no
analytics module. This guard pins the new contract: a `phc_` literal must NOT
exist anywhere in the repo, the frontend must not read a PostHog override, and
the Rust shell must not bake/pass POSTHOG_* env vars to the backend.

Same file-scanning idiom as test_gitleaks_allowlist / test_no_hardcoded_cjk.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]

# A PostHog project key. Matched by SHAPE so a key can't slip in unnoticed.
_POSTHOG_KEY_RE = re.compile(r"phc_[A-Za-z0-9]{20,}")


def _tracked_files():
    out = subprocess.run(
        ["git", "ls-files"], cwd=_REPO, capture_output=True, text=True, check=True
    )
    for rel in out.stdout.splitlines():
        if any(skip in rel for skip in ("node_modules", "target/", "dist/")):
            continue
        yield _REPO / rel


def test_no_posthog_token_literal_anywhere():
    found = []
    for path in _tracked_files():
        if path.suffix in {".png", ".icns", ".wav", ".woff", ".woff2", ".ttf"}:
            continue
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        if _POSTHOG_KEY_RE.search(text):
            found.append(str(path))
    assert not found, f"posthog token literal present in: {found}"


def test_frontend_has_no_analytics_module():
    assert not (_REPO / "frontend/src/utils/analytics.ts").exists()


def test_analytics_module_is_inert():
    import sys

    sys.path.insert(0, str(_REPO / "backend"))
    from core import analytics

    assert analytics.enabled() is False
    assert analytics.token_configured() is False
    assert analytics.user_opted_in() is False
    # capture is a no-op that must not raise
    analytics.capture("any.event", {"engine_id": "omnivoice"})


def test_shell_passes_no_posthog_env_to_backend():
    src = (_REPO / "frontend/src-tauri/src/backend.rs").read_text(encoding="utf-8")
    assert "POSTHOG" not in src
    assert "VITE_POSTHOG_KEY" not in src


def test_workflows_pass_no_posthog_secret():
    for wf in (_REPO / ".github/workflows").glob("*.yml"):
        text = wf.read_text(encoding="utf-8", errors="ignore")
        assert "POSTHOG" not in text, f"posthog reference in {wf.name}"


def test_pyproject_has_no_posthog_dependency():
    text = (_REPO / "pyproject.toml").read_text(encoding="utf-8")
    assert "posthog" not in text
