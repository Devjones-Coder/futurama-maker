import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppDatabase, addEvent, now, getSetting, setSetting } from './db';
import { EvolutionClient, EvolutionInstance, normalizeMessage } from './evolution';
import { JobRecord, RenderProcessor } from './types';

type RuntimeOptions = { db: AppDatabase; dataDir: string; render: RenderProcessor; onStatus?: (status: string) => void };
const safePhone = (value: string) => value.replace(/\D/g, '');
const shortCode = () => crypto.randomBytes(3).toString('hex').toUpperCase();

export class Runtime {
  private paused = false;
  private stopping = false;
  private working = false;
  private instanceListeners = new Map<string, () => void>();
  private timer: NodeJS.Timeout;
  private cleanupTimer: NodeJS.Timeout;
  private statusTimer: NodeJS.Timeout;
  private statusPollRunning = false;
  private readonly db: AppDatabase;

  constructor(private readonly options: RuntimeOptions) {
    this.db = options.db;
    this.paused = getSetting(this.db, 'service.paused', false);
    // A process crash between rendering and delivery must never silently resend a finished file.
    const stale = this.db.prepare("SELECT id, session_id, status FROM jobs WHERE status IN ('downloading','rendering','sending')").all() as Array<{ id: string; session_id: string | null; status: string }>;
    for (const job of stale) {
      this.db.prepare("UPDATE jobs SET status='failed', error_stage=?, error_code='INTERRUPTED_RESTART', finished_at=?, updated_at=? WHERE id=?")
        .run(job.status, now(), now(), job.id);
      if (job.session_id) this.db.prepare("UPDATE sessions SET state='failed',updated_at=? WHERE id=?").run(now(), job.session_id);
      addEvent(this.db, job.id, job.status, 'error', 'Processamento interrompido antes de concluir; não foi reenviado automaticamente.', { code: 'INTERRUPTED_RESTART' });
    }
    this.db.prepare("UPDATE sessions SET state='expired', updated_at=? WHERE expires_at < ? AND state NOT IN ('delivered','failed','cancelled','expired')").run(now(), now());
    this.refreshListeners();
    this.timer = setInterval(() => void this.pump(), 700);
    this.timer.unref();
    this.statusTimer = setInterval(() => void this.refreshInstanceStatuses(), 10_000);
    this.statusTimer.unref();
    void this.cleanupOldMedia();
    this.cleanupTimer = setInterval(() => void this.cleanupOldMedia(), 24 * 60 * 60 * 1000);
    this.cleanupTimer.unref();
    void this.pump();
  }

  async close() {
    this.stopping = true;
    clearInterval(this.timer);
    clearInterval(this.cleanupTimer);
    clearInterval(this.statusTimer);
    for (const stop of this.instanceListeners.values()) stop();
    this.instanceListeners.clear();
    while (this.working) await new Promise((resolve) => setTimeout(resolve, 200));
  }

  isPaused() { return this.paused; }
  pause() { this.paused = true; setSetting(this.db, 'service.paused', true); this.options.onStatus?.('Pausado'); }
  resume() { this.paused = false; setSetting(this.db, 'service.paused', false); this.options.onStatus?.('Em execução'); void this.pump(); }

