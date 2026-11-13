import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Alignment } from '@futurama/commands';
import { createOverlay, TemplateConfig, tarolandoTemplate } from '@futurama/templates';

export type RenderRequest = {
  inputPath: string;
  outputPath: string;
  template?: TemplateConfig;
  headline: string;
  alignment?: Alignment;
  grayscale?: boolean;
  dataDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  forceKeepLong?: boolean;
  crf?: number;
  preset?: string;
  maxInputBytes?: number;
  maxDurationSeconds?: number;
  onProgress?: (progress: RenderProgress) => void;
  onEvent?: (event: RenderEvent) => void;
};
export type RenderResult = { outputPath: string; width: number; height: number; durationSeconds: number; inputBytes: number; outputBytes: number; inputWidth: number; inputHeight: number; fps: number; warning?: string };
export type RenderProgress = { frame?: number; fps?: number; outTimeSeconds?: number; speed?: string; percent?: number };
export type RenderEvent = { stage: 'ffprobe' | 'overlay' | 'ffmpeg' | 'verify'; level: 'info' | 'warn' | 'error'; message: string; meta?: Record<string, unknown> };
export type ProbeResult = { width: number; height: number; durationSeconds: number; fps: number; hasAudio: boolean; bytes: number };
export type Rect = { x: number; y: number; width: number; height: number };

export async function probeMedia(inputPath: string, ffprobePath = 'ffprobe'): Promise<ProbeResult> {
  const stat = await fs.stat(inputPath);
  const data = await runJson(ffprobePath, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath]);
  const streams = (data.streams ?? []) as Array<Record<string, any>>;
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video) throw new Error('O arquivo não contém uma faixa de vídeo.');
  const duration = Number(video.duration ?? data.format?.duration ?? 0);
  return {
    width: Number(video.width), height: Number(video.height), durationSeconds: duration,
    fps: parseRate(String(video.avg_frame_rate ?? video.r_frame_rate ?? '30/1')),
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'), bytes: stat.size,
  };
}

export function calculateContain(inputWidth: number, inputHeight: number, area: Rect): Rect {
  const scale = Math.min(area.width / inputWidth, area.height / inputHeight);
  const width = Math.max(1, Math.round(inputWidth * scale));
  const height = Math.max(1, Math.round(inputHeight * scale));
  return { x: Math.round((area.width - width) / 2), y: Math.round((area.height - height) / 2), width, height };
}

export function positionContained(foreground: Rect, area: Rect, alignment: Alignment = {}): Rect {
  const freeX = Math.max(0, area.width - foreground.width);
  const freeY = Math.max(0, area.height - foreground.height);
  const hp = alignment.horizontal?.percent ?? 0;
  const vp = alignment.vertical?.percent ?? 0;
  const x = alignment.horizontal
    ? (alignment.horizontal.direction === 'left' ? (freeX / 2) * (1 - hp / 100) : (freeX / 2) * (1 + hp / 100))
    : freeX / 2;
  const y = alignment.vertical
    ? (alignment.vertical.direction === 'top' ? (freeY / 2) * (1 - vp / 100) : (freeY / 2) * (1 + vp / 100))
    : freeY / 2;
  return { ...foreground, x: area.x + Math.round(x), y: area.y + Math.round(y) };
}

