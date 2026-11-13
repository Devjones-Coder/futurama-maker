import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { openDatabase, now } from '../src/db';
import { startServer } from '../src/server';

async function main() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'futurama-backend-'));
  const evolution = express(); evolution.use(express.json({ limit: '10mb' }));
  evolution.post('/chat/getBase64FromMediaMessage/test-instance', (req, res) => {
    if (req.body?.message?.key?.id === 'bad-download') return res.status(503).json({ error: 'mock download failure' });
    res.json({ base64: Buffer.from('source-video').toString('base64') });
  });
  evolution.post('/message/sendText/test-instance', (_req, res) => res.json({ key: { id: 'sent-text' } }));
  evolution.post('/message/sendMedia/test-instance', (_req, res) => res.json({ key: { id: 'sent-media' } }));
  const evolutionServer = await new Promise<any>((resolve) => { const server = evolution.listen(0, '127.0.0.1', () => resolve(server)); });
  const evolutionPort = evolutionServer.address().port;
  const db = openDatabase(temp);
  const template = db.prepare("SELECT id FROM templates WHERE slug='ta-rolando'").get() as { id: string };
  const instanceId = crypto.randomUUID(), phoneIds = [crypto.randomUUID(), crypto.randomUUID()], stamp = now();
  db.prepare('INSERT INTO evolution_instances(id,display_name,base_url,instance_name,api_key,default_template_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(instanceId, 'Mock', `http://127.0.0.1:${evolutionPort}`, 'test-instance', 'mock-key', template.id, 'desconhecida', stamp, stamp);
  for (let i = 0; i < phoneIds.length; i++) {
    const phone = `+551199999999${i}`;
    db.prepare('INSERT INTO authorized_numbers(id,phone_e164,display_name,active,created_at,updated_at) VALUES(?,?,?,1,?,?)').run(phoneIds[i], phone, `Pessoa ${i}`, stamp, stamp);
    db.prepare('INSERT INTO authorized_number_instances(number_id,instance_id) VALUES(?,?)').run(phoneIds[i], instanceId);
  }
  const expiredPath = path.join(temp, 'input', 'expired.source');
  const orphanPath = path.join(temp, 'input', 'orphan.source');
  await fs.mkdir(path.dirname(expiredPath), { recursive: true });
  await fs.writeFile(expiredPath, 'expired-media');
  await fs.writeFile(orphanPath, 'orphan-media');
  const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await fs.utimes(orphanPath, oldTime, oldTime);
  db.prepare('INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(crypto.randomUUID(), instanceId, '5511888888888', 'waiting_title', JSON.stringify({ mediaPath: expiredPath }), oldTime.toISOString(), stamp, stamp);
  db.close();

  let inFlight = 0, maximum = 0;
  let service: Awaited<ReturnType<typeof startServer>> | undefined = await startServer({ dataDir: temp, port: 0, controlToken: 'test-token', render: async ({ inputPath, outputPath }) => {
    inFlight++; maximum = Math.max(maximum, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await fs.mkdir(path.dirname(outputPath), { recursive: true }); await fs.writeFile(outputPath, 'rendered-video');
    inFlight--;
    return { outputPath, width: 1080, height: 1350, durationSeconds: 1, inputBytes: (await fs.stat(inputPath)).size, outputBytes: 14, inputWidth: 720, inputHeight: 1280, fps: 30 } as any;
  } });
  const message = (phone: string, id: string) => ({ event: 'messages.upsert', instance: 'test-instance', data: { key: { remoteJid: `${phone}@s.whatsapp.net`, id, fromMe: false }, message: { videoMessage: { caption: 'Manchete curta -top30 -left5 -pb', mimetype: 'video/mp4' } } } });
  const post = (body: unknown) => fetch(`${service!.url}/webhooks/evolution/${instanceId}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const control = (action: 'pause' | 'resume') => fetch(`${service!.url}/api/service/${action}`, { method: 'POST', headers: { 'x-futurama-control-token': 'test-token' } });
  try {
    const one = message('5511999999990', 'incoming-1'); const two = message('5511999999991', 'incoming-2');
    assert.equal((await control('pause')).status, 200);
    assert.equal((await post(one)).status, 202);
    assert.equal((await post(one)).status, 202, 'duplicated webhook is accepted without requeue');
    assert.equal((await post(two)).status, 202);
    await new Promise((resolve) => setTimeout(resolve, 900));
    let paused = openDatabase(temp);
    assert.equal((paused.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get() as any).n, 2, 'pause retains jobs in the queue');
    assert.equal((paused.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='delivered'").get() as any).n, 0, 'pause prevents new renders');
    paused.close();
    assert.equal((await control('resume')).status, 200);
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const check = openDatabase(temp);
      const completed = (check.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='delivered'").get() as { n: number }).n;
      check.close();
      if (completed === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await post(message('5511999999990', 'incoming-3'))).status, 202, 'same authorized phone can submit another request after delivery');
    const repeatDeadline = Date.now() + 5_000;
    while (Date.now() < repeatDeadline) {
      const check = openDatabase(temp);
      const completed = (check.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='delivered'").get() as { n: number }).n;
      check.close();
      if (completed === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const check = openDatabase(temp);
    assert.equal((check.prepare('SELECT COUNT(*) AS n FROM jobs').get() as any).n, 3);
    assert.equal((check.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='delivered'").get() as any).n, 3);
    assert.equal(maximum, 1, 'global queue runs one renderer at a time');
    check.close();
    assert.equal((await post(message('5511999999990', 'bad-download'))).status, 202);
    const failureDeadline = Date.now() + 2_000;
    let failure: any;
    while (Date.now() < failureDeadline) {
      const current = openDatabase(temp);
      failure = current.prepare("SELECT id,error_stage,error_code FROM jobs WHERE status='failed' ORDER BY created_at DESC LIMIT 1").get();
      current.close();
      if (failure) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(failure?.error_stage, 'download', 'download failures have a recorded stage');
    assert.ok(failure?.error_code);
    await service.close(); service = undefined;
    const reopened = openDatabase(temp);
    assert.equal((reopened.prepare('SELECT COUNT(*) AS n FROM jobs').get() as any).n, 4, 'jobs persist after closing and reopening SQLite');
    const finished = reopened.prepare("SELECT input_path,output_path FROM jobs WHERE status IN ('delivered','failed')").all() as Array<{ input_path: string; output_path: string }>;
    for (const job of finished) {
      await assert.rejects(fs.access(job.input_path), { code: 'ENOENT' }, 'source media is removed after completion');
      await assert.rejects(fs.access(job.output_path), { code: 'ENOENT' }, 'rendered media is removed after completion');
    }
    await assert.rejects(fs.access(expiredPath), { code: 'ENOENT' }, 'expired session media is removed');
    await assert.rejects(fs.access(orphanPath), { code: 'ENOENT' }, 'orphan media is removed');
    reopened.close();
    console.log('Backend mock integration passed: pause/resume, webhook deduplication, download diagnostics, FIFO concurrency=1, media cleanup and SQLite persistence.');
  } finally {
    if (service) await service.close();
    await new Promise<void>((resolve) => evolutionServer.close(() => resolve()));
    await fs.rm(temp, { recursive: true, force: true });
  }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
