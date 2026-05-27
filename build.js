const { execSync } = require('child_process');

console.log('Building FileRenamer with electron-builder...');
try {
  execSync('npx electron-builder --win portable --x64', {
    stdio: 'inherit',
    cwd: __dirname,
  });
  console.log('\nBuild complete! Check dist/ for FileRenamer-*.exe');
} catch (e) {
  console.error('Build failed:', e.message);
  process.exit(1);
}