/** Render a single 1080×1350 MP4. FFmpeg is invoked with argument arrays, never through a shell. */
export async function renderVideo(request: RenderRequest): Promise<RenderResult> {
  const template = request.template ?? tarolandoTemplate;
  const ffprobe = request.ffprobePath ?? 'ffprobe';
  const ffmpeg = request.ffmpegPath ?? 'ffmpeg';
  const emit = request.onEvent ?? (() => undefined);
  const inputStat = await fs.stat(request.inputPath);
  if (request.maxInputBytes && inputStat.size > request.maxInputBytes) throw new RenderFailure('ffprobe', 'INPUT_TOO_LARGE', 'O vídeo excede o tamanho máximo permitido.');
  emit({ stage: 'ffprobe', level: 'info', message: 'Lendo propriedades do vídeo.' });
  let source: ProbeResult;
  try { source = await probeMedia(request.inputPath, ffprobe); }
  catch (error) { throw new RenderFailure('ffprobe', 'PROBE_FAILED', safeMessage(error)); }
  if (request.maxDurationSeconds && source.durationSeconds > request.maxDurationSeconds) throw new RenderFailure('ffprobe', 'DURATION_TOO_LONG', 'O vídeo excede a duração máxima permitida.');

  await fs.mkdir(path.dirname(request.outputPath), { recursive: true });
  const overlayResult = await createOverlay({ headline: request.headline, template, dataDir: request.dataDir, forceKeepLong: request.forceKeepLong });
  emit({ stage: 'overlay', level: overlayResult.warning ? 'warn' : 'info', message: 'Moldura e manchete geradas.', meta: { fontSize: overlayResult.headlineFontSize, lines: overlayResult.lines, warning: overlayResult.warning } });

  const area = overlayResult.video;
  const hasAlignment = Boolean(request.alignment?.horizontal || request.alignment?.vertical);
  const filters = hasAlignment
    ? alignedFilter(source, area, request.alignment ?? {}, Boolean(request.grayscale), template.width, template.height)
    : coverFilter(area, Boolean(request.grayscale), template.width, template.height);
  const fps = Math.min(30, Math.max(1, source.fps || 30));
  const args = ['-hide_banner', '-y', '-i', request.inputPath, '-i', overlayResult.pngPath, '-filter_complex', filters,
    '-map', '[outv]', ...(source.hasAudio ? ['-map', '0:a:0?'] : []), '-c:v', 'libx264', '-preset', request.preset ?? 'veryfast',
    '-crf', String(request.crf ?? 23), '-r', fps.toFixed(3), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart', '-progress', 'pipe:2', '-nostats', request.outputPath];
  emit({ stage: 'ffmpeg', level: 'info', message: 'Iniciando codificação H.264.' });
  try {
    await runFfmpeg(ffmpeg, args, source.durationSeconds, request.onProgress);
  } catch (error) {
    throw new RenderFailure('ffmpeg', 'RENDER_FAILED', safeMessage(error));
  } finally {
    await fs.rm(overlayResult.pngPath, { force: true }).catch(() => undefined);
  }
  emit({ stage: 'verify', level: 'info', message: 'Validando arquivo de saída.' });
  let output: ProbeResult;
  try { output = await probeMedia(request.outputPath, ffprobe); }
  catch (error) { throw new RenderFailure('verify', 'OUTPUT_INVALID', safeMessage(error)); }
  if (output.width !== template.width || output.height !== template.height) throw new RenderFailure('verify', 'OUTPUT_DIMENSIONS_INVALID', `Saída inesperada: ${output.width}×${output.height}.`);
  return { outputPath: request.outputPath, width: output.width, height: output.height, durationSeconds: output.durationSeconds, inputBytes: source.bytes, outputBytes: output.bytes, inputWidth: source.width, inputHeight: source.height, fps, warning: overlayResult.warning };
}

export class RenderFailure extends Error {
  constructor(readonly stage: RenderEvent['stage'], readonly code: string, message: string) { super(message); this.name = 'RenderFailure'; }
}

function coverFilter(area: Rect, grayscale: boolean, canvasWidth: number, canvasHeight: number): string {
  const gray = grayscale ? ',hue=s=0' : '';
  return `[0:v]scale=${area.width}:${area.height}:force_original_aspect_ratio=increase,crop=${area.width}:${area.height},setsar=1${gray}[media];` +
    `[media]pad=${canvasWidth}:${canvasHeight}:${area.x}:${area.y}:color=white[canvas];[canvas][1:v]overlay=0:0:format=auto[outv]`;
}

function alignedFilter(source: ProbeResult, area: Rect, alignment: Alignment, grayscale: boolean, canvasWidth: number, canvasHeight: number): string {
  const fg = calculateContain(source.width, source.height, { x: 0, y: 0, width: area.width, height: area.height });
  const placed = positionContained(fg, area, alignment);
  const grayBg = grayscale ? ',hue=s=0' : '';
  const grayFg = grayscale ? ',hue=s=0' : '';
  return `[0:v]split=2[bgsrc][fgsrc];` +
    `[bgsrc]scale=${area.width}:${area.height}:force_original_aspect_ratio=increase,crop=${area.width}:${area.height},boxblur=20:10${grayBg}[bg];` +
    `[fgsrc]scale=${fg.width}:${fg.height}:flags=lanczos,setsar=1${grayFg}[fg];` +
    `[bg][fg]overlay=${placed.x - area.x}:${placed.y - area.y}:format=auto[media];` +
    `[media]pad=${canvasWidth}:${canvasHeight}:${area.x}:${area.y}:color=white[canvas];[canvas][1:v]overlay=0:0:format=auto[outv]`;
}

function parseRate(value: string): number {
  const [a, b] = value.split('/').map(Number);
  return b && Number.isFinite(a / b) ? a / b : Number(value) || 30;
}

function safeMessage(error: unknown): string { return error instanceof Error ? error.message.slice(0, 800) : 'Falha técnica sem detalhes.'; }

function runJson(executable: string, args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (part: string) => stdout += part);
    child.stderr.setEncoding('utf8').on('data', (part: string) => stderr += part);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe saiu com código ${code}: ${stderr.slice(-600)}`));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('ffprobe retornou dados inválidos.')); }
    });
  });
}

function runFfmpeg(executable: string, args: string[], duration: number, onProgress?: (progress: RenderProgress) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = ''; let line = ''; let progress: RenderProgress = {};
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (part: string) => {
      tail = (tail + part).slice(-4000);
      for (const char of part) {
        if (char === '\n' || char === '\r') {
          const match = /^(frame|fps|out_time_ms|speed)=(.*)$/u.exec(line.trim());
          if (match) {
            const key = match[1]; const val = match[2];
            if (key === 'frame') progress.frame = Number(val);
            if (key === 'fps') progress.fps = Number(val);
            if (key === 'speed') progress.speed = val;
            if (key === 'out_time_ms') {
              progress.outTimeSeconds = Number(val) / 1_000_000;
              progress.percent = duration > 0 ? Math.min(100, progress.outTimeSeconds / duration * 100) : undefined;
              onProgress?.({ ...progress });
            }
          }
          line = '';
        } else line += char;
      }
    });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com código ${code}: ${tail.slice(-1600)}`)));
  });
}
