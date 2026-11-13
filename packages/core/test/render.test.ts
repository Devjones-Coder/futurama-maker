import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { calculateContain, positionContained, renderVideo } from '../src/index';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
assert.deepEqual(calculateContain(1920, 1080, { x: 0, y: 0, width: 1080, height: 980 }), { x: 0, y: 186, width: 1080, height: 608 });
const vertical = calculateContain(720, 1280, { x: 0, y: 0, width: 1080, height: 980 });
assert.deepEqual(positionContained(vertical, { x: 0, y: 0, width: 1080, height: 980 }, { vertical: { direction: 'top', percent: 100 } }).y, 0);
assert.equal(positionContained({ x: 0, y: 0, width: 1080, height: 980 }, { x: 0, y: 0, width: 1080, height: 980 }, { horizontal: { direction: 'left', percent: 100 } }).x, 0);

async function makeClip(file: string, size: string): Promise<void> {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=1.4`, '-f', 'lavfi', '-i', 'sine=frequency=600:duration=1.4', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file], { windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not create local test video: ${String(result.stderr)}`);
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'futurama-core-'));
  try {
    for (const size of ['320x180', '180x320']) {
      const inputPath = path.join(dir, `input-${size}.mp4`);
      const outputPath = path.join(dir, `output-${size}.mp4`);
      await makeClip(inputPath, size);
      const result = await renderVideo({ inputPath, outputPath, headline: 'Teste de renderização', alignment: size === '180x320' ? { horizontal: { direction: 'right', percent: 100 } } : {}, grayscale: true, dataDir: path.join(dir, 'data'), ffmpegPath: ffmpeg, ffprobePath: ffprobe });
      assert.equal(result.width, 1080);
      assert.equal(result.height, 1350);
      assert.ok(result.outputBytes > 0);
      assert.ok(result.durationSeconds > 0.9);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
void main();
