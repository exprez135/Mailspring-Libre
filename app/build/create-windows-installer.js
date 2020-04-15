/* eslint import/no-dynamic-require:0 */
/**
 * NOTE: Due to path issues, this script must be run outside of grunt
 * directly from a powershell command.
 */
const path = require('path');
const {
  createWindowsInstaller
} = require('electron-winstaller');

const appDir = path.join(__dirname, '..');
const {
  version
} = require(path.join(appDir, 'package.json'));

const config = {
  usePackageJson: false,
  outputDirectory: path.join(appDir, 'dist'),
  appDirectory: path.join(appDir, 'dist', 'mailspring-win32-ia32'),
  loadingGif: path.join(appDir, 'build', 'resources', 'win', 'loading.gif'),
  iconUrl: 'http://mailspring-builds.s3.amazonaws.com/assets/mailspring.ico',
  description: 'Mailspring',
  version: version,
  title: 'Mailspring',
  authors: 'Foundry 376, LLC',
  setupIcon: path.join(appDir, 'build', 'resources', 'win', 'mailspring.ico'),
  setupExe: 'MailspringSetup.exe',
  exe: 'mailspring.exe',
  name: 'Mailspring',
};

console.log(config);
console.log('---> Starting');

createWindowsInstaller(config)
  .then(() => {
    console.log('createWindowsInstaller succeeded.');
    process.exit(0);
  })
  .catch(e => {
    console.error(`createWindowsInstaller failed: ${e.message}`);
    process.exit(1);
  });

console.log('Starting zip creation for windows exe.');

const done = this.async();
const zipPath = path.join(grunt.config('outputDir'), 'Mailspring.zip');

if (grunt.file.exists(zipPath)) {
  grunt.file.delete(zipPath, {
    force: true
  });
}

const orig = process.cwd();
process.chdir(path.join(grunt.config('outputDir'), 'mailspring-win32-ia32'));

spawn({
  cmd: 'zip',
  args: ['-9', '-y', '-r', '-9', '-X', zipPath, 'MailspringSetup.exe'],
},
error => {
  process.chdir(orig);

  if (error) {
    done(error);
    return;
  }

  grunt.log.writeln(`>> Created ${zipPath}`);
  done(null);
}
);
});
};

console.log('End zip process for windows.');
