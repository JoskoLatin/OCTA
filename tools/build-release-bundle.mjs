// Runs the Android release bundle (AAB) through the Gradle wrapper — the
// artifact Google Play requires for upload. Mirrors tools/build-apk.mjs's
// shell-invocation approach (see that file for why); requires
// android/keystore/keystore.properties to exist (release signing config),
// otherwise Gradle produces an unsigned bundle.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = join(root, 'android');
const isWin = process.platform === 'win32';

const keystoreProps = join(androidDir, 'keystore', 'keystore.properties');
if (!existsSync(keystoreProps)) {
  console.error(
    `Missing ${keystoreProps} — the release bundle would be unsigned.\n` +
    `Generate a keystore first (see android/keystore/README.md).`
  );
  process.exit(1);
}

const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
const args = isWin
  ? ['/d', '/s', '/c', '.\\gradlew.bat bundleRelease']
  : ['-c', './gradlew bundleRelease'];

const res = spawnSync(cmd, args, { cwd: androidDir, stdio: 'inherit' });
if (res.status === 0) {
  console.log(
    '\nRelease bundle: android/app/build/outputs/bundle/release/app-release.aab'
  );
}
process.exit(res.status ?? 1);
