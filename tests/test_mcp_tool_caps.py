"""
Regression tests: MCP tool argument caps (resource-exhaustion guard).

The MCP `generate_speech` tool must reject oversized text and out-of-range
speed/steps BEFORE any backend call — an agent should not be able to trigger
unbounded sentence-chunked generation on the GPU pool. transcribe/clone_voice
already cap audio size (200 MB); this pins the text/speed/steps caps.
"""
import asyncio
import os

import pytest

os.environ.setdefault("OMNIVOICE_MODEL", "test")
os.environ.setdefault("OMNIVOICE_DISABLE_FILE_LOG", "1")


@pytest.fixture
def server():
    from mcp_server import create_mcp_server

    return create_mcp_server()


def _tool(server, name):
    return server._tool_manager.get_tool(name).fn


def _call(server, name, *args, **kw):
    return asyncio.run(_tool(server, name)(*args, **kw))


def test_generate_speech_rejects_empty_text(server):
    with pytest.raises(ValueError, match="non-empty"):
        _call(server, "generate_speech", "")


def test_generate_speech_rejects_oversized_text(server):
    with pytest.raises(ValueError, match="character cap"):
        _call(server, "generate_speech", "x" * 20_001)


def test_generate_speech_accepts_boundary_text(server):
    # 20,000 chars is exactly at the cap and must pass validation (the tool
    # then fails on the missing backend / network — but not on the cap).
    text = "y" * 20_000
    # Validation happens before any HTTP call; we only assert it does not
    # raise the cap ValueError by checking an unrelated failure mode is
    # acceptable. To keep the test hermetic we assert the cap check itself
    # passes by catching only non-cap exceptions.
    try:
        _call(server, "generate_speech", text)
    except ValueError as e:
        assert "character cap" not in str(e), "boundary text must not hit the cap"
    except Exception:
        pass  # backend unreachable etc. — out of scope here


@pytest.mark.parametrize("speed", [0.4, 2.5, -1.0, 100.0])
def test_generate_speech_rejects_out_of_range_speed(server, speed):
    with pytest.raises(ValueError, match="speed"):
        _call(server, "generate_speech", "hello", speed=speed)


@pytest.mark.parametrize("steps", [4, 24, 64])
def test_generate_speech_rejects_invalid_steps(server, steps):
    with pytest.raises(ValueError, match="steps"):
        _call(server, "generate_speech", "hello", steps=steps)


@pytest.mark.parametrize("steps", [8, 16, 32])
def test_generate_speech_accepts_valid_steps(server, steps):
    try:
        _call(server, "generate_speech", "hello", steps=steps)
    except ValueError as e:
        assert "steps" not in str(e)
    except Exception:
        pass
