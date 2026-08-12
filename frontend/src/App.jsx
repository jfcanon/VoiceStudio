import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  Suspense,
  lazy,
} from 'react';
import './index.css';
import { useAppStore, FONT_STACKS } from './store';
import SearchableSelect from './components/SearchableSelect';

// Lazy-load heavy/conditional components so they don't bloat the initial bundle.
const AudioTrimmer = lazy(() => import('./components/AudioTrimmer'));
const Launchpad = lazy(() => import('./pages/Launchpad'));
const CloneDesignTab = lazy(() => import('./pages/CloneDesignTab'));
const Sidebar = lazy(() => import('./components/Sidebar'));
const CompareModal = lazy(() => import('./components/CompareModal'));
const Settings = lazy(() => import('./pages/Settings'));
const VoiceProfile = lazy(() => import('./pages/VoiceProfile'));
const SetupWizard = lazy(() => import('./pages/SetupWizard'));
const KeyboardCheatsheet = lazy(() => import('./components/KeyboardCheatsheet'));
const VoicePreview = lazy(() => import('./components/VoicePreview'));
const LogsFooter = lazy(() => import('./components/LogsFooter'));
const VoiceGallery = lazy(() => import('./pages/VoiceGallery'));
const TranscriptionsPage = lazy(() => import('./pages/Transcriptions'));

import Header from './components/Header';
import NavRail from './components/NavRail';
import TitleTabs from './components/TitleTabs';
import WorkspaceHistory from './components/WorkspaceHistory';
import WorkspaceVoices from './components/WorkspaceVoices';
import WorkspaceProjects from './components/WorkspaceProjects';
import ErrorBoundary from './components/ErrorBoundary';
import FloatingPill from './components/FloatingPill';
import GlobalAudioPlayer from './components/GlobalAudioPlayer';
import BackendCrashNotice from './components/BackendCrashNotice';
import BackendStartFailureNotice from './components/BackendStartFailureNotice';
import LanguageSwitchPrompt from './components/LanguageSwitchPrompt';
import BackendRestartBanner from './components/BackendRestartBanner';
// RemoteAuthGate is mounted at the true outermost provider in main-app.jsx so
// it covers all app states (setup check / wizard / bootstrap), not just the
// main studio return below. Do not re-wrap here — double-gating renders two
// PIN dialogs.

import { BootstrapSplash, useBootstrapStage } from './components/BootstrapSplash';

import { askConfirm } from './utils/dialog';
import useRecording from './hooks/useRecording';
import useSegmentEditing from './hooks/useSegmentEditing';
import useAppData from './hooks/useAppData';
import useProfiles from './hooks/useProfiles';
import useTTS from './hooks/useTTS';

const LazyFallback = () => <div className="app-lazy-fallback">{i18n.t('app.loading')}</div>;

import { Toaster, toast } from 'react-hot-toast';
import { toastErrorWithReport } from './utils/errorToast';
import { listenDictationNotice, showDictationNotice } from './utils/dictationNotice';
import { addBreadcrumb } from './utils/breadcrumbs';
import { appShellClasses } from './utils/appShellClasses';
import { applyUiScale } from './utils/uiScaleEngine';
import { recordValueMoment } from './utils/donationMoments';
import {
  POPULAR_LANGS,
  POPULAR_ISO,
  TAGS,
  CATEGORIES,
  PRESETS,
  CLONE_MAX_SECONDS,
} from './utils/constants';
import { LANG_CODES } from './utils/languages';
import { API, apiFetch } from './api/client';
import { flushMemory as apiFlushMemory } from './api/system';
import { exportAction, exportReveal, exportRecord } from './api/exports';
import {
  clearHistory as apiClearHistory,
  setHistoryStarred as apiSetHistoryStarred,
  audioUrlWithCacheBust,
} from './api/generate';
import { clearDubHistory as apiClearDubHistory } from './api/dub';

import { isTauri, doubleClickMaximize, fileToMediaUrl, playBlobAudio } from './utils/media';
import { browserDownload } from './utils/download';
import { checkForUpdate, fetchAppVersion } from './utils/updater';
import { syncChannel } from './utils/channelControl';
import i18n from './i18n';

