"""
Regression tests for the WebSocket CSWSH / loopback guards.

Every WS endpoint (`/ws/events`, `/ws/tts`, `/ws/transcribe`) must refuse a
handshake unless BOTH hold:

1. the client is loopback (or presents the remote API key), and
2. the `Origin` header — if present — is on the allowlist.

The loopback check alone is bypassable: a browser tab running on the same
machine connects from 127.0.0.1, so without an Origin allowlist a malicious
web page could drive GPU/CPU-exhausting TTS generations (`/ws/tts`) or read
the sidebar event stream (`/ws/events`). WebSockets are NOT subject to CORS.
"""
import os

import pytest

os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")

from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402


@pytest.fixture
def client():
    from main import app

    # client=("127.0.0.1", 50000) satisfies the loopback half of the guard —
    # the Origin is what we're testing here. Same pattern as test_capture_ws.py.
    return TestClient(app, client=("127.0.0.1", 50000))


ALLOWED_ORIGINS = [
    "http://localhost:3901",
    "http://127.0.0.1:3901",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]

DENIED_ORIGINS = [
    "http://evil.example",
    "https://attacker.com",
    "http://localhost:9999",  # different dev port — not us
]

ENDPOINTS = ["/ws/events", "/ws/tts"]


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_ws_allows_allowlisted_origin(client, endpoint, origin):
    """A browser from an allowlisted origin (loopback client) connects fine."""
    with client.websocket_connect(endpoint, headers={"origin": origin}) as ws:
        ws.close()


@pytest.mark.parametrize("origin", DENIED_ORIGINS)
@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_ws_rejects_foreign_origin(client, endpoint, origin):
    """A browser from a foreign origin must be refused before accept()."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(endpoint, headers={"origin": origin}):
            pass  # pragma: no cover — connect must raise


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_ws_allows_absent_origin(client, endpoint):
    """Native/CLI clients omit Origin — authorized (loopback gate still runs)."""
    with client.websocket_connect(endpoint) as ws:
        ws.close()


def test_ws_transcribe_rejects_foreign_origin(client):
    """The dictation socket gets the same Origin protection as the others."""
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(
            "/ws/transcribe", headers={"origin": "http://evil.example"}
        ):
            pass  # pragma: no cover


def test_ws_transcribe_allows_allowed_origin(client):
    with client.websocket_connect(
        "/ws/transcribe", headers={"origin": "http://tauri.localhost"}
    ) as ws:
        ws.close()
