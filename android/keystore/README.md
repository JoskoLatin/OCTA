# Release signing keystore

This folder holds the key that signs release builds. **It is deliberately
excluded from git** (`android/.gitignore` ignores `keystore/`, `*.keystore`,
`*.jks`) — the passwords sit in `keystore.properties` in plain text.

## Contents (not in git)

| File | What it is |
|---|---|
| `octa-release.keystore` | PKCS#12 keystore, RSA 2048, alias `octa`, valid ~27 years |
| `keystore.properties` | `storeFile` / `storePassword` / `keyAlias` / `keyPassword` |

`android/app/build.gradle` loads `keystore.properties` if it is present and
wires it into `signingConfigs.release`. When the file is absent — a fresh
clone, or CI — the release build still runs but produces an unsigned bundle,
and `tools/build-release-bundle.mjs` refuses to start rather than handing you
an unsigned artifact by surprise.

Note: this is a PKCS#12 keystore, which does not support a key password that
differs from the store password. Both entries in `keystore.properties` are
therefore the same string.

## Back this up

**Copy both files somewhere safe and offline** (password manager, encrypted
drive). With Play App Signing enabled this is your *upload* key: if you lose
it, you cannot ship an update until Google resets the upload key for the app.
It is not recoverable from the published app or from this repository.

## Regenerating (only if you have never published)

Once a build signed with this key is live, replacing it breaks updates —
don't. Before the first release it is harmless:

```powershell
keytool -genkeypair -v `
  -keystore android/keystore/octa-release.keystore `
  -alias octa -keyalg RSA -keysize 2048 -validity 10000 `
  -dname "CN=Your Name, O=OCTA, L=Vodice, C=HR"
```

Then write the password you chose into `keystore.properties` (same value for
`storePassword` and `keyPassword`).
