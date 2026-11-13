import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type AppDatabase = ReturnType<typeof openDatabase>;

const now = () => new Date().toISOString();

export function openDatabase(dataDir: string): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'futurama.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS templates(id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, config_json TEXT NOT NULL, logo_path TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evolution_instances(id TEXT PRIMARY KEY, display_name TEXT NOT NULL, base_url TEXT NOT NULL, instance_name TEXT NOT NULL, api_key TEXT NOT NULL, default_template_id TEXT REFERENCES templates(id), status TEXT NOT NULL DEFAULT 'desconhecida', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authorized_numbers(id TEXT PRIMARY KEY, phone_e164 TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS authorized_number_instances(number_id TEXT NOT NULL REFERENCES authorized_numbers(id) ON DELETE CASCADE, instance_id TEXT NOT NULL REFERENCES evolution_instances(id) ON DELETE CASCADE, PRIMARY KEY(number_id, instance_id));
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, instance_id TEXT NOT NULL REFERENCES evolution_instances(id), phone_e164 TEXT NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(instance_id, phone_e164));
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, session_id TEXT, instance_id TEXT NOT NULL REFERENCES evolution_instances(id), template_id TEXT NOT NULL REFERENCES templates(id), phone_e164 TEXT NOT NULL, input_path TEXT NOT NULL, output_path TEXT NOT NULL, title_original TEXT NOT NULL, title_final TEXT NOT NULL, flags_raw TEXT NOT NULL DEFAULT '', config_json TEXT NOT NULL, status TEXT NOT NULL, error_stage TEXT, error_code TEXT, message_id TEXT, input_bytes INTEGER, output_bytes INTEGER, input_duration REAL, output_duration REAL, queued_at TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, stage TEXT NOT NULL, level TEXT NOT NULL, message TEXT NOT NULL, meta_json TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS inbound_messages(instance_id TEXT NOT NULL, provider_message_id TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(instance_id, provider_message_id));
    CREATE TABLE IF NOT EXISTS app_settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const columns = new Set((db.prepare('PRAGMA table_info(jobs)').all() as Array<{ name: string }>).map((column) => column.name));
  const addColumn = (name: string, definition: string) => { if (!columns.has(name)) db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`); };
  for (const [name, definition] of Object.entries({ input_width: 'INTEGER', input_height: 'INTEGER', fps: 'REAL', output_width: 'INTEGER', output_height: 'INTEGER', duration_ms: 'INTEGER', wait_ms: 'INTEGER', error_message: 'TEXT', stderr: 'TEXT', progress: 'REAL' })) addColumn(name, definition);
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, ?)').run(now());
  db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(2, ?)').run(now());

  const template = db.prepare('SELECT id FROM templates WHERE slug=?').get('ta-rolando') as { id: string } | undefined;
  if (!template) {
    const id = crypto.randomUUID();
    const config = {
      version: 1, id: 'tarolando', name: 'Tá Rolando', width: 1080, height: 1350,
      video: { x: 0, y: 370, width: 1080, height: 980 }, logoPath: 'assets/tarolando-logo.png',
      maxWords: 14, maxLines: 4, headlineFontSize: 48, minHeadlineFontSize: 18, minVideoHeight: 420, background: '#ffffff',
    };
    db.prepare('INSERT INTO templates(id,name,slug,config_json,active,created_at,updated_at) VALUES(?,?,?,?,1,?,?)')
      .run(id, 'Tá Rolando', 'ta-rolando', JSON.stringify(config), now(), now());
  }
  return db;
}

export function getSetting<T>(db: AppDatabase, key: string, fallback: T): T {
  const row = db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(key) as { value_json: string } | undefined;
  return row ? JSON.parse(row.value_json) as T : fallback;
}

export function setSetting(db: AppDatabase, key: string, value: unknown) {
  db.prepare('INSERT INTO app_settings(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at')
    .run(key, JSON.stringify(value), now());
}

export function addEvent(db: AppDatabase, jobId: string, stage: string, level: string, message: string, meta?: unknown) {
  db.prepare('INSERT INTO job_events(job_id,stage,level,message,meta_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(jobId, stage, level, message, meta === undefined ? null : JSON.stringify(meta), now());
}

export { now };
