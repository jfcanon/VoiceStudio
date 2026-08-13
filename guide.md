# VoiceStudio fork — secrets & release guide

This fork (`jfcanon/VoiceStudio`) ships **no telemetry and no committed
secrets**. Everything below explains where each credential comes from, how to
store it in your **Bitwarden** vault, and how to expose it to GitHub Actions.

> Principle used across your other repos (see `orca/projects/Finances/tools/secrets.sh`):
> **secrets never at rest** — fetch from Bitwarden at the moment they are needed,
> let them live only in the process environment, never write them to a repo.

---

## 1. Bitwarden CLI basics

The vault is unlocked by the human (the master password is never handled by a
script or an agent):

```sh
bw login jangofett86@gmail.com     # first time only
export BW_SESSION="$(bw unlock --raw)"   # you type the master password here
```

Fetch a secret by item name:

```sh
bw get password "<item name>" --session "$BW_SESSION"
bw get username  "<item name>" --session "$BW_SESSION"
bw get notes     "<item name>" --session "$BW_SESSION"
```

Set / create an item (e.g. for a new secret you generated):

```sh
bw get template item | jq '."name" = "voicestudio-tauri-signing-key" | ."login"."password" = "'"$NEW_SECRET"'"' \
  | bw encode | bw create item --session "$BW_SESSION"
```

---

## 2. What the release pipeline needs

From `.github/workflows/release.yml` (run `gh secret list` to see current state):

| GitHub secret | Bitwarden item (convention) | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | `voicestudio-tauri-signing-key` | Private key for the updater (see §3) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `voicestudio-tauri-signing-password` | Password you set when generating the key |
| `APPLE_CERTIFICATE` | `voicestudio-apple-dist-cert.p12` (base64) | Base64 of your Apple Distribution `.p12` (see §4) |
| `APPLE_CERTIFICATE_PASSWORD` | `voicestudio-apple-dist-cert-password` | Password of the `.p12` |
| `APPLE_SIGNING_IDENTITY` | `voicestudio-apple-signing-identity` | e.g. `Developer ID Application: John Doe (TEAMID)` |
| `APPLE_ID` | `voicestudio-apple-id` | Apple ID used for notarization |
| `APPLE_PASSWORD` | `voicestudio-apple-notarize-app-password` | App-specific password for notarization |
| `APPLE_TEAM_ID` | `voicestudio-apple-team-id` | 10-char team id |

> You don't need these for **local dev** — only for signed/notarized releases.
> Preview builds from CI can be produced unsigned.

---

## 3. Tauri updater signing key (must be YOURS, not debpalash's)

The fork cannot reuse the upstream signing key. Generate a new pair:

```sh
cd frontend
bun run tauri signer generate --force \
  -w ~/voicestudio-tauri.key \
  -p '<choose-a-long-password>'
```

`tauri signer generate` prints the **public key** — replace the `pubkey` in
`frontend/src-tauri/tauri.conf.json` with it:

```json
"plugins": { "updater": { "pubkey": "<base64 public key printed above>" } }
```

Then store the private key + password in Bitwarden (§1) and set the GitHub
secrets (§5). **Never commit `~/voicestudio-tauri.key`.**

---

## 4. Apple signing & notarization (skip — no Apple Developer account)

> **Skipped in this fork.** No Apple Developer account is available, so macOS
> builds are **unsigned**. That is fully supported: the release workflow skips
> cert import when the `APPLE_*` secrets are absent, and users open the app the
> first time via right-click → **Open** (or `xattr -cr VoiceStudio.app`). The
> `TAURI_SIGNING_*` updater keypair still signs the update packages, so
> in-app auto-updates work.

If you ever get an account, the pieces you'd need (see §2 for the item names):
1. **Distribution certificate**: Xcode → Settings → Accounts → your team →
   Manage Certificates → (+) Developer ID Application. Export the `.p12` from
   Keychain Access with a password.
2. **Base64-encode it** for the `APPLE_CERTIFICATE` secret:
   ```sh
   base64 -i "Developer ID Application.p12" | tr -d '\n' | pbcopy
   ```
3. **App-specific password** (for `APPLE_PASSWORD`): appleid.apple.com →
   Sign-in & Security → App-Specific Passwords.
4. **Team ID**: developer.apple.com → Membership (10 chars).
Store each in Bitwarden, then `gh secret set` (names in §2).

---

## 5. Set the GitHub Actions secrets

> **This fork is wired into your relay** (`~/orca/projects/sagwebapp/relay`):
> `ivlatenv.sh --init` seeds the Tauri keypair into the macOS Keychain from
> Bitwarden items `voicestudio-tauri-signing-key` (Secure Note) and
> `voicestudio-tauri-signing-password` (Login), and `source ./ivlatenv.sh`
> exports `VOICESTUDIO_TAURI_KEY` / `VOICESTUDIO_TAURI_PASSWORD`. The two
> `TAURI_SIGNING_*` secrets below are **already set** on this fork.

Once each value is in Bitwarden, export it into the repo's secret store:

```sh
export BW_SESSION="$(bw unlock --raw)"
KEY="$(bw get password voicestudio-tauri-signing-key --session "$BW_SESSION")"
PASS="$(bw get password voicestudio-tauri-signing-password --session "$BW_SESSION")"

gh secret set TAURI_SIGNING_PRIVATE_KEY          --repo jfcanon/VoiceStudio --body "$KEY"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo jfcanon/VoiceStudio --body "$PASS"
# ...and the APPLE_* ones from §4, same pattern
```

To enable signed stable macOS releases, also set the repo **variable**:

```sh
gh variable set MACOS_SIGNING_ENABLED --repo jfcanon/VoiceStudio --body "true"
```

Verify: `gh secret list --repo jfcanon/VoiceStudio`.

---

## 6. CI / release flow

- **CI** (`.github/workflows/ci.yml`): runs on every push/PR — backend pytest,
  frontend vitest, oxlint, typecheck, docs-drift, changelog-style. Watch it:
  `gh run watch --repo jfcanon/VoiceStudio`.
- **Release** (`.github/workflows/release.yml`): pushes to `v*` tags build
  signed DMG/MSI/deb/AppImage and publish to the GitHub Release (auto-updater
  endpoint in `tauri.conf.json` points at `jfcanon/VoiceStudio`).

Trigger a preview release once CI is green:

```sh
git tag v0.4.2-1 && git push origin v0.4.2-1
```

---

## 7. Getting started checklist

1. ✅ Fork wired (`jfcanon/VoiceStudio`), CI green.
2. ✅ Tauri keypair generated; the fork's **public key** is in `tauri.conf.json` `plugins.updater.pubkey`.
3. ✅ Private key + password stored in Bitwarden (`voicestudio-tauri-signing-key` Secure Note, `voicestudio-tauri-signing-password` Login) and seeded into the Keychain via `ivlatenv.sh --init`.
4. ✅ `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` set on GitHub.
5. ❌ Apple signing: skipped (no Apple Developer account) — macOS builds are unsigned, auto-updates still work.
6. Release: `git tag v0.4.2-1 && git push origin v0.4.2-1`.
