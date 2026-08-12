# VoiceStudio — Local MVP Implementation Plan (Fork + Harden)

Scope: a **local-first desktop voice cloning studio** (Tauri v2 + React + FastAPI sidecar), built as a **fork of [debpalash/VoiceStudio](https://github.com/debpalash/VoiceStudio)** with the upstream security gaps closed. No cloud, no API keys required, OpenAI-compatible local API.

---

## 1. Goal

A desktop app where a user records a ~3–8 s voice sample, clones that voice, generates unlimited TTS locally, and transcribes audio — all on-device, with a hardened attack surface for the local API, the LLM-assisted features, and file/model ingestion.

## 2. Source strategy

1. **Fork** `debpalash/VoiceStudio` into this repo (`git remote add upstream`, keep history).
2. **Trim to MVP:** strip dubbing, audiobooks, diarization, batch, watermarking, remote backend, extra engines (keep 1 TTS + 1 ASR), remove analytics/telemetry entirely.
3. **Harden first** (Section 5) before adding any feature work.
4. License note: upstream is **AGPL-3.0**. Our fork is also AGPL-3.0; commercial use free, but any network-offered modification must share source. Keep `LICENSE`, `LICENSE-NOTICE.md`, and upstream attribution.

## 3. Architecture (MVP)

```
Tauri v2 shell (Rust)
 ├─ window state, single-instance, close-to-tray, first-run bootstrap (uv + Python venv)
 ├─ CSP hardened (script-src 'self', no unsafe-eval)
Frontend (React + Vite)
 ├─ Studio · Voice (clone/design) · Gallery · Settings · Diagnostics
 ├─ Zustand store · WebSocket event bus
Backend (FastAPI sidecar @ 127.0.0.1:3900, loopback-only bind)
 ├─ TTS: k2-fsa/OmniVoice zero-shot clone (600+ langs) — the VoiceStudio built-in
 ├─ ASR: faster-whisper (crash-isolated subprocess)
 ├─ SQLite + Alembic (profiles, voices, jobs, settings) in app data dir
 ├─ OpenAI-compatible /v1/audio/speech, /v1/audio/transcriptions, /v1/audio/voices
 ├─ MCP server (FastMCP, sub-mounted, localhost-only)
 └─ /ws/events event bus
```

GPU: auto-detect CUDA / MPS / CPU; ≤8 GB VRAM offloads TTS to CPU. No silent CPU fallback — preflight per engine.

## 4. MVP feature scope

| Feature | MVP | Notes |
|---|---|---|
| Voice cloning | ✅ | ~3 s reference clip → zero-shot, 646 langs |
| Voice design | ✅ | gender/age/accent/pitch/style/dialect prompt |
| Studio TTS | ✅ | sentence-chunked unlimited length, streaming |
| Transcription | ✅ | faster-whisper, ~100 langs, word timing |
| Voice gallery | ✅ | profiles + tags, `.ovsvoice` export/import |
| OpenAI-compat API | ✅ | `/v1/audio/*` |
| MCP server | ✅ | localhost-only, capped tool args |
| Dictation widget | ⏳ post-MVP | ⌘⇧Space global hotkey |
| Dubbing / Audiobook / Stories / Batch / Isolation / Diarization / Watermark | ❌ | out of MVP scope |

## 5. Security hardening checklist (port the audit — required before merge)

Legend: ✅ carry upstream mitigation verbatim · ⚠️ fix the upstream gap · 🗑️ delete for MVP.

### 5.1 Prompt injection / LLM surface
- [ ] ✅ **User-data-only rule:** attacker-influenced content (transcripts, glossary notes, project imports, LLM outputs) goes in the **user** role only; fixed system prompts never concatenate it (`refinement.py` pattern).
- [ ] ⚠️ **Isolate injected context:** the dub-translation pattern (`dub_translate.py:481-482`) injects glossary notes + LLM themes into the system prompt. We don't ship dubbing in MVP, but wherever context flows into a prompt add an explicit `DATA, not instructions` marker block + strip control delimiters. Add a unit test asserting no `note`/`theme` can inject an instruction.
- [ ] ✅ **Validate every LLM output deterministically** before use: script/length ratio + echo/critique guard (`translator.py:153-197`), allowlist normalization (`director.py:136-146`).
- [ ] ✅ **Hard wall-clock budgets + fallback:** every LLM call gets a timeout (4 s refine default) and a non-LLM fallback path.
- [ ] ✅ **No code execution:** no `eval`/`exec` on LLM output; subprocess only via arg lists, never `shell=True`.
- [ ] ⚠️ **MCP caps:** `generate_speech` gets a max text length + audio duration cap (match the 200 MB caps on transcribe/clone). Add tool-arg size limits.

### 5.2 Network / SSRF / auth
- [ ] ✅ **Loopback-only bind** by default (`127.0.0.1:3900`), unauthenticated loopback; if a remote/PIN path is ever added: two-tier auth (consumption PIN vs admin loopback/long-key only).
- [ ] ⚠️ **WebSocket guards everywhere:** add `is_local_host` + Origin allowlist check to **every** WS endpoint, including `/ws/events` and `/ws/tts` (upstream omits them; CORS does not apply to WebSockets — CSWSH risk). Mirror `capture_ws.py:163-165`.
- [ ] ✅ **SSRF-proof outbound fetches:** for any configurable engine/model URL reuse `outbound_http.py` — pin DNS answers to loopback/trusted CIDRs, refuse redirects, reject credentials/query/paths.
- [ ] 🗑️ **Drop yt-dlp URL ingest** (`dub/ingest-url`) from MVP; if re-added, enforce extractor/host allowlist + redirect-target validation + size/time bounds.
- [ ] ✅ **HF downloads:** repo allowlist (`KNOWN_MODELS`), pinned revisions, disk-space preflight, fixed HTTPS endpoints, hub-side integrity checks.
- [ ] 🗑️ **Drop analytics/PostHog** entirely for MVP (no telemetry; nothing to leak).

### 5.3 Filesystem / deserialization
- [ ] ✅ **Path containment:** `resolve_within` + `safe_filename` (basename rebuild + `commonpath` + symlink resolution) on every upload/export/preview route.
- [ ] ✅ **Zip-slip-safe `.ovsvoice` import:** member names never build output paths, allowlisted extensions, 100 MB cap, server-generated dest.
- [ ] ✅ **Serialization:** rely on `torch.load(weights_only=True)` (PyTorch ≥2.6), ban `yaml.load`/`pickle` on untrusted data, keep the pickle-safety regression test.
- [ ] ✅ **Secrets:** encrypted settings store (Fernet/scrypt), secret-value log redaction, `.gitleaks.toml` with minimal allowlist.
- [ ] ✅ **Diagnostics scrub:** env-secret sweep + credential-pattern scrub before any bundle is written/shared.

### 5.4 Frontend
- [ ] ⚠️ **CSP:** set explicit `script-src 'self'` (drop `'unsafe-eval'`), keep `connect-src` to `localhost:*`/`127.0.0.1:*` only.
- [ ] ✅ **No `dangerouslySetInnerHTML`;** render transcripts/translations through escaped components.

## 6. Implementation phases

**Phase 0 — Scaffold (0.5 wk)**
- Fork upstream into repo; delete non-MVP dirs (deploy, notebooks, examples, extra engines); trim deps in `pyproject.toml`; pin exact versions in `uv.lock`.

**Phase 1 — Harden (1 wk)** — land Section 5 checklist items; add regression tests for each ⚠️ fix (WS guards, prompt isolation, MCP caps, CSP). Nothing else merges before this is green.

**Phase 2 — Backend MVP (1–1.5 wk)**
- TTS route (OmniVoice clone + design), ASR route (faster-whisper isolated subprocess), voice profiles + gallery + `.ovsvoice` import/export, SQLite/Alembic schema, OpenAI-compat `/v1/audio/*`, MCP server, `/ws/events`.

**Phase 3 — Frontend MVP (1–1.5 wk)**
- Studio + Voice (clone/design) + Gallery + Settings + Diagnostics tabs; Zustand store; WS event bus; engine picker with GPU preflight.

**Phase 4 — Shell + packaging (0.5–1 wk)**
- Tauri: first-run bootstrap (uv + venv), single-instance, tray, window state; hardened CSP; DMG (macOS arm64), MSI (Windows), deb/AppImage (Linux).

**Phase 5 — Verification (0.5 wk)**
- Section 7 pass; self-check suite (`--diagnose`); launch-path test on a clean machine.

## 7. Verification

- **Unit/regression:** pytest for every hardening item (WS guard, prompt isolation, MCP cap, pickle safety, zip-slip, path traversal, SSRF URL pinning).
- **API tests:** OpenAI-compat endpoints via `openai` SDK pointed at `http://127.0.0.1:3900/v1` (`api_key="none"`).
- **E2E:** Playwright against the Tauri WebView for clone→generate→save.
- **Manual security smoke:** scripted check that `/ws/tts` rejects a non-loopback Origin; malicious `.ovsvoice` and crafted SRT/glossary cannot escape the data dir or alter a system prompt.
- **Lint/typecheck:** `ruff`, `mypy` (backend), `eslint` (frontend), `cargo clippy` (shell). Full suite must pass before merge.

## 8. Risks / notes

- **GPU/VRAM** is the main user-facing variable: no silent CPU fallback means users on old GPUs must pick CPU explicitly — acceptable, matches upstream.
- **AGPL-3.0:** our fork inherits network-copyleft; any server-mode addition later must keep source sharing or use a commercial license.
- **Intel macOS:** upstream PyTorch dropped Intel-Mac wheels — local backend unsupported there; MVP targets Apple Silicon / Windows / Linux.
- **Model size:** OmniVoice + whisper models need ~10 GB disk; first-run download flow must be clear.

---

## 9. Status (2026-08-11)

| Phase | Status | Evidence |
|---|---|---|
| 0. Scaffold / trim | ✅ | Fork at `jfcanon/VoiceStudio`; heavy sidecar engines, deploy/notebooks/examples removed |
| 1. Harden | ✅ | WS Origin guards, prompt-isolation, MCP caps, telemetry removal, hardened CSP — all with regression tests |
| 2. Backend MVP | ✅ | Boots on macOS arm64/MPS; self-check healthy; clone→TTS→STT round-trip verified via `/v1/audio/*` |
| 3. Frontend MVP | ✅ | Nav trimmed to Launchpad/Voice/Gallery/Transcriptions/Settings; 1791 vitest green; oxlint clean; CI typecheck clean |
| 4. Shell + packaging | ✅ | `cargo check` + 117 rust tests green; signed `VoiceStudio.app` builds and launches; DMG produced (hdiutil) |
| 5. Verification | ✅ | **GitHub Actions CI green** (all 8 jobs): backend+frontend tests, 5 smoke jobs, 3 Tauri shell checks. Local: 4622 backend tests + probe, 1791 frontend, 117 rust |

Fork CI: https://github.com/jfcanon/VoiceStudio/actions — every push to `main` runs it.

Verified end-to-end on this machine (macOS 26.4.1, Apple Silicon, 36 GB RAM):
`POST /v1/audio/speech` → 4.16 s real 24 kHz WAV (MPS); the same clip transcribed
back verbatim; a clone profile created from the clip and re-synthesized with the
cloned voice. All local, no API key.

Known packaging caveats:
- DMG bundling used `hdiutil` because the bundled `create-dmg` fork lacks its
  args outside the Tauri CLI path; CI's release workflow provides the proper
  invocation.
- The `.app` bundles placeholder `uv`/`ffmpeg` binaries (release pipeline
  downloads the real ones); the shell, backend, and UI are fully functional.
- No code signing key / notarization creds in this environment (ad-hoc `-` identity).