function App() {
  // First-run bootstrap: Rust spawns uv sync in a background thread and
  // publishes progress via the `bootstrap_status` Tauri command. Hook below
  // polls every 1 s; until `ready`, we render BootstrapSplash instead of the
  // normal app shell, so the user sees real progress instead of a hung UI.
  const { stage: bootstrapStage, message: bootstrapMessage } = useBootstrapStage();

  // Local MVP fork: telemetry was removed — there is no analytics to init.

  // UI navigation state now lives in the Zustand `uiSlice` (Phase 2.2).
  // Mode + uiScale + sidebar-collapsed persist across reloads automatically
  // via the store's `partialize`; active project / voice ids stay transient.
  const uiScale = useAppStore((s) => s.uiScale);

  // Responsive shell breakpoints driven off the app-container's OWN width, not
  // the viewport. The shell is sized `width: calc(100vw / --ui-scale)` then
  // `zoom: --ui-scale` (#504; the WebKitGTK no-op case is handled by the
  // data-zoom-layout probe below), so the grid lays out against `100vw/scale` —
  // which `el.clientWidth` reports. Viewport `@media` queries fire on raw
  // `100vw` and so collapse at the wrong threshold whenever the UI scale ≠ 1,
  // cramming the content into a sliver. ResizeObserver fires on both window
  // resize and scale change (the calc width changes), so this stays correct.
  const shellRef = useRef(null);
  const [shellWidth, setShellWidth] = useState(Infinity);
  useEffect(() => {
    const el = shellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => setShellWidth(el.clientWidth));
    ro.observe(el);
    setShellWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Desktop UI scale belongs at the webview boundary. A CSS `zoom` probe can
  // report the expected bounding box on WebKitGTK even when the painted shell
  // still occupies only the upper-left of the window. Tauri's native zoom keeps
  // layout and paint in agreement; browser/dev sessions retain the CSS path.
  useLayoutEffect(() => {
    void applyUiScale(uiScale);
  }, [uiScale]);
  const shellSizeClass =
    shellWidth <= 600 ? 'shell-mini' : shellWidth <= 1100 ? 'shell-narrow' : '';
  const theme = useAppStore((s) => s.theme);

  const locale = useAppStore((s) => s.locale);
  const font = useAppStore((s) => s.font);

  // Hydrate the theme, locale & font so persisted preferences take effect after
  // zustand persist rehydrates (async from localStorage) and when the user
  // changes them at runtime.
  useEffect(() => {
    if (theme && theme !== 'gruvbox') {
      document.documentElement.setAttribute('data-theme', theme);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (locale) {
      i18n.changeLanguage(locale);
    }
    // Re-apply the global font the same way setFont does, so a persisted
    // non-default font takes effect on launch.
    const fontStack = FONT_STACKS[font];
    if (fontStack) document.documentElement.style.setProperty('--font-sans', fontStack);
    else document.documentElement.style.removeProperty('--font-sans');
  }, [locale, theme, font]);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  // "Define voice" method inside the Voice (studio) workspace — replaces the
  // old clone/design navigation split (voice-studio-unification P4).
  const defineMethod = useAppStore((s) => s.defineMethod);
  const setDefineMethod = useAppStore((s) => s.setDefineMethod);
  // Breadcrumb every view change — mode names are a closed set, so this is
  // privacy-safe by construction (see utils/breadcrumbs.js).
  useEffect(() => {
    addBreadcrumb(`view:${mode}`);
  }, [mode]);
  // Navigation skin: the icon rail (default) or titlebar tabs (Settings →
  // Appearance). Only one of the two renders at a time.
  const navStyle = useAppStore((s) => s.navStyle);
  const [navRailSide, setNavRailSide] = useState(() => {
    try {
      return localStorage.getItem('omnivoice.navRailSide') || 'left';
    } catch {
      return 'left';
    }
  });
  const showCheatsheet = useAppStore((s) => s.showCheatsheet);
  const setShowCheatsheet = useAppStore((s) => s.setShowCheatsheet);

  // Global '?' → open cheatsheet
  useEffect(() => {
    const h = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowCheatsheet((v) => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Listen for tray navigation events (Tauri desktop)
  useEffect(() => {
    let unlisten;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('tray-navigate', (ev) => {
          if (ev.payload) setMode(ev.payload);
        });
      } catch {
        /* not in Tauri */
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [setMode]);

  // Dictation failures are raised in the widget window, which is never shown —
  // this is the only place they can reach the user. Without it, a hotkey press
  // that can't paste (Accessibility ungranted) or can't record (mic denied)
  // would be indistinguishable from a hotkey that isn't working at all.
  useEffect(() => {
    let unlisten;
    let cancelled = false;
    (async () => {
      const stop = await listenDictationNotice(showDictationNotice);
      // The await above can outlive the effect (StrictMode double-mount, or a
      // fast unmount) — drop the subscription rather than leaking a listener
      // that would double every later toast.
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);
  const flipNavRailSide = useCallback(() => {
    setNavRailSide((prev) => {
      const next = prev === 'left' ? 'right' : 'left';
      try {
        localStorage.setItem('omnivoice.navRailSide', next);
      } catch {}
      return next;
    });
  }, []);
  // Voice-profile navigation — slice owns "remember where I was" for Back.
  const activeVoiceId = useAppStore((s) => s.activeVoiceId);
  const openVoiceProfile = useAppStore((s) => s.openVoiceProfile);
  const closeVoiceProfile = useAppStore((s) => s.closeVoiceProfile);
  const hideSidebar =
    mode === 'launchpad' ||
    mode === 'settings' ||
    mode === 'voice' ||
    mode === 'gallery' ||
    mode === 'transcriptions' ||
    // Voice (studio) moved its saved voices / projects + history into
    // right-side panels; left sidebar dissolved.
    mode === 'studio';
  const availableSidebarTabs = [];
  // Generate-tab prefs now live in `generateSlice` (Phase 2.2). Persisted
  // knobs survive reloads via the store's `partialize`.
  const text = useAppStore((s) => s.text);
  const setText = useAppStore((s) => s.setText);
  const refText = useAppStore((s) => s.refText);
  const setRefText = useAppStore((s) => s.setRefText);
  const instruct = useAppStore((s) => s.instruct);
  const setInstruct = useAppStore((s) => s.setInstruct);
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);

  const speed = useAppStore((s) => s.speed);
  const setSpeed = useAppStore((s) => s.setSpeed);
  const steps = useAppStore((s) => s.steps);
  const setSteps = useAppStore((s) => s.setSteps);
  const cfg = useAppStore((s) => s.cfg);
  const setCfg = useAppStore((s) => s.setCfg);
  const denoise = useAppStore((s) => s.denoise);
  const setDenoise = useAppStore((s) => s.setDenoise);
  const tShift = useAppStore((s) => s.tShift);
  const setTShift = useAppStore((s) => s.setTShift);
  const posTemp = useAppStore((s) => s.posTemp);
  const setPosTemp = useAppStore((s) => s.setPosTemp);
  const classTemp = useAppStore((s) => s.classTemp);
  const setClassTemp = useAppStore((s) => s.setClassTemp);
  const layerPenalty = useAppStore((s) => s.layerPenalty);
  const setLayerPenalty = useAppStore((s) => s.setLayerPenalty);
  const postprocess = useAppStore((s) => s.postprocess);
  const setPostprocess = useAppStore((s) => s.setPostprocess);
  const duration = useAppStore((s) => s.duration);
  const setDuration = useAppStore((s) => s.setDuration);
  const vdStates = useAppStore((s) => s.vdStates);
  const setVdStates = useAppStore((s) => s.setVdStates);

  // ═══ EXTRACTED HOOKS ═══
  const {
    profiles,
    history,
    dubHistory,
    studioProjects,
    exportHistory,
    showOverrides,
    setShowOverrides,
    modelStatus,
    loadProfiles,
    loadHistory,
    loadDubHistory,
    loadExportHistory,
  } = useAppData();

  const {
    selectedProfile,
    setSelectedProfile,
    showSaveProfile,
    setShowSaveProfile,
    profileName,
    setProfileName,
    previewLoading,
    isVoicePreviewOpen,
    setIsVoicePreviewOpen,
    voicePreviewProfileId,
    setVoicePreviewProfileId,
    handleSaveProfile: _handleSaveProfile,
    handleSaveDesignProfile,
    handleDeleteProfile,
    handleSelectProfile,
    handlePreviewVoice,
    handleSaveHistoryAsProfile,
    handleLockProfile,
    handleUnlockProfile,
  } = useProfiles({ loadHistory, loadProfiles });

  const {
    refAudio,
    setRefAudio,
    pendingTrimFile,
    setPendingTrimFile,
    isGenerating,
    generationTime,
    textAreaRef,
    ingestRefAudio,
    insertTag,
    applyPreset,
    handleGenerate,
  } = useTTS({ selectedProfile, setSelectedProfile, loadHistory, profiles });

  const handleSaveProfile = () => _handleSaveProfile(refAudio, refText, instruct, language);

  // ═══ PENDING PROFILE HAND-OFF ═══
  // Views like the Gallery hand a freshly-created profile to the synthesis view
  // via store.pendingProfileId + setMode('studio'). The profile may not be in the
  // loaded list yet (it arrives via loadProfiles / the realtime `profiles` event),
  // so we wait for it to appear, select it, then clear the hand-off.
  const pendingProfileId = useAppStore((s) => s.pendingProfileId);
  const setPendingProfileId = useAppStore((s) => s.setPendingProfileId);
  const pendingRefreshRef = useRef(null);
  useEffect(() => {
    if (!pendingProfileId) {
      pendingRefreshRef.current = null;
      return;
    }
    const prof = profiles.find((p) => p.id === pendingProfileId);
    if (prof) {
      handleSelectProfile(prof);
      setPendingProfileId(null);
      pendingRefreshRef.current = null;
      return;
    }
    // Not loaded yet — refresh the list once; the effect re-runs when it arrives.
    if (pendingRefreshRef.current !== pendingProfileId) {
      pendingRefreshRef.current = pendingProfileId;
      loadProfiles();
    }
  }, [pendingProfileId, profiles, handleSelectProfile, loadProfiles, setPendingProfileId]);

  // A/B Voice Comparison State
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [compareVoiceA, setCompareVoiceA] = useState('');
  const [compareVoiceB, setCompareVoiceB] = useState('');
  const [compareText, setCompareText] = useState(
    'The quick brown fox jumps over the lazy dog, proving that this voice sounds much better.',
  );
  const [compareResultA, setCompareResultA] = useState(null);
  const [compareResultB, setCompareResultB] = useState(null);
  const [isComparing, setIsComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState('');

  // ═══ MIC RECORDING ═══
  const {
    isRecording,
    isCleaning,
    recordingTime,
    audioInputs,
    selectedAudioInputId,
    setSelectedAudioInputId,
    channelMode,
    setChannelMode,
    inputLevelStore,
    startRecording,
    stopRecording,
  } = useRecording(ingestRefAudio);

  // ── UNDO / REDO ──
  // Local MVP fork: dubbing, stories, and audiobook state were removed, so the
  // undo/redo (studio generate history) is the only thing left from the old
  // segment-editing hook family.
  const { undo, redo, recomputeIncremental } = useSegmentEditing();

  useEffect(() => {
    recomputeIncremental();
  }, [recomputeIncremental]);

  // ═══ STUDIO PROJECTS ═══
  const activeProjectName = useAppStore((s) => s.activeProjectName);
  const sidebarTab = useAppStore((s) => s.sidebarTab);
  const setSidebarTab = useAppStore((s) => s.setSidebarTab);

  // Snap sidebar to a valid tab when view changes
  useEffect(() => {
    if (availableSidebarTabs.length && !availableSidebarTabs.includes(sidebarTab)) {
      setSidebarTab(availableSidebarTabs[0]);
    }
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const isSidebarProjectsCollapsed = useAppStore((s) => s.isSidebarProjectsCollapsed);
  const setIsSidebarProjectsCollapsed = useAppStore((s) => s.setIsSidebarProjectsCollapsed);
  const isSidebarCollapsed = useAppStore((s) => s.isSidebarCollapsed);
  const setIsSidebarCollapsed = useAppStore((s) => s.setIsSidebarCollapsed);

  // First-run gate — `/setup/status` reports whether required HF models are
  // on disk. If not, we render <SetupWizard> in place of the main studio so
  // the user actually SEES the download instead of a silent 5 GB hang.
  //
  // Packaged .app note: the frozen backend sidecar takes several seconds to
  // import torch/torchaudio/whisper/etc. before it can serve /setup/status.
  // A single fetch on mount lands during that window, fails, and the wizard
  // would never render. So we retry with backoff until we get a response or
  // the user gives up. `setupChecked` gates main-UI render so we don't flash
  // the studio in front of a user who actually needs the wizard.
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [setupChecked, setSetupChecked] = useState(false);
  useEffect(() => {
    // Gate the probe on the bootstrap being 'ready' — before that there is
    // no backend to answer. Probing from mount burned the 30-attempt ceiling
    // during the setup/installing acts (minutes long on a first run), so the
    // wizard was silently skipped straight into the studio once the install
    // finished. Keyed on bootstrapStage: the probe (re)runs the moment the
    // backend becomes reachable.
    if (bootstrapStage !== 'ready') return undefined;
    let cancelled = false;
    (async () => {
      const { setupStatus } = await import('./api/setup');
      // ~30 attempts × ~1s ≈ 30s ceiling; enough for a cold sidecar on slow disks.
      for (let attempt = 0; attempt < 30 && !cancelled; attempt++) {
        try {
          const s = await setupStatus();
          if (cancelled) return;
          setSetupNeeded(!s.models_ready);
          setSetupChecked(true);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      if (!cancelled) setSetupChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapStage]);

  // ── First sound ──
  // Onboarding should end with the product doing the thing: the moment the
  // studio mounts after the wizard, generate one short line locally and play
  // it. Best-effort by design — a first impression must never surface an
  // error, so every failure path is silent.
  useEffect(() => {
    if (!setupChecked || setupNeeded || bootstrapStage !== 'ready') return;
    let pending = false;
    try {
      pending = sessionStorage.getItem('omnivoice.firstSound') === '1';
      if (pending) sessionStorage.removeItem('omnivoice.firstSound');
    } catch {
      /* private mode */
    }
    if (!pending) return;
    (async () => {
      try {
        const fd = new FormData();
        fd.append('text', i18n.t('firstrun.first_sound_text'));
        // Functional model prompt (not user-facing copy) — keeps the demo
        // voice warm without depending on seeded profiles.
        fd.append('instruct', 'A warm, friendly narrator voice, medium pace');
        fd.append('num_step', '16');
        const res = await apiFetch(`${API}/generate`, {
          method: 'POST',
          body: fd,
        });
        const blob = await res.blob();
        await playBlobAudio(blob, { label: i18n.t('player.generated_audio') });
        toast.success(i18n.t('firstrun.first_sound_done'), { duration: 7000 });
      } catch {
        /* silent — see above */
      }
    })();
  }, [setupChecked, setupNeeded, bootstrapStage]);

  // ── Tauri auto-updater ──
  // On boot, ask GitHub Releases if a newer build is available. If yes,
  // prompt the user, download the signed bundle, restart into the new
  // version. Only runs in packaged .app (not `tauri dev`) — the updater
  // endpoint 404s until the first signed release is published, and we
  // don't want that noise in the dev console.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('__TAURI_INTERNALS__' in window)) return;
    if (import.meta.env.DEV) return;
    // Non-blocking: surface update availability into the store so the user can
    // choose to install + restart (with a progress bar) from Settings → Updates,
    // so an update never interrupts in-flight work.
    fetchAppVersion().then((v) => useAppStore.getState().setAppVersion(v));
    syncChannel(useAppStore.getState());
    checkForUpdate(useAppStore.getState());
    // Re-check periodically so a long-running session still gets notified, not
    // only at boot. checkForUpdate no-ops while a download/restart is already
    // in flight, so this can't interrupt an install.
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const id = setInterval(() => checkForUpdate(useAppStore.getState()), SIX_HOURS);
    return () => clearInterval(id);
  }, []);

  // ── DESKTOP NATIVE INTEGRATION ──
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 1. Prevent default right-click to hide web nature
    const handleContextMenu = (e) => {
      // allow on inputs/textareas for copy/paste
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      e.preventDefault();
    };

    // 2. Prevent keyboard quicks (reload, zoom, print)
    const handleKeyDown = (e) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (['r', 'p', '=', '-', '+'].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
    };

    // 3. Prevent pinch-to-zoom
    const handleWheel = (e) => {
      if (e.ctrlKey) e.preventDefault();
    };

    // 4. Global Drag and drop for seamless native feeling.
    // Local MVP fork: dubbing is out of scope, so a dropped media file can no
    // longer route into the dub editor — the drop is ignored.
    const handleDrop = (e) => {
      e.preventDefault();
    };
    const handleDragOver = (e) => e.preventDefault();

    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);

    return () => {
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
    };
  }, []);

  // ── KEYBOARD SHORTCUTS ──
  useEffect(() => {
    const handler = (e) => {
      // ⌘+Enter or Ctrl+Enter → Generate
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isGenerating) handleGenerate();
        return;
      }
      // ⌘+S or Ctrl+S → Save project
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        return;
      }
      // ⌘+Z → Undo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // ⌘+Shift+Z → Redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const handleNativeExport = async (e, sourceIdentifier, fallbackName, mode) => {
    addBreadcrumb('export');
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    // Browser / Docker web build: there is no Tauri shell, so the native save
    // dialog is unavailable — invoking it throws "Cannot read properties of
    // undefined (reading 'invoke')" (issue #256). Fall back to a plain HTTP
    // blob download of the file already served at /audio/<path>.
    if (!isTauri) {
      const niceName = (fallbackName || sourceIdentifier || 'audio').split('/').pop();
      try {
        const finalName = await browserDownload(`${API}/audio/${sourceIdentifier}`, niceName);
        toast.success(i18n.t('app.toast_downloaded', { name: finalName }));
        recordValueMoment('export'); // success-only donation moment
        try {
          await exportRecord({
            filename: finalName,
            destination_path: `~/Downloads/${finalName}`,
            mode,
          });
          loadExportHistory();
        } catch (err) {
          console.warn('exportRecord (browser export path) failed:', err);
        }
      } catch (err) {
        console.error(err);
        toastErrorWithReport(
          i18n.t('app.toast_export_failed', { message: err?.message || err }),
          err,
        );
      }
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const selection = await invoke('authorize_host_path', {
        kind: 'dub_export',
        suggestedName: fallbackName,
      });
      if (!selection) return; // User cancelled

      await exportAction({
        source_filename: sourceIdentifier,
        authorization: selection.authorization,
        mode,
      });
      toast.success(i18n.t('app.toast_exported', { name: fallbackName }));
      recordValueMoment('export'); // success-only donation moment
      loadExportHistory();
    } catch (err) {
      console.error(err);
      toastErrorWithReport(
        i18n.t('app.toast_export_failed', { message: err?.message || err }),
        err,
      );
    }
  };
  const revealInFolder = async (filePath) => {
    try {
      await exportReveal({ path: filePath });
    } catch (err) {
      toast.error(i18n.t('app.toast_open_folder_failed', { message: err.message }));
    }
  };

  const restoreHistory = (item) => {
    // History `mode` values stay 'clone'/'design' forever — only the
    // navigation mode id changed. Map them onto the unified 'studio'
    // workspace + its define method (voice-studio-unification P4).
    if (item.mode === 'clone' || item.mode === 'design') {
      setMode('studio');
      setDefineMethod(item.mode === 'clone' ? 'audio' : 'design');
    } else if (item.mode) {
      setMode(item.mode);
    }
    if (item.text) setText(item.text);
    if (item.language) setLanguage(item.language);
    if (item.profile_id) setSelectedProfile(item.profile_id);

    toast.success(i18n.t('app.toast_restored_state'));
  };

  // Generation takes: star/unstar a take so it survives the retention cap and
  // never ages off the rail. Optimistic errors only — the WS
  // generation_history event refreshes the list on success.
  const toggleStarHistory = async (item) => {
    try {
      await apiSetHistoryStarred(item.id, !item.starred);
      loadHistory();
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Load a past take back as the active output: fetch its WAV and hand it to
  // the same global mini-player a fresh generation plays through.
  const playTakeAsOutput = async (item) => {
    try {
      const res = await apiFetch(audioUrlWithCacheBust(item.audio_path));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await playBlobAudio(blob, {
        label: item.text || i18n.t('player.generated_audio'),
      });
    } catch (err) {
      toast.error(i18n.t('history.load_take_failed', { message: err.message || '' }));
    }
  };

  const deleteHistory = async (id, type) => {
    if (!(await askConfirm('Delete this history item?'))) return;
    try {
      const endpoint = type === 'dub' ? `${API}/dub/history/${id}` : `${API}/history/${id}`;
      await apiFetch(endpoint, { method: 'DELETE' });
      if (type === 'dub') {
        loadDubHistory();
      } else {
        loadHistory();
      }
      toast.success(i18n.t('app.toast_history_deleted'));
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Clear-all for the workspace history panels (#1032). The control lived in
  // the old left Sidebar; the workspace UX overhaul (#374) moved history into
  // the right-side WorkspaceHistory panels and the button was dropped in the
  // move — restore it, scoped per workspace (voice = synth rows, dub = dubs).
  const clearWorkspaceHistory = async (type) => {
    const count = type === 'dub' ? dubHistory.length : history.length;
    if (!(await askConfirm(i18n.t('sidebar.clear_confirm', { count })))) return;
    try {
      if (type === 'dub') {
        await apiClearDubHistory();
        loadDubHistory();
      } else {
        await apiClearHistory();
        loadHistory();
      }
      toast.success(i18n.t('sidebar.history_cleared'));
    } catch (err) {
      toast.error(err.message);
    }
  };

  // Install-plan screen outranks everything — both on a true first run and
  // when explicitly requested via `--setup`. Without this, a live backend
  // answering /setup/status would route straight to the model wizard and the
  // awaiting_setup stage would never get to render.
  if (bootstrapStage === 'awaiting_setup') {
    return (
      <div className="app-bootstrap-scale" style={{ '--ui-scale': uiScale }}>
        <BootstrapSplash stage={bootstrapStage} message={bootstrapMessage} />
      </div>
    );
  }
  // First-run gate: if /setup/status says models aren't on disk yet, render
  // the wizard instead of the main studio. Dismisses itself once the user
  // completes the download (or clicks "Skip" if they want to limp along).
  // Also blocks render until we've heard back from the backend at least once
  // — the frozen sidecar's cold-start import is ~5-10 s and without this we
  // flash the empty studio before the wizard has a chance to mount.
  if (!setupChecked) {
    return (
      <div className="app-bootstrap-scale" style={{ '--ui-scale': uiScale }}>
        <BootstrapSplash stage={bootstrapStage} message={bootstrapMessage} />
      </div>
    );
  }
  if (setupNeeded && bootstrapStage === 'ready') {
    // Render outside the `app-container` grid so the wizard spans the full
    // viewport instead of getting squeezed into whatever grid cell the
    // studio layout reserves for the main content column. Gated on the
    // bootstrap being 'ready': while the stage is still settling (checking /
    // awaiting_setup racing the first poll), the wizard must not steal the
    // mount from the install-plan screen.
    // `--ui-scale`, NOT a bare inline `zoom`: the CSS shrinks the box by the
    // scale and zooms it back (#504 contract, same as .app-container). An
    // inline zoom on top of a full-viewport box pushed the pinned
    // Continue/HF-token row below the window at any scale > 1.
    return (
      <div className="app-wizard-wrap" style={{ '--ui-scale': uiScale }}>
        {/* Invisible drag strip across the top 28 px of the wizard —
            matches the macOS traffic-light zone so the window can be
            dragged / double-click-zoomed from anywhere along the top. */}
        {/* Double-click-to-maximize is handled globally in main.jsx for every
            drag region (splash, first-run, wizard, main) on all platforms. */}
        <div data-tauri-drag-region className="app-wizard-dragstrip" />
        {/* The wizard is where the multi-GB downloads happen — a mid-download
            backend restart needs its banner here too, not only in the studio. */}
        <BackendRestartBanner />
        <Suspense fallback={<LazyFallback />}>
          <SetupWizard
            onReady={() => {
              // First-sound handoff: the studio's first act after onboarding is
              // to speak. sessionStorage (not localStorage) so it never replays
              // on later launches — only on the run that finished the wizard.
              try {
                sessionStorage.setItem('omnivoice.firstSound', '1');
              } catch {
                /* private mode */
              }
              setSetupNeeded(false);
            }}
          />
        </Suspense>
      </div>
    );
  }

  // Block the main UI until Rust reports the backend is ready. In dev web
  // (no Tauri), the hook returns 'ready' immediately so this is a no-op.
  if (bootstrapStage !== 'ready') {
    return <BootstrapSplash stage={bootstrapStage} message={bootstrapMessage} />;
  }

  return (
    <div
      ref={shellRef}
      className={appShellClasses({
        navStyle,
        navRailSide,
        isSidebarCollapsed,
        hideSidebar,
        shellSizeClass,
      })}
      style={{ '--ui-scale': uiScale }}
    >
      {pendingTrimFile && (
        <ErrorBoundary name="audio-trimmer">
          <Suspense fallback={<LazyFallback />}>
            <AudioTrimmer
              file={pendingTrimFile}
              maxSeconds={CLONE_MAX_SECONDS}
              onCancel={() => setPendingTrimFile(null)}
              onConfirm={(trimmed) => {
                setPendingTrimFile(null);
                setRefAudio(trimmed);
                setSelectedProfile(null);
                toast.success(i18n.t('app.trimmed_loaded'));
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: 'rgba(40,40,40,0.9)',
            backdropFilter: 'blur(10px)',
            color: '#ebdbb2',
            border: '1px solid rgba(255,255,255,0.08)',
            fontSize: '0.72rem',
            padding: '4px 8px',
          },
          error: { iconTheme: { primary: '#fb4934', secondary: '#fff' } },
          success: { iconTheme: { primary: '#b8bb26', secondary: '#fff' } },
        }}
      />

      <FloatingPill />

      {/* #941: honest surfacing of backend process crashes (exit code +
          stderr tail from the shell's crash marker), with ack-on-view. */}
      <BackendCrashNotice />

      {/* #1177: the shell's `Failed { message }` diagnosis for a backend that
          could not START, surfaced after the splash is gone — the case that
          used to collapse into the evidence-free "can't reach the backend". */}
      <BackendStartFailureNotice />

      {/* First-run-only offer to switch the UI to English (#1215). Shows only
          when the auto-detected language isn't English AND the user hasn't
          chosen a language — renders nothing otherwise. UI convenience only. */}
      <LanguageSwitchPrompt />

      {/* #567's visible half: while the shell auto-restarts a dead backend
          (10–20 s), say so once — instead of every request surfacing its own
          "Can't reach the backend" toast. */}
      <BackendRestartBanner />

      <Header
        mode={mode}
        setMode={setMode}
        navStyle={navStyle}
        modelStatus={modelStatus}
        doubleClickMaximize={doubleClickMaximize}
        activeProjectName={activeProjectName}
        onFlushMemory={async (unloadModel) => {
          try {
            const r = await apiFlushMemory(unloadModel);
            toast.success(
              i18n.t('app.toast_flushed', {
                ram: r.ram_after,
                vram: r.vram_after,
                unloaded: r.unloaded_model ? i18n.t('app.toast_model_unloaded') : '',
              }),
            );
          } catch (e) {
            toast.error(i18n.t('app.toast_flush_failed', { message: e.message }));
          }
        }}
      />

      {navStyle === 'tabs' ? null : (
        <NavRail mode={mode} setMode={setMode} side={navRailSide} onFlipSide={flipNavRailSide} />
      )}

      <div className="main-content">
        {/* ═══ LAUNCHPAD TAB ═══ */}
        {mode === 'settings' ? (
          <ErrorBoundary name="settings">
            <Suspense fallback={<LazyFallback />}>
              <Settings />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'voice' ? (
          <ErrorBoundary name="voice-profile">
            <Suspense fallback={<LazyFallback />}>
              <VoiceProfile
                voiceId={activeVoiceId}
                onBack={closeVoiceProfile}
                onDeleted={() => {
                  loadProfiles();
                  closeVoiceProfile();
                }}
              />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'gallery' ? (
          <ErrorBoundary name="gallery">
            <Suspense fallback={<LazyFallback />}>
              <VoiceGallery />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'transcriptions' ? (
          <ErrorBoundary name="transcriptions">
            <Suspense fallback={<LazyFallback />}>
              <TranscriptionsPage />
            </Suspense>
          </ErrorBoundary>
        ) : mode === 'launchpad' ? (
          <ErrorBoundary name="launchpad">
            <Suspense fallback={<LazyFallback />}>
              <Launchpad
                profiles={profiles}
                studioProjects={studioProjects}
                setMode={setMode}
                setIsCompareModalOpen={setIsCompareModalOpen}
                handleSelectProfile={handleSelectProfile}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <div className="studio-with-history">
            <div className="studio-with-history__main">
              <ErrorBoundary name="clone-design">
                <Suspense fallback={<LazyFallback />}>
                  <CloneDesignTab
                    textAreaRef={textAreaRef}
                    text={text}
                    setText={setText}
                    language={language}
                    setLanguage={setLanguage}
                    steps={steps}
                    setSteps={setSteps}
                    cfg={cfg}
                    setCfg={setCfg}
                    speed={speed}
                    setSpeed={setSpeed}
                    tShift={tShift}
                    setTShift={setTShift}
                    posTemp={posTemp}
                    setPosTemp={setPosTemp}
                    classTemp={classTemp}
                    setClassTemp={setClassTemp}
                    layerPenalty={layerPenalty}
                    setLayerPenalty={setLayerPenalty}
                    duration={duration}
                    setDuration={setDuration}
                    denoise={denoise}
                    setDenoise={setDenoise}
                    postprocess={postprocess}
                    setPostprocess={setPostprocess}
                    showOverrides={showOverrides}
                    setShowOverrides={setShowOverrides}
                    isSidebarCollapsed={isSidebarCollapsed}
                    setIsSidebarCollapsed={setIsSidebarCollapsed}
                    profiles={profiles}
                    selectedProfile={selectedProfile}
                    setSelectedProfile={setSelectedProfile}
                    refAudio={refAudio}
                    refText={refText}
                    setRefText={setRefText}
                    instruct={instruct}
                    setInstruct={setInstruct}
                    profileName={profileName}
                    setProfileName={setProfileName}
                    showSaveProfile={showSaveProfile}
                    setShowSaveProfile={setShowSaveProfile}
                    isRecording={isRecording}
                    isCleaning={isCleaning}
                    recordingTime={recordingTime}
                    audioInputs={audioInputs}
                    selectedAudioInputId={selectedAudioInputId}
                    setSelectedAudioInputId={setSelectedAudioInputId}
                    channelMode={channelMode}
                    setChannelMode={setChannelMode}
                    inputLevelStore={inputLevelStore}
                    vdStates={vdStates}
                    setVdStates={setVdStates}
                    isGenerating={isGenerating}
                    generationTime={generationTime}
                    applyPreset={applyPreset}
                    insertTag={insertTag}
                    handleSelectProfile={handleSelectProfile}
                    handleDeleteProfile={handleDeleteProfile}
                    handleSaveProfile={handleSaveProfile}
                    handleSaveDesignProfile={handleSaveDesignProfile}
                    handleGenerate={handleGenerate}
                    startRecording={startRecording}
                    stopRecording={stopRecording}
                    ingestRefAudio={ingestRefAudio}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
            <div className="studio-right">
              <WorkspaceVoices
                defineMethod={defineMethod}
                profiles={profiles}
                selectedProfile={selectedProfile}
                setSelectedProfile={setSelectedProfile}
                previewLoading={previewLoading}
                handleSelectProfile={handleSelectProfile}
                handleDeleteProfile={handleDeleteProfile}
                handlePreviewVoice={handlePreviewVoice}
                handleUnlockProfile={handleUnlockProfile}
                openVoiceProfile={openVoiceProfile}
                onOpenVoicePreview={(profileId) => {
                  setVoicePreviewProfileId(profileId || '');
                  setIsVoicePreviewOpen(true);
                }}
              />
              <WorkspaceHistory
                history={history}
                handleSaveHistoryAsProfile={handleSaveHistoryAsProfile}
                handleLockProfile={handleLockProfile}
                handleNativeExport={handleNativeExport}
                restoreHistory={restoreHistory}
                deleteHistory={deleteHistory}
                clearHistory={() => clearWorkspaceHistory('synth')}
                toggleStarHistory={toggleStarHistory}
                playTakeAsOutput={playTakeAsOutput}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── SIDEBAR ── */}
      <Suspense fallback={<LazyFallback />}>
        <Sidebar
          availableTabs={availableSidebarTabs}
          isSidebarProjectsCollapsed={isSidebarProjectsCollapsed}
          setIsSidebarProjectsCollapsed={setIsSidebarProjectsCollapsed}
          sidebarTab={sidebarTab}
          setSidebarTab={setSidebarTab}
          studioProjects={studioProjects}
          profiles={profiles}
          history={history}
          dubHistory={dubHistory}
          exportHistory={exportHistory}
          selectedProfile={selectedProfile}
          previewLoading={previewLoading}
          handleSelectProfile={handleSelectProfile}
          handleDeleteProfile={handleDeleteProfile}
          handleOpenVoiceProfile={openVoiceProfile}
          handleUnlockProfile={handleUnlockProfile}
          handleLockProfile={handleLockProfile}
          handlePreviewVoice={handlePreviewVoice}
          onOpenVoicePreview={(profileId) => {
            setVoicePreviewProfileId(profileId || '');
            setIsVoicePreviewOpen(true);
          }}
          restoreHistory={restoreHistory}
          handleSaveHistoryAsProfile={handleSaveHistoryAsProfile}
          handleNativeExport={handleNativeExport}
          revealInFolder={revealInFolder}
          deleteHistory={deleteHistory}
          loadHistory={loadHistory}
          loadDubHistory={loadDubHistory}
        />
      </Suspense>

      {/* ═══ A/B VOICE COMPARISON MODAL ═══ */}
      {isCompareModalOpen && (
        <Suspense fallback={<LazyFallback />}>
          <CompareModal
            open={isCompareModalOpen}
            onClose={() => setIsCompareModalOpen(false)}
            profiles={profiles}
            compareText={compareText}
            setCompareText={setCompareText}
            compareVoiceA={compareVoiceA}
            setCompareVoiceA={setCompareVoiceA}
            compareVoiceB={compareVoiceB}
            setCompareVoiceB={setCompareVoiceB}
            compareResultA={compareResultA}
            setCompareResultA={setCompareResultA}
            compareResultB={compareResultB}
            setCompareResultB={setCompareResultB}
            compareProgress={compareProgress}
            setCompareProgress={setCompareProgress}
            isComparing={isComparing}
            setIsComparing={setIsComparing}
            steps={steps}
            cfg={cfg}
            speed={speed}
            denoise={denoise}
            postprocess={postprocess}
            fileToMediaUrl={fileToMediaUrl}
            loadHistory={loadHistory}
          />
        </Suspense>
      )}

      {/* ═══ KEYBOARD CHEATSHEET ( ? ) ═══ */}
      {showCheatsheet && (
        <Suspense fallback={null}>
          <KeyboardCheatsheet open={showCheatsheet} onClose={() => setShowCheatsheet(false)} />
        </Suspense>
      )}

      {/* ═══ VOICE PREVIEW FLOATING CARD ═══ */}
      {isVoicePreviewOpen && (
        <Suspense fallback={null}>
          <VoicePreview
            open={isVoicePreviewOpen}
            onClose={() => setIsVoicePreviewOpen(false)}
            profiles={profiles}
            initialProfileId={voicePreviewProfileId}
            fileToMediaUrl={fileToMediaUrl}
          />
        </Suspense>
      )}

      {/* ═══ GLOBAL AUDIO MINI-PLAYER (grid row 3, above the footer) ═══
          Subsumes the #1032 PlaybackStopPill: waveform + seek + time + stop
          for every playBlobAudio playback that has no on-screen player. As a
          real grid row it can never overlap row-2 content or the footer. */}
      <GlobalAudioPlayer />

      {/* ═══ BOTTOM LOGS PANEL (VSCode-style) ═══ */}
      <Suspense fallback={null}>
        <LogsFooter />
      </Suspense>
    </div>
  );
}

export default App;
