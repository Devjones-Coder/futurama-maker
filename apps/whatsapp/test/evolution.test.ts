import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { EvolutionClient } from '../src/evolution';

async function main() {
  const app = express();
  app.use(express.json());
  const attempts: string[] = [];
  app.post('/chat/getBase64FromMediaMessage/test-instance', (req, res) => {
    const message = req.body.message;
    const kind = message.message?.videoMessage?.url ?? 'key-only';
    attempts.push(kind);
    if (kind === 'event' || (kind === 'key-only' && message.key.id === 'stored-fallback')) {
      return res.status(400).json({ error: 'Bad Request' });
    }
    res.json({ base64: Buffer.from('video-content').toString('base64') });
  });
  app.post('/chat/findMessages/test-instance', (req, res) => {
    assert.equal(req.body.where.key.id, 'stored-fallback');
    res.json({ messages: { records: [{ key: { id: 'stored-fallback', remoteJid: 'sender@s.whatsapp.net' }, message: { videoMessage: { url: 'stored' } } }] } });
  });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'futurama-media-test-'));
  try {
    const port = (server.address() as { port: number }).port;
    const client = new EvolutionClient({ id: 'test', display_name: 'Test', base_url: `http://127.0.0.1:${port}`, instance_name: 'test-instance', api_key: 'mock-key' });
    for (const id of ['key-fallback', 'stored-fallback']) {
      const destination = path.join(temp, `${id}.mp4`);
      await client.downloadIncomingMedia({ key: { id, remoteJid: 'sender@s.whatsapp.net' }, message: { videoMessage: { url: 'event' } } }, destination);
      assert.equal(await fs.readFile(destination, 'utf8'), 'video-content');
    }
    assert.deepEqual(attempts, ['event', 'key-only', 'event', 'key-only', 'stored']);
    console.log('Evolution media fallback passed.');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temp, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
