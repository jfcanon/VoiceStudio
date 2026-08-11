"""Product analytics — REMOVED for the Local MVP fork.

VoiceStudio upstream shipped opt-in PostHog analytics (default OFF, allowlisted
properties, no exception autocapture). This fork removes telemetry entirely:
no analytics, no phone-home, nothing to leak. Every import site and the
``/api/settings/analytics`` endpoints keep working — they now always report
"off / not configured" and ``capture`` is a no-op.

The local Usage stats (backend/services/local_stats.py) are unaffected: they
are computed on-device and sent nowhere.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

logger = logging.getLogger("omnivoice.analytics")

#: Public API kept for import compatibility with callers (settings router,
#: generation router, error journal, main lifecycle hook). All inert.
_ALLOWED_PROPS: frozenset[str] = frozenset()
UNINSTALL_PING_INFO_BASENAME = "uninstall-info.json"


def _kill_switched() -> bool:
    return True


def user_opted_in() -> bool:
    return False


def set_opted_in(enabled: bool) -> None:
    pass


def user_prompted() -> bool:
    return False


def set_prompted(prompted: bool) -> None:
    pass


def _resolved_token() -> str:
    return ""


def _resolved_host() -> str:
    return ""


def token_configured() -> bool:
    return False


def enabled() -> bool:
    return False


def _get_client():
    return None


def shutdown() -> None:
    pass


def installation_id() -> str:
    """Stable per-install id kept only for local identity semantics (no
    telemetry sends it anywhere)."""
    return str(uuid.uuid4())


def sanitize_properties(properties: Optional[dict]) -> dict:
    return {}


def capture(event: str, properties: Optional[dict] = None) -> None:
    pass


def _app_version() -> str:
    return "0.0.0"


def _platform() -> str:
    import platform as _platform

    return _platform.system()


def install_channel() -> str:
    return "source"


def _common_props() -> dict:
    return {}


def uptime_bucket(seconds: Optional[float]) -> str:
    return "unknown"


def _maybe_send_installed() -> bool:
    return False


def record_startup_lifecycle(crash_record: Optional[dict] = None) -> None:
    pass


def record_error_event(error_class: str, fingerprint: str, stage: str = "") -> None:
    pass


def _reset_error_events_for_tests() -> None:
    pass


def sync_uninstall_ping_info() -> None:
    pass