  currentJob() {
    return this.db.prepare("SELECT id,status FROM jobs WHERE status IN ('downloading','rendering','sending') ORDER BY started_at LIMIT 1").get() as { id: string; status: string } | undefined ?? null;
  }
  queueCount() { return (this.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status='queued'").get() as { n: number }).n; }

  private async cleanupOldMedia() {
    const retentionDays = Number(getSetting(this.db, 'settings', { retentionDays: 7 }).retentionDays ?? 7);
    const cutoff = new Date(Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000).toISOString();
    const oldJobs = this.db.prepare("SELECT id,input_path,output_path FROM jobs WHERE status IN ('delivered','failed','cancelled','expired') AND finished_at IS NOT NULL AND finished_at<?").all(cutoff) as Array<{ id: string; input_path: string; output_path: string }>;
    for (const job of oldJobs) {
      await fs.rm(job.input_path, { force: true }).catch(() => {});
      await fs.rm(job.output_path, { force: true }).catch(() => {});
    }
    if (oldJobs.length) console.info(`[retenção] mídias antigas removidas: ${oldJobs.length} job(s)`);
  }

  refreshListeners() {
    const active = this.db.prepare('SELECT * FROM evolution_instances').all() as EvolutionInstance[];
    const ids = new Set(active.map((x) => x.id));
    for (const [id, stop] of this.instanceListeners) if (!ids.has(id)) { stop(); this.instanceListeners.delete(id); }
    for (const instance of active) {
      const previous = this.instanceListeners.get(instance.id);
      previous?.();
      const client = new EvolutionClient(instance);
      this.instanceListeners.set(instance.id, client.listen((event) => {
        void this.handleInbound(instance, client, event).catch((error) => console.warn(`[evolution] evento recebido; falha no processamento: ${String(error?.message ?? error).slice(0, 200)}`));
      }, (status) => {
        this.db.prepare('UPDATE evolution_instances SET status=?,updated_at=? WHERE id=?').run(status, now(), instance.id);
      }));
      void client.getStatus().then((status) => this.db.prepare('UPDATE evolution_instances SET status=?,updated_at=? WHERE id=?').run(status, now(), instance.id));
    }
  }

  private async refreshInstanceStatuses() {
    if (this.stopping || this.statusPollRunning) return;
    this.statusPollRunning = true;
    try {
      const instances = this.db.prepare('SELECT * FROM evolution_instances').all() as EvolutionInstance[];
      await Promise.all(instances.map(async (instance) => {
        const status = await new EvolutionClient(instance).getStatus();
        if (!this.stopping) this.db.prepare('UPDATE evolution_instances SET status=?,updated_at=? WHERE id=?').run(status, now(), instance.id);
      }));
    } finally {
      this.statusPollRunning = false;
    }
  }

  async handleInbound(instance: EvolutionInstance, client: EvolutionClient, event: any) {
    const message = normalizeMessage(event);
    if (!message || !message.messageId || message.fromMe || message.isGroup || message.isStatus) return;
    const inserted = this.db.prepare('INSERT OR IGNORE INTO inbound_messages(instance_id,provider_message_id,received_at) VALUES(?,?,?)').run(instance.id, message.messageId, now());
    if (!inserted.changes) return;
    const number = this.db.prepare(`SELECT n.* FROM authorized_numbers n JOIN authorized_number_instances ni ON ni.number_id=n.id WHERE ni.instance_id=? AND n.active=1 AND REPLACE(REPLACE(REPLACE(n.phone_e164,'+',''),' ',''),'-','')=?`).get(instance.id, message.phone);
    if (!number) return;
    const template = this.db.prepare('SELECT * FROM templates WHERE id=? AND active=1').get((this.db.prepare('SELECT default_template_id FROM evolution_instances WHERE id=?').get(instance.id) as any)?.default_template_id) as any;
    if (!template) { await client.sendText(message.phone, 'Esta instância ainda não tem um template padrão configurado.'); return; }

    const active = this.db.prepare("SELECT * FROM sessions WHERE instance_id=? AND phone_e164=? AND state NOT IN ('delivered','failed','cancelled','expired')").get(instance.id, message.phone) as any;
    if (message.hasVideo) {
      if (active) { await client.sendText(message.phone, 'Já há uma solicitação em andamento nesta conversa. Aguarde a conclusão antes de enviar outro vídeo.'); return; }
      const id = crypto.randomUUID();
      const mediaPath = path.join(this.options.dataDir, 'input', instance.id, `${id}.source`);
      try {
        const limits = getSetting(this.db, 'settings', { maxVideoBytes: 500 * 1024 * 1024 });
        await client.downloadIncomingMedia(message.raw, mediaPath, limits.maxVideoBytes);
        if (message.text) await this.createJob(instance, template, message.phone, mediaPath, message.text, message.messageId, null, client);
        else {
          const stamp = now();
          this.db.prepare(`INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(instance_id,phone_e164) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
            .run(id, instance.id, message.phone, 'waiting_title', JSON.stringify({ mediaPath, messageId: message.messageId, templateId: template.id }), new Date(Date.now() + 60 * 60 * 1000).toISOString(), stamp, stamp);
          await client.sendText(message.phone, 'Recebi o vídeo. Envie a manchete para continuar.');
        }
      } catch (error) {
        await fs.rm(mediaPath, { force: true }).catch(() => {});
        const technical = error instanceof Error ? error.message : String(error);
        const code = technical.match(/^[A-Z][A-Z0-9_]{2,}/)?.[0] ?? 'DOWNLOAD_FAILED';
        const supportCode = shortCode();
        const stamp = now();
        const jobId = crypto.randomUUID();
        const outputPath = path.join(this.options.dataDir, 'output', `${jobId}.mp4`);
        const sessionId = crypto.randomUUID();
        this.db.prepare(`INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(instance_id,phone_e164) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
          .run(sessionId, instance.id, message.phone, 'failed', '{}', stamp, stamp, stamp);
        const existing = this.db.prepare('SELECT id FROM sessions WHERE instance_id=? AND phone_e164=?').get(instance.id, message.phone) as { id: string };
        this.db.prepare(`INSERT INTO jobs(id,session_id,instance_id,template_id,phone_e164,input_path,output_path,title_original,title_final,flags_raw,config_json,status,error_stage,error_code,error_message,message_id,created_at,finished_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,'failed','download',?,?,?,?,?,?)`)
          .run(jobId, existing.id, instance.id, template.id, message.phone, mediaPath, outputPath, '', '', '', template.config_json, code, technical.slice(0, 400), message.messageId, stamp, stamp, stamp);
        addEvent(this.db, jobId, 'download', 'error', 'Não foi possível baixar o vídeo recebido.', { code, atendimento: supportCode });
        await client.sendText(message.phone, `Não consegui baixar o vídeo. Etapa: download. Código: ${code}. Atendimento: ${supportCode}.`).catch(() => {});
      }
      return;
    }

    if (!active || active.state !== 'waiting_title' && active.state !== 'waiting_title_choice') return;
    const payload = JSON.parse(active.payload_json);
    let title = active.state === 'waiting_title' && payload.flagsRaw ? `${message.text} ${payload.flagsRaw}` : message.text;
    if (active.state === 'waiting_title_choice') {
      if (/^manter$/i.test(title.trim())) { title = payload.title; payload.keepLong = true; }
      else payload.flagsRaw = '';
    }
    await this.createJob(instance, template, message.phone, payload.mediaPath, title, message.messageId, active.id, client, payload);
  }

  private async createJob(instance: EvolutionInstance, template: any, phone: string, mediaPath: string, rawTitle: string, messageId: string, sessionId: string | null, client: EvolutionClient, oldPayload?: any) {
    const parsed = parseCommand(rawTitle);
    if (parsed.error) { await client.sendText(phone, 'Comando inválido. Use, por exemplo: Manchete -top30 -left50 -pb.'); return; }
    if (!parsed.headline) {
      const stamp = now();
      const payload = JSON.stringify({ mediaPath, messageId, templateId: template.id, flagsRaw: parsed.flagsRaw });
      if (sessionId) this.db.prepare("UPDATE sessions SET state='waiting_title',payload_json=?,expires_at=?,updated_at=? WHERE id=?")
        .run(payload, new Date(Date.now() + 60 * 60 * 1000).toISOString(), stamp, sessionId);
      else this.db.prepare(`INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(instance_id,phone_e164) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
        .run(crypto.randomUUID(), instance.id, phone, 'waiting_title', payload, new Date(Date.now() + 60 * 60 * 1000).toISOString(), stamp, stamp);
      await client.sendText(phone, 'Recebi o vídeo. Envie a manchete para continuar.');
      return;
    }
    const config = JSON.parse(template.config_json);
    let needsConfirmation = false;
    try { needsConfirmation = require('@futurama/templates').headlineNeedsConfirmation(parsed.headline, config); } catch {}
    if ((needsConfirmation || parsed.headline.trim().split(/\s+/).filter(Boolean).length > Number(config.maxWords ?? 18)) && !oldPayload?.keepLong) {
      if (sessionId) this.db.prepare("UPDATE sessions SET state='waiting_title_choice',payload_json=?,updated_at=? WHERE id=?").run(JSON.stringify({ ...oldPayload, title: rawTitle, mediaPath }), now(), sessionId);
      else {
        const id = crypto.randomUUID(), stamp = now();
        this.db.prepare(`INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
          ON CONFLICT(instance_id,phone_e164) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
          .run(id, instance.id, phone, 'waiting_title_choice', JSON.stringify({ title: rawTitle, mediaPath, templateId: template.id, keepLong: false }), new Date(Date.now() + 60 * 60 * 1000).toISOString(), stamp, stamp);
      }
      await client.sendText(phone, 'Este título está muito grande. Envie um novo título ou responda MANTER para usar o original.');
      return;
    }
    const id = crypto.randomUUID(), stamp = now(), outputPath = path.join(this.options.dataDir, 'output', `${id}.mp4`);
    const existingSession = sessionId ? undefined : this.db.prepare('SELECT id FROM sessions WHERE instance_id=? AND phone_e164=?').get(instance.id, phone) as { id: string } | undefined;
    const linkedSession = sessionId ?? existingSession?.id ?? crypto.randomUUID();
    if (!sessionId) {
      this.db.prepare(`INSERT INTO sessions(id,instance_id,phone_e164,state,payload_json,expires_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(instance_id,phone_e164) DO UPDATE SET state=excluded.state,payload_json=excluded.payload_json,expires_at=excluded.expires_at,updated_at=excluded.updated_at`)
        .run(linkedSession, instance.id, phone, 'queued', '{}', new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), stamp, stamp);
    } else this.db.prepare("UPDATE sessions SET state='queued',payload_json='{}',updated_at=? WHERE id=?").run(stamp, sessionId);
    const renderConfig = { ...JSON.parse(template.config_json), forceKeepLong: Boolean(oldPayload?.keepLong) };
    this.db.prepare(`INSERT INTO jobs(id,session_id,instance_id,template_id,phone_e164,input_path,output_path,title_original,title_final,flags_raw,config_json,status,message_id,input_bytes,queued_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,'queued',?,?,?, ?,?)`).run(id, linkedSession, instance.id, template.id, phone, mediaPath, outputPath, rawTitle, parsed.headline, parsed.flagsRaw, JSON.stringify(renderConfig), messageId, (await fs.stat(mediaPath)).size, stamp, stamp, stamp);
    addEvent(this.db, id, 'webhook', 'info', 'Mensagem recebida e identificada.', { messageId });
    addEvent(this.db, id, 'autorização', 'info', 'Remetente autorizado para esta instância.');
    addEvent(this.db, id, 'download', 'info', 'Vídeo baixado e salvo localmente.', { inputBytes: (await fs.stat(mediaPath)).size });
    addEvent(this.db, id, 'título', 'info', 'Título e comandos validados.');
    addEvent(this.db, id, 'fila', 'info', 'Solicitação validada e adicionada à fila.', { messageId });
    const position = this.queueCount();
    const warnings = parsed.warnings?.length ? ` ${parsed.warnings.join(' ')}` : '';
    await client.sendText(phone, `Seu vídeo entrou na fila. Há ${Math.max(0, position - 1)} pedido(s) na sua frente.${warnings}${this.paused ? ' O serviço está pausado; seu pedido será processado quando for retomado.' : ''}`);
    void this.pump();
  }

  private async pump() {
    if (this.working || this.paused || this.stopping) return;
    const job = this.db.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY queued_at, created_at LIMIT 1").get() as JobRecord | undefined;
    if (!job) return;
    this.working = true;
    const start = Date.now();
    try {
      const waitMs = Date.now() - Date.parse(String(job.queued_at ?? job.created_at));
      this.db.prepare("UPDATE jobs SET status='rendering',started_at=?,updated_at=?,wait_ms=? WHERE id=? AND status='queued'").run(now(), now(), waitMs, job.id);
      addEvent(this.db, job.id, 'renderização', 'info', 'Renderização iniciada.', { waitMs });
      const templateRow = this.db.prepare('SELECT * FROM templates WHERE id=?').get(job.template_id) as any;
      const templateConfig = JSON.parse(templateRow.config_json);
      const jobConfig = JSON.parse(job.config_json);
      const appSettings = getSetting(this.db, 'settings', { maxVideoBytes: 500 * 1024 * 1024, maxVideoSeconds: 300, ffmpegPreset: 'veryfast', ffmpegCrf: 23 });
      const template = { id: templateRow.id, name: templateRow.name, slug: templateRow.slug, config: { ...templateConfig, forceKeepLong: Boolean(jobConfig.forceKeepLong) }, logoPath: templateRow.logo_path };
      const flags = parseCommand(`${job.title_final} ${job.flags_raw}`);
      let lastReportedProgress = -10;
      const rendered = await this.options.render({ job, template, inputPath: job.input_path, outputPath: job.output_path, title: flags.headline, alignment: flags.alignment, grayscale: flags.grayscale, forceKeepLong: Boolean(jobConfig.forceKeepLong),
        ffmpegPath: process.env.FUTURAMA_FFMPEG, ffprobePath: process.env.FUTURAMA_FFPROBE, preset: appSettings.ffmpegPreset, crf: appSettings.ffmpegCrf,
        maxInputBytes: appSettings.maxVideoBytes, maxDurationSeconds: appSettings.maxVideoSeconds,
        onProgress: (progress, detail) => { if (progress >= lastReportedProgress + 10) { lastReportedProgress = progress; this.db.prepare('UPDATE jobs SET progress=?,updated_at=? WHERE id=?').run(progress, now(), job.id); addEvent(this.db, job.id, 'FFmpeg', 'info', detail ?? `Renderização ${progress}%`, { progress }); } },
        onEvent: (stage, level, message, meta) => addEvent(this.db, job.id, stage, level, message, meta),
      });
      const totalMs = Date.now() - start;
      this.db.prepare("UPDATE jobs SET status='sending',output_bytes=?,output_duration=?,output_width=?,output_height=?,input_width=?,input_height=?,fps=?,duration_ms=?,updated_at=? WHERE id=?").run(rendered.outputBytes, rendered.durationSeconds, rendered.width, rendered.height, rendered.inputWidth, rendered.inputHeight, rendered.fps, totalMs, now(), job.id);
      addEvent(this.db, job.id, 'envio', 'info', 'Arquivo pronto; enviando MP4 pela Evolution.', { outputBytes: rendered.outputBytes, renderMs: Date.now() - start });
      const instance = this.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(job.instance_id) as EvolutionInstance;
      await new EvolutionClient(instance).sendVideo(job.phone_e164, rendered.outputPath);
      this.db.prepare("UPDATE jobs SET status='delivered',finished_at=?,updated_at=? WHERE id=?").run(now(), now(), job.id);
      this.db.prepare("UPDATE sessions SET state='delivered',updated_at=? WHERE id=?").run(now(), job.session_id);
      const durationMs = Date.now() - start;
      this.db.prepare('UPDATE jobs SET duration_ms=?,updated_at=? WHERE id=?').run(durationMs, now(), job.id);
      addEvent(this.db, job.id, 'confirmação', 'info', 'MP4 enviado com sucesso.', { totalMs: durationMs, inputBytes: rendered.inputBytes, outputBytes: rendered.outputBytes, durationSeconds: rendered.durationSeconds });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const stage = (error as any)?.stage ?? (/EVOLUTION_HTTP_|network|fetch failed/i.test(err.message) ? 'envio' : 'renderização');
      const code = (error as any)?.code ?? (stage === 'envio' ? 'EVOLUTION_SEND_FAILED' : err.message.split(':')[0].slice(0, 48).replace(/[^A-Za-z0-9_]/g, '_') || 'RENDER_FAILED');
      const supportCode = shortCode();
      this.db.prepare("UPDATE jobs SET status='failed',error_stage=?,error_code=?,error_message=?,finished_at=?,updated_at=?,duration_ms=? WHERE id=?").run(stage, code, err.message.slice(0, 400), now(), now(), Date.now() - start, job.id);
      this.db.prepare("UPDATE sessions SET state='failed',updated_at=? WHERE id=?").run(now(), job.session_id);
      addEvent(this.db, job.id, stage, 'error', err.message.slice(0, 600), { code, atendimento: supportCode });
      const instance = this.db.prepare('SELECT * FROM evolution_instances WHERE id=?').get(job.instance_id) as EvolutionInstance;
      await new EvolutionClient(instance).sendText(job.phone_e164, `Não consegui concluir na etapa ${stage}. Código: ${code}. Atendimento: ${supportCode}.`).catch(() => {});
    } finally {
      this.working = false;
      void this.pump();
    }
  }
}

export function parseCommand(text: string): { headline: string; alignment: { vertical?: { direction: 'top'|'bottom'; percent: number }; horizontal?: { direction: 'left'|'right'; percent: number } }; grayscale: boolean; flagsRaw: string; warnings?: string[]; error?: string } {
  try {
    const parser = require('@futurama/commands').parseCommand as (input: string) => any;
    const result = parser(text);
    const flagsRaw = (text.match(/(?:^|\s)-(?:top|bottom|left|right)\d{0,3}|(?:^|\s)-pb/gi) ?? []).map((x: string) => x.trim()).join(' ');
    return { ...result, flagsRaw };
  } catch (error) {
    if (error instanceof Error && error.message === 'MODULE_NOT_FOUND') return parseCommandFallback(text);
    return { headline: '', alignment: {}, grayscale: false, flagsRaw: '', error: 'INVALID_COMMAND' };
  }
}

function parseCommandFallback(text: string) {
  let title = text.trim();
  const result: any = { alignment: {}, grayscale: false, flagsRaw: '' };
  const flagMatches = title.match(/(?:^|\s)-[^\s]+/g) ?? [];
  const flags = flagMatches.map((x) => x.trim());
  const valid: string[] = [];
  for (const flag of flags) {
    const m = flag.match(/^-(top|bottom|left|right)(\d{0,3})$/i);
    if (m) {
      const n = m[2] ? Number(m[2]) : 100;
      if (n < 1 || n > 100) return { error: 'INVALID_ALIGNMENT' };
      const direction = m[1].toLowerCase();
      const axis = ['top', 'bottom'].includes(direction) ? 'vertical' : 'horizontal';
      const side = direction === 'top' || direction === 'left' ? 'leftOrTop' : 'rightOrBottom';
      const current = result.alignment[axis];
      if (!current || side === 'leftOrTop') result.alignment[axis] = { direction: ['top', 'bottom'].includes(direction) ? direction : direction, percent: n };
      valid.push(flag);
    } else if (flag.toLowerCase() === '-pb') { result.grayscale = true; valid.push(flag); }
    else return { error: 'UNKNOWN_FLAG' };
  }
  for (const flag of flags) title = title.replace(flag, ' ');
  result.headline = title.replace(/\s+/g, ' ').trim();
  result.flagsRaw = valid.join(' ');
  return result;
}
