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

## 4. Apple signing & notarization

You need an **Apple Developer** account (paid, team enrollment) to sign and
notarize. If you don't have one, skip this and ship unsigned builds — the app
works; Gatekeeper just asks to confirm the first open (`xattr -cr` on the app).

Get the pieces:

1. **Distribution certificate**: Xcode → Settings → Accounts → your team →
   Manage Certificates → (+) Developer ID Application. It becomes a `.p12` in
   Keychain Access; export it with a password.
2. **Base64-encode it** for the `APPLE_CERTIFICATE` secret:
   ```sh
   base64 -i "Developer ID Application.p12" | tr -d '\n' | pbcopy
   ```
3. **App-specific password** (for `APPLE_PASSWORD`): appleid.apple.com →
   Sign-in & Security → App-Specific Passwords → generate one (label: `voicestudio-notarize`).
4. **Team ID**: developer.apple.com → Membership → Team ID (10 chars).

Store each value in Bitwarden (§1), then set the GitHub secrets (§5).

---

## 5. Set the GitHub Actions secrets

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

1. `export BW_SESSION="$(bw unlock --raw)"`
2. Generate the Tauri key (§3), update `tauri.conf.json` pubkey, commit + push.
3. Store key + password in Bitwarden (§1).
4. If you have an Apple Developer account, do §4 and store the values.
5. `gh secret set ...` for each (§5).
6. `gh variable set MACOS_SIGNING_ENABLED true` only if you want signed stables.
7. Watch CI turn green; then `git tag v0.4.2-1 && git push origin v0.4.2-1`.
