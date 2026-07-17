// Runs the Android debug build through the Gradle wrapper.
//
// Why a Node runner instead of `cd android && gradlew.bat` in the npm script:
// npm may run scripts under cmd.exe, sh (Git Bash), or PowerShell, and the
// wrapper path each shell accepts differs — cmd needs `android\gradlew.bat`,
// sh needs `android/gradlew.bat`, and neither form works in the other.
//
// We invoke the platform shell ourselves (cmd.exe on Windows) with an explicit
// `.\` prefix so the wrapper is found via the working directory even when
// NoDefaultCurrentDirectoryInExePath is set — which is what makes cmd otherwise
// report "'gradlew.bat' is not recognized". shell:true is deliberately NOT used,
// so Node doesn't re-quote the command and mangle the backslash.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const androidDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'android');
const isWin = process.platform === 'win32';

const cmd = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
const args = isWin
  ? ['/d', '/s', '/c', '.\\gradlew.bat assembleDebug']
  : ['-c', './gradlew assembleDebug'];

const res = spawnSync(cmd, args, { cwd: androidDir, stdio: 'inherit' });
process.exit(res.status ?? 1);
