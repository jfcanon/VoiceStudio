/**
 * Workspace navigation model — shared by both navigation presentations.
 *
 * The icon rail (`NavRail`) and the titlebar tab strip (`TitleTabs`) are two
 * skins of the SAME list; Settings → Appearance → Navigation style picks which
 * one renders. Declaring the workspaces once here means a new workspace shows
 * up in both skins from a single edit and the two can't drift apart.
 *
 * `accent` is the workspace's hue. Both skins spend it the same way: the
 * ACTIVE item wears it (rail indicator bar / tab top rule + icon), inactive
 * items stay neutral, so the chrome never turns into a colour chart.
 */
import {
  Fingerprint,
  Settings2,
  Library,
  FileText,
  Globe,
} from 'lucide-react';

/** The workspaces, in navigation order. `tKey` resolves as `nav.<tKey>`.
 *
 * Local MVP fork: the workspace set is trimmed to the core studio —
 * Voice (clone/design), Gallery, and Transcriptions. Dubbing, Stories,
 * Audiobook, and the OmniDrive project browser are out of MVP scope.
 */
export const NAV_ITEMS = [
  { id: 'launchpad', Icon: Globe, tKey: 'launchpad', accent: '#f3a5b6' },
  { id: 'studio', Icon: Fingerprint, tKey: 'voice', accent: '#d3869b' },
  { id: 'gallery', Icon: Library, tKey: 'gallery', accent: '#b8bb26' },
  { id: 'transcriptions', Icon: FileText, tKey: 'transcripts', accent: '#d3869b' },
];

/** Pinned to the end of the nav (rail footer / tab-strip tail). */
export const NAV_FOOTER_ITEMS = [
  { id: 'settings', Icon: Settings2, tKey: 'settings', accent: '#fabd2f' },
];
