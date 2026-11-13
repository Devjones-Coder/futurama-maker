import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createOverlay, tarolandoTemplate } from '../src/index';

async function main(): Promise<void> {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'futurama-template-'));
  try {
    const overlay = await createOverlay({ headline: 'Uma manchete muito longa para validar ajuste determinístico de tamanho e quebra em linhas que reduz o tamanho da fonte e preserva todas as palavras originais para publicação completa', dataDir, forceKeepLong: true });
    assert.ok(overlay.warning);
    assert.ok(overlay.video.height >= tarolandoTemplate.minVideoHeight);
    const { data, info } = await sharp(overlay.pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 1080);
    assert.equal(info.height, 1350);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    assert.equal(alpha(10, overlay.video.y + Math.floor(overlay.video.height / 2)), 0, 'media window should remain transparent');
    assert.equal(alpha(10, 10), 255, 'header background should be opaque');
  } finally { await rm(dataDir, { recursive: true, force: true }); }
}
void main();
