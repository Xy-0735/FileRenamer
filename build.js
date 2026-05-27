const { packager } = require('@electron/packager');
const path = require('path');
const { execSync } = require('child_process');
const fs = require('fs');

async function build() {
  const distDir = path.join(__dirname, 'dist');
  const zipName = 'FileRenamer-1.0.0-win32-x64.zip';
  const zipPath = path.join(distDir, zipName);

  console.log('Packaging FileRenamer...');
  const appPaths = await packager({
    dir: '.',
    name: 'FileRenamer',
    platform: 'win32',
    arch: 'x64',
    out: 'dist',
    overwrite: true,
    asar: false,
    executableName: 'FileRenamer',
    win32metadata: {
      CompanyName: 'FileRenamer',
      FileDescription: '批量文件重命名工具',
      ProductName: 'FileRenamer',
    },
    ignore: [/\.git/, /node_modules\/\.cache/, /build\.js/, /dist/, /assets/, /test-files/],
  });

  const appDir = appPaths[0];
  console.log('Packaged to:', appDir);

  console.log('Creating zip...');
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path '${appDir}' -DestinationPath '${zipPath}' -Force"`,
    { stdio: 'inherit', shell: true, timeout: 120000 }
  );

  console.log('\n===== Build Complete =====');
  console.log('Zip:    ' + zipPath);
  console.log('Exe:    ' + path.join(appDir, 'FileRenamer.exe'));
  console.log('Size:   ' + (fs.statSync(zipPath).size / 1024 / 1024).toFixed(1) + ' MB');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
