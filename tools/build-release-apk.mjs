// Runs the Android release APK through the Gradle wrapper — the artifact to
// attach to a GitHub release for sideloading. Play itself needs the AAB from
// tools/build-release-bundle.mjs; this is for people installing directly.
//
// See tools/build-apk.mjs for why the platform shell is invoked explicitly.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, copyFileSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const isWin = process.platform === 'win32';

const keystoreProps = join(androidDir, 'keystore', 'keystore.properties');
if (!existsSync(keystoreProps)) {
  console.error(
    `Missing ${keystoreProps} — the release APK would be unsigned.\n` +
    `See android/keystore/README.md.`
  );
  process.exit(1);
}

const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
const args = isWin
  ? ['/d', '/s', '/c', '.\\gradlew.bat assembleRelease']
  : ['-c', './gradlew assembleRelease'];

const res = spawnSync(cmd, args, { cwd: androidDir, stdio: 'inherit' });
if (res.status === 0) {
  const built = join(
    androidDir, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'
  );
  copyFileSync(built, join(root, 'octa-release.apk'));
  console.log('\nRelease APK: octa-release.apk');
}
process.exit(res.status ?? 1);
