const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const unpacked = path.resolve(__dirname, '../dist/win-unpacked');
const executable = path.join(unpacked, 'Futurama Maker.exe');
const archive = path.join(unpacked, 'resources', 'app.asar');
const ffmpeg = path.join(unpacked, 'resources', 'ffmpeg.exe');
const ffprobe = path.join(unpacked, 'resources', 'ffprobe.exe');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'futurama-package-check-'));

try {
  const source = path.join(temp, 'source.mp4');
  const output = path.join(temp, 'output.mp4');
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source], { windowsHide: true, timeout: 30_000 });
  if (generated.status !== 0) throw new Error('PACKAGE_FFMPEG_SOURCE_FAILED');

  const core = path.join(archive, 'staged', 'node_modules', '@futurama', 'core');
  const sqlite = path.join(archive, 'staged', 'node_modules', 'better-sqlite3');
  const code = `
    const Database = require(${JSON.stringify(sqlite)});
    const db = new Database(':memory:'); db.close();
    const { renderVideo } = require(${JSON.stringify(core)});
    renderVideo({ inputPath: ${JSON.stringify(source)}, outputPath: ${JSON.stringify(output)}, headline: 'Teste do pacote', dataDir: ${JSON.stringify(temp)}, ffmpegPath: ${JSON.stringify(ffmpeg)}, ffprobePath: ${JSON.stringify(ffprobe)} })
      .then(result => { if (result.width !== 1080 || result.height !== 1350 || result.outputBytes < 1) throw new Error('INVALID_OUTPUT'); console.log('PACKAGE_RENDER_OK'); })
      .catch(error => { console.error(error.code || error.name || 'PACKAGE_RENDER_FAILED'); process.exitCode = 1; });
  `;
  const checked = spawnSync(executable, ['-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  if (checked.status !== 0 || !checked.stdout?.includes('PACKAGE_RENDER_OK')) {
    throw new Error(`PACKAGE_RENDER_FAILED: ${checked.stderr?.slice(-300) || checked.stdout?.slice(-300) || checked.error?.code || checked.status}`);
  }
  console.log('Packaged Electron, SQLite, Sharp and FFmpeg render passed.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
