import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { createApp } from './app';
import { openDatabase } from './db';
import { Runtime } from './runtime';
import { RenderJobInput, RenderProcessor } from './types';

function coreRenderer(dataDir: string): RenderProcessor {
  return async (input: RenderJobInput) => {
    let core: any;
    try { core = require('@futurama/core'); }
    catch { throw new Error('CORE_PACKAGE_MISSING'); }
    const result = await core.renderVideo({
      inputPath: input.inputPath, outputPath: input.outputPath, headline: input.title,
      template: input.template.config, alignment: input.alignment, grayscale: input.grayscale,
      dataDir, forceKeepLong: input.forceKeepLong, ffmpegPath: input.ffmpegPath, ffprobePath: input.ffprobePath,
      preset: input.preset, crf: input.crf, maxInputBytes: input.maxInputBytes, maxDurationSeconds: input.maxDurationSeconds,
      onProgress: (progress: any) => input.onProgress?.(progress.percent ?? 0, `Renderização ${Math.round(progress.percent ?? 0)}% · ${progress.fps ?? 0} FPS · ${progress.speed ?? ''}`),
      onEvent: (event: any) => input.onEvent?.(event.stage, event.level, event.message, event.meta),
    });
    return result;
  };
}

export type ServerHandle = { server: http.Server; port: number; url: string; close: () => Promise<void>; runtime: Runtime };

export async function startServer(options: { dataDir?: string; port?: number; render?: RenderProcessor; staticDir?: string; controlToken?: string } = {}): Promise<ServerHandle> {
  const dataDir = options.dataDir ?? process.env.FUTURAMA_USER_DATA ?? path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const folder of ['templates', 'input', 'output', 'logs']) fs.mkdirSync(path.join(dataDir, folder), { recursive: true });
  const db = openDatabase(dataDir);
  const runtime = new Runtime({ db, dataDir, render: options.render ?? coreRenderer(dataDir), onStatus: (status) => console.log(`[serviço] ${status}`) });
  const port = Number(options.port ?? process.env.PORT ?? 3788);
  let effectivePort = port;
  const app = createApp({ db, runtime, dataDir, controlToken: options.controlToken ?? process.env.FUTURAMA_CONTROL_TOKEN, staticDir: options.staticDir ?? process.env.FUTURAMA_DASHBOARD_DIR, getPort: () => effectivePort });
  const server = http.createServer(app);
  const bind = (candidate: number) => new Promise<void>((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => { server.off('listening', onListen); reject(error); };
    const onListen = () => { server.off('error', onError); resolve(); };
    server.once('error', onError); server.once('listening', onListen); server.listen(candidate, '127.0.0.1');
  });
  try { await bind(port); }
  catch (error) {
    if (port !== 0 && (error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.warn(`[serviço] Porta ${port} ocupada; selecionando uma porta livre.`);
      await bind(0); effectivePort = (server.address() as any).port;
    } else { await runtime.close(); db.close(); throw error; }
  }
  effectivePort = (server.address() as any).port;
  console.log(`PORT=${effectivePort}`);
  console.log(`[serviço] Futurama Maker disponível em http://127.0.0.1:${effectivePort}`);
  return {
    server, port: effectivePort, url: `http://127.0.0.1:${effectivePort}`, runtime,
    close: async () => {
      await runtime.close();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      db.close();
    },
  };
}

if (require.main === module) {
  void startServer().then((handle) => {
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void handle.close().then(() => process.exit(0)).catch((error) => { console.error(`[serviço] ERRO_SHUTDOWN: ${String(error).slice(0, 200)}`); process.exit(1); });
    };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    process.on('message', (message) => { if (message && typeof message === 'object' && (message as any).type === 'shutdown') stop(); });
  }).catch((error) => { console.error(`[serviço] ERRO_STARTUP: ${error?.stack ?? error}`); process.exitCode = 1; });
}
