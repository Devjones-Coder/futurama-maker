import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppDatabase, addEvent, getSetting, now, setSetting } from './db';
import { EvolutionClient, EvolutionInstance, normalizeMessage } from './evolution';
import { Runtime } from './runtime';

type AppOptions = { db: AppDatabase; runtime: Runtime; dataDir: string; controlToken?: string; staticDir?: string; getPort: () => number };
const sanitizeInstance = (row: any) => ({ ...row, api_key: row.api_key ? '••••••••' : '' });
const maskPhone = (number: string) => number.length < 7 ? number : `${number.slice(0, 4)}••••${number.slice(-3)}`;
const safePhone = (value: string) => value.replace(/\D/g, '');

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '3mb' }));
  const sessions = new Map<string, { expires: number }>();
  const settings = getSetting(options.db, 'settings', {
    maxVideoBytes: 500 * 1024 * 1024, maxVideoSeconds: 300, retentionDays: 7,
    ffmpegPreset: 'veryfast', ffmpegCrf: 21, maxLogDays: 30,
  });
  const adminHash = () => getSetting(options.db, 'admin', { username: process.env.FUTURAMA_ADMIN_USER ?? 'admin', salt: '', hash: '' });
  if (!adminHash().salt) {
    const salt = crypto.randomBytes(16).toString('hex');
    const password = process.env.FUTURAMA_ADMIN_PASSWORD ?? '123456';
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    setSetting(options.db, 'admin', { username: process.env.FUTURAMA_ADMIN_USER ?? 'admin', salt, hash });
  }

  const isControlAllowed = (req: Request) => Boolean(options.controlToken && req.get('x-futurama-control-token') === options.controlToken);
  const isLoggedIn = (req: Request) => {
    if (isControlAllowed(req)) return true;
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('fm_session='))?.slice('fm_session='.length);
    const entry = cookie ? sessions.get(cookie) : undefined;
    if (!entry || entry.expires < Date.now()) { if (cookie) sessions.delete(cookie); return false; }
    return true;
  };
  const auth = (req: Request, res: Response, next: NextFunction) => {
    if (isLoggedIn(req)) return next();
    res.status(401).json({ error: 'AUTH_REQUIRED', message: 'Entre para acessar o painel.' });
  };

  app.get('/health', (_req, res) => {
    let sqlite = 'ok';
    try { options.db.prepare('SELECT 1').get(); } catch { sqlite = 'erro'; }
    const checkBinary = (binary: string, arg: string) => {
      try { return spawnSync(binary, [arg], { encoding: 'utf8', timeout: 5000, windowsHide: true }).status === 0 ? 'ok' : 'erro'; }
      catch { return 'erro'; }
    };
    const ffmpeg = checkBinary(process.env.FUTURAMA_FFMPEG ?? process.env.FFMPEG_PATH ?? 'ffmpeg', '-version');
    const ffprobe = checkBinary(process.env.FUTURAMA_FFPROBE ?? process.env.FFPROBE_PATH ?? 'ffprobe', '-version');
    res.json({ status: sqlite === 'ok' && ffmpeg === 'ok' && ffprobe === 'ok' ? 'ok' : 'erro', sqlite, ffmpeg, ffprobe, uptimeSeconds: Math.round(process.uptime()), port: options.getPort() });
  });

  app.post('/api/login', (req, res) => {
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');
    const current = adminHash();
    const candidate = crypto.scryptSync(password, current.salt, 64);
    const stored = Buffer.from(current.hash, 'hex');
    if (username !== current.username || candidate.length !== stored.length || !crypto.timingSafeEqual(candidate, stored)) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Usuário ou senha incorretos.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { expires: Date.now() + 12 * 60 * 60 * 1000 });
    res.cookie('fm_session', token, { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 12 * 60 * 60 * 1000 });
    res.json({ ok: true });
  });
  app.post('/api/logout', (req, res) => {
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('fm_session='))?.slice('fm_session='.length);
    if (cookie) sessions.delete(cookie);
    res.clearCookie('fm_session', { path: '/' }); res.json({ ok: true });
  });

  app.get('/api/status', (req, res) => {
    if (!isControlAllowed(req) && !isLoggedIn(req)) return res.status(401).json({ error: 'CONTROL_TOKEN_REQUIRED' });
    res.json({ status: options.runtime.isPaused() ? 'Pausado' : 'Em execução', port: options.getPort(), dashboardUrl: `http://127.0.0.1:${options.getPort()}`, queueCount: options.runtime.queueCount(), currentJob: options.runtime.currentJob(), paused: options.runtime.isPaused() });
  });
  app.post('/api/service/pause', (req, res) => { if (!isControlAllowed(req)) return res.status(401).json({ error: 'CONTROL_TOKEN_REQUIRED' }); options.runtime.pause(); res.json({ ok: true, paused: true }); });
  app.post('/api/service/resume', (req, res) => { if (!isControlAllowed(req)) return res.status(401).json({ error: 'CONTROL_TOKEN_REQUIRED' }); options.runtime.resume(); res.json({ ok: true, paused: false }); });

  app.use('/api', auth);
  app.get('/api/status', (_req, res) => res.json({ status: options.runtime.isPaused() ? 'Pausado' : 'Em execução', port: options.getPort(), dashboardUrl: `http://127.0.0.1:${options.getPort()}`, queueCount: options.runtime.queueCount(), currentJob: options.runtime.currentJob(), paused: options.runtime.isPaused() }));
  app.get('/api/metrics', async (_req, res) => {
    const counts = options.db.prepare("SELECT status,COUNT(*) AS count FROM jobs GROUP BY status").all();
    const latestError = options.db.prepare("SELECT id,error_stage,error_code,finished_at FROM jobs WHERE status='failed' ORDER BY finished_at DESC LIMIT 1").get();
    const rss = process.memoryUsage().rss;
    let fileBytes = 0;
    const walk = async (dir: string): Promise<void> => { for (const item of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [] as any)) { const child = path.join(dir, item.name); if (item.isDirectory()) await walk(child); else fileBytes += (await fs.promises.stat(child).catch(() => ({ size: 0 }))).size; } };
    await walk(options.dataDir);
    const cpu = process.cpuUsage();
    const ffmpegPath = process.env.FUTURAMA_FFMPEG;
    const ffprobePath = process.env.FUTURAMA_FFPROBE;
    res.json({ jobs: counts, queueCount: options.runtime.queueCount(), currentJob: options.runtime.currentJob(), ffmpegAvailable: Boolean(ffmpegPath && fs.existsSync(ffmpegPath) && ffprobePath && fs.existsSync(ffprobePath)), process: { cpuUserMs: Math.round(cpu.user / 1000), cpuSystemMs: Math.round(cpu.system / 1000), memoryBytes: rss }, host: { totalMemoryBytes: require('node:os').totalmem(), freeMemoryBytes: require('node:os').freemem(), diskBytesUsed: fileBytes }, latestError });
  });

  app.get('/api/instances', (_req, res) => res.json(options.db.prepare('SELECT * FROM evolution_instances ORDER BY display_name').all().map(sanitizeInstance)));
  app.post('/api/instances', (req, res) => {
    const body = req.body ?? {};
    if (!body.display_name || !body.base_url || !body.instance_name || !body.api_key) return res.status(400).json({ error: 'CAMPOS_OBRIGATORIOS' });
    const id = crypto.randomUUID(), stamp = now();
    options.db.prepare('INSERT INTO evolution_instances(id,display_name,base_url,instance_name,api_key,default_template_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?, ?,?)')
      .run(id, String(body.display_name).slice(0, 120), String(body.base_url).replace(/\/+$/, ''), String(body.instance_name), String(body.api_key), body.default_template_id || null, 'desconhecida', stamp, stamp);
    options.runtime.refreshListeners();
    res.status(201).json(sanitizeInstance(options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(id)));
  });
  app.put('/api/instances/:id', (req, res) => {
    const old = options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(req.params.id) as any;
    if (!old) return res.status(404).json({ error: 'INSTANCIA_NAO_ENCONTRADA' });
    const body = req.body ?? {};
    options.db.prepare('UPDATE evolution_instances SET display_name=?,base_url=?,instance_name=?,api_key=?,default_template_id=?,updated_at=? WHERE id=?')
      .run(String(body.display_name ?? old.display_name), String(body.base_url ?? old.base_url).replace(/\/+$/, ''), String(body.instance_name ?? old.instance_name), String(body.api_key ?? old.api_key), body.default_template_id ?? old.default_template_id ?? null, now(), old.id);
    options.runtime.refreshListeners();
    res.json(sanitizeInstance(options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(old.id)));
  });
  app.post('/api/instances/:id/connect', async (req, res) => {
    const row = options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(req.params.id) as EvolutionInstance | undefined;
    if (!row) return res.status(404).json({ error: 'INSTANCIA_NAO_ENCONTRADA' });
    try { const qr = await new EvolutionClient(row).connect(); options.db.prepare('UPDATE evolution_instances SET status=?,updated_at=? WHERE id=?').run('conectando', now(), row.id); res.json(qr); }
    catch (error) { res.status(502).json({ error: 'EVOLUTION_CONNECT_FAILED', message: String(error).slice(0, 300) }); }
  });
  app.post('/api/instances/:id/disconnect', async (req, res) => {
    const row = options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(req.params.id) as EvolutionInstance | undefined;
    if (!row) return res.status(404).json({ error: 'INSTANCIA_NAO_ENCONTRADA' });
    try { await new EvolutionClient(row).disconnect(); options.db.prepare('UPDATE evolution_instances SET status=?,updated_at=? WHERE id=?').run('desconectada', now(), row.id); res.json({ ok: true }); }
    catch (error) { res.status(502).json({ error: 'EVOLUTION_DISCONNECT_FAILED', message: String(error).slice(0, 300) }); }
  });
  app.get('/api/instances/:id/qr', async (req, res) => {
    const row = options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(req.params.id) as EvolutionInstance | undefined;
    if (!row) return res.status(404).json({ error: 'INSTANCIA_NAO_ENCONTRADA' });
    try { res.json(await new EvolutionClient(row).getConnectionQr()); }
    catch (error) { res.status(502).json({ error: 'EVOLUTION_QR_FAILED', message: String(error).slice(0, 300) }); }
  });

  app.get('/api/authorized-numbers', (_req, res) => {
    const rows = options.db.prepare(`SELECT n.*, GROUP_CONCAT(ni.instance_id) AS instance_ids FROM authorized_numbers n LEFT JOIN authorized_number_instances ni ON ni.number_id=n.id GROUP BY n.id ORDER BY n.display_name`).all() as any[];
    res.json(rows.map((row) => ({ ...row, instance_ids: row.instance_ids ? row.instance_ids.split(',') : [] })));
  });
  app.post('/api/authorized-numbers', (req, res) => {
    const body = req.body ?? {}, phone = `+${safePhone(String(body.phone_e164 ?? body.phone ?? ''))}`;
    if (phone.length < 9 || !body.display_name) return res.status(400).json({ error: 'TELEFONE_OU_NOME_INVALIDO' });
    const id = crypto.randomUUID(), stamp = now();
    try {
      options.db.prepare('INSERT INTO authorized_numbers(id,phone_e164,display_name,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, phone, String(body.display_name), body.active === false ? 0 : 1, stamp, stamp);
      for (const instanceId of Array.isArray(body.instance_ids) ? body.instance_ids : []) options.db.prepare('INSERT OR IGNORE INTO authorized_number_instances(number_id,instance_id) VALUES(?,?)').run(id, String(instanceId));
    } catch (error) { return res.status(400).json({ error: 'TELEFONE_DUPLICADO_OU_INSTANCIA_INVALIDA', detail: String(error).slice(0, 200) }); }
    res.status(201).json({ id, phone_e164: phone, display_name: body.display_name, active: body.active !== false, instance_ids: body.instance_ids ?? [] });
  });
  app.put('/api/authorized-numbers/:id', (req, res) => {
    const old = options.db.prepare('SELECT * FROM authorized_numbers WHERE id=?').get(req.params.id) as any;
    if (!old) return res.status(404).json({ error: 'TELEFONE_NAO_ENCONTRADO' });
    const body = req.body ?? {}, phone = body.phone_e164 || body.phone ? `+${safePhone(String(body.phone_e164 ?? body.phone))}` : old.phone_e164;
    options.db.transaction(() => {
      options.db.prepare('UPDATE authorized_numbers SET phone_e164=?,display_name=?,active=?,updated_at=? WHERE id=?').run(phone, String(body.display_name ?? old.display_name), body.active === undefined ? old.active : body.active ? 1 : 0, now(), old.id);
      if (Array.isArray(body.instance_ids)) { options.db.prepare('DELETE FROM authorized_number_instances WHERE number_id=?').run(old.id); for (const id of body.instance_ids) options.db.prepare('INSERT INTO authorized_number_instances(number_id,instance_id) VALUES(?,?)').run(old.id, String(id)); }
    })();
    res.json({ id: old.id, phone_e164: phone, display_name: body.display_name ?? old.display_name, active: body.active ?? Boolean(old.active), instance_ids: body.instance_ids ?? [] });
  });

  app.get('/api/templates', (_req, res) => res.json((options.db.prepare('SELECT * FROM templates ORDER BY name').all() as any[]).map((row) => ({ ...row, config: JSON.parse(row.config_json), config_json: undefined, active: Boolean(row.active) }))));
  app.post('/api/templates', (req, res) => {
    const body = req.body ?? {};
    if (!body.name || !body.slug || !body.config) return res.status(400).json({ error: 'CAMPOS_OBRIGATORIOS' });
    const id = crypto.randomUUID(), stamp = now();
    try { options.db.prepare('INSERT INTO templates(id,name,slug,config_json,logo_path,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id, String(body.name), String(body.slug), JSON.stringify(body.config), body.logo_path ?? null, body.active === false ? 0 : 1, stamp, stamp); }
    catch (error) { return res.status(400).json({ error: 'TEMPLATE_INVALIDO', detail: String(error).slice(0, 200) }); }
    res.status(201).json(options.db.prepare('SELECT * FROM templates WHERE id=?').get(id));
  });
  app.put('/api/templates/:id', (req, res) => {
    const old = options.db.prepare('SELECT * FROM templates WHERE id=?').get(req.params.id) as any;
    if (!old) return res.status(404).json({ error: 'TEMPLATE_NAO_ENCONTRADO' });
    const body = req.body ?? {};
    options.db.prepare('UPDATE templates SET name=?,slug=?,config_json=?,logo_path=?,active=?,updated_at=? WHERE id=?').run(String(body.name ?? old.name), String(body.slug ?? old.slug), JSON.stringify(body.config ?? JSON.parse(old.config_json)), body.logo_path ?? old.logo_path, body.active === undefined ? old.active : body.active ? 1 : 0, now(), old.id);
    res.json(options.db.prepare('SELECT * FROM templates WHERE id=?').get(old.id));
  });

  app.get('/api/jobs', (req, res) => {
    const where: string[] = []; const params: unknown[] = [];
    for (const [key, column] of [['status','j.status'],['instance_id','j.instance_id'],['phone','j.phone_e164']] as const) { const value = req.query[key]; if (value) { where.push(`${column}=?`); params.push(String(value)); } }
    if (req.query.from) { where.push('j.created_at>=?'); params.push(String(req.query.from)); }
    if (req.query.to) { where.push('j.created_at<=?'); params.push(String(req.query.to)); }
    const sql = `SELECT j.*,i.display_name AS instance_name,t.name AS template_name FROM jobs j LEFT JOIN evolution_instances i ON i.id=j.instance_id LEFT JOIN templates t ON t.id=j.template_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY j.created_at DESC LIMIT 500`;
    res.json(options.db.prepare(sql).all(...params));
  });
  app.get('/api/jobs/:id', (req, res) => {
    const row = options.db.prepare(`SELECT j.*,i.display_name AS instance_name,t.name AS template_name FROM jobs j LEFT JOIN evolution_instances i ON i.id=j.instance_id LEFT JOIN templates t ON t.id=j.template_id WHERE j.id=?`).get(req.params.id) as any;
    if (!row) return res.status(404).json({ error: 'JOB_NAO_ENCONTRADO' });
    res.json({ ...row, config_json: JSON.parse(row.config_json) });
  });
  app.get('/api/jobs/:id/events', (req, res) => res.json(options.db.prepare('SELECT * FROM job_events WHERE job_id=? ORDER BY id').all(req.params.id).map((x: any) => ({ ...x, meta_json: x.meta_json ? JSON.parse(x.meta_json) : null }))));

  app.get('/api/settings', (_req, res) => res.json({ ...getSetting(options.db, 'settings', settings), adminUsername: adminHash().username, adminPasswordSet: Boolean(adminHash().hash) }));
  app.put('/api/settings', (req, res) => {
    const body = req.body ?? {};
    const next = { ...getSetting(options.db, 'settings', settings), ...Object.fromEntries(['maxVideoBytes','maxVideoSeconds','retentionDays','ffmpegPreset','ffmpegCrf','maxLogDays'].filter((key) => body[key] !== undefined).map((key) => [key, body[key]])) };
    setSetting(options.db, 'settings', next);
    if (body.adminUsername || body.adminPassword) {
      const current = adminHash();
      const salt = crypto.randomBytes(16).toString('hex');
      const password = String(body.adminPassword || '');
      const hash = password ? crypto.scryptSync(password, salt, 64).toString('hex') : current.hash;
      setSetting(options.db, 'admin', { username: String(body.adminUsername ?? current.username), salt: password ? salt : current.salt, hash });
    }
    res.json({ ...next, adminUsername: adminHash().username, adminPasswordSet: Boolean(adminHash().hash) });
  });

  app.post('/webhooks/evolution/:instanceId', async (req, res) => {
    const row = options.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(req.params.instanceId) as EvolutionInstance | undefined;
    if (!row) return res.status(404).json({ error: 'INSTANCIA_NAO_ENCONTRADA' });
    const msg = normalizeMessage(req.body);
    if (!msg) return res.status(202).json({ accepted: true, ignored: true });
    // Only a small technical marker is recorded; the normalized event is passed directly into the shared handler.
    const client = new EvolutionClient(row);
    await options.runtime.handleInbound(row, client, req.body);
    res.status(202).json({ accepted: true, messageId: msg.messageId });
  });

  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: 'ERRO_INTERNO', message: String(error?.message ?? 'erro').slice(0, 180) });
  });
  if (options.staticDir && fs.existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  } else {
    app.get('/', (_req, res) => res.type('html').send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Futurama Maker</title><body><main><h1>Futurama Maker</h1><p>Interface do painel indisponível nesta distribuição.</p></main></body></html>'));
  }
  return app;
}
