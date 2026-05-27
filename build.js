const { packager } = require('@electron/packager');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

async function build() {
  console.log('Packaging FileRenamer...');

  const appPaths = await packager({
    dir: '.',
    name: 'FileRenamer',
    platform: 'win32',
    arch: 'x64',
    out: 'dist',
    overwrite: true,
    asar: true,
    executableName: 'FileRenamer',
    win32metadata: {
      'CompanyName': 'FileRenamer',
      'FileDescription': '批量文件重命名工具',
      'ProductName': 'FileRenamer',
    },
    ignore: [
      /\.git/,
      /node_modules\/\.cache/,
      /build\.js/,
      /dist/,
      /assets/,
    ],
  });

  const appDir = appPaths[0];
  const distDir = path.join(__dirname, 'dist');
  const zipName = 'FileRenamer-1.0.0-win32-x64.zip';
  const zipPath = path.join(distDir, zipName);
  const appFolderName = path.basename(appDir);

  console.log('Packaged to:', appDir);

  // Create zip archive
  console.log('Creating distribution archive...');
  try {
    const items = fs.readdirSync(appDir).map(f => `'${path.join(appDir, f)}'`).join(',');
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path ${items} -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe', shell: true, timeout: 60000 }
    );
    console.log('Distribution archive: ' + zipPath);
  } catch (e) {
    console.log('Zip creation skipped (not critical): ' + e.message);
  }

  console.log('\n===== Build Complete =====');
  console.log('App directory: ' + appDir);
  console.log('Run: "' + path.join(appDir, 'FileRenamer.exe') + '"');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
