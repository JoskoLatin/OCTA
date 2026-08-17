# Publishing OCTA to Google Play — checklist

Everything technical is done and verified. What is left is filling in
Play Console forms; the copy for every text field is in `LISTING.md`.

## Build the upload artifact

```powershell
npm run release
```

Produces `android/app/build/outputs/bundle/release/app-release.aab`
(signed with the release keystore). Play requires an `.aab`, not an `.apk`.

Verified for this release:

- `versionCode 1`, `versionName "1.0"` — first release, nothing to bump yet
- `targetSdk 36` — above Play's current minimum for new apps
- `minSdk 24` — Android 7.0 and up
- Signed: Gradle ran `validateSigningRelease` and `signReleaseBundle`

## Play Console steps

1. **Create app** — name `OCTA`, package `com.vodice.octa`, default language
   English (US), App, Free. Accept both declarations.

2. **Store listing** (Grow → Store presence → Main store listing)
   Paste app name, short description, full description from `LISTING.md`.
   Upload `../icon-512.png`, `feature-graphic.png`, and the three phone
   screenshots.

3. **Store settings** — category **Music & Audio**, contact email
   `joskolatin@gmail.com`, and the privacy policy URL:
   `https://joskolatin.github.io/octa/privacy.html`

4. **App content** (Policy → App content) — work through each card:
   - Privacy policy → the URL above
   - Ads → **No ads**
   - App access → **All functionality available without restrictions**
   - Content rating → questionnaire answers in `LISTING.md`
   - Target audience → pick your age groups; OCTA is not child-directed
   - Data safety → **no data collected or shared** (see `LISTING.md`)
   - Government apps → No; Financial features → None; Health → No

5. **Create a release** — Testing → Internal testing first. Upload the
   `.aab`, add yourself as a tester, install from the opt-in link, and check
   it runs on a real phone before going further.

6. **Promote to Production** once internal testing looks right. First reviews
   commonly take a few days.

## Note on app signing

Play App Signing is on by default: Google re-signs your app with a key it
holds, and the keystore in `android/keystore/` becomes your *upload* key.
Keep it anyway — losing it means you must ask Google to reset your upload key
before you can ship another update. See `../android/keystore/README.md`.

## Shipping an update later

1. Bump `versionCode` (and usually `versionName`) in
   `android/app/build.gradle` — Play rejects a duplicate `versionCode`.
2. `npm run release`
3. Upload the new `.aab` to a release track.
