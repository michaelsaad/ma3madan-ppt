// npm test: runs the app against test/test.pptx in a throwaway profile (see test/selftest.js).
// MP_LANG=ar checks Arabic.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma3madan-ppt-test-'));
const electron = require('electron');
const r = spawnSync(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: { ...process.env, MP_SELFTEST: '1', MP_SELFTEST_DIR: dir, ...(process.argv.includes('--remote') ? { MP_REMOTE_HOST: '1' } : {}) },
  timeout: process.argv.includes('--remote') ? 0 : 180000,
});
fs.rmSync(dir, { recursive: true, force: true });
process.exit(r.status ?? 1);
