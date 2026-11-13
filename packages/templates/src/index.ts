import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export type TemplateConfig = {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  video: { x: number; y: number; width: number; height: number };
  logoPath: string;
  maxWords: number;
  maxLines: number;
  headlineFontSize: number;
  minHeadlineFontSize: number;
  minVideoHeight: number;
  background: string;
};

export const tarolandoTemplate: TemplateConfig = {
  version: 1, id: 'tarolando', name: 'Tá Rolando', width: 1080, height: 1350,
  video: { x: 0, y: 370, width: 1080, height: 980 },
  logoPath: 'assets/tarolando-logo.png', maxWords: 14, maxLines: 4,
  headlineFontSize: 48, minHeadlineFontSize: 18, minVideoHeight: 420, background: '#ffffff',
};

export function validateTemplate(config: TemplateConfig): void {
  if (config.version !== 1 || config.width < 1 || config.height < 1) throw new Error('Configuração de template inválida.');
  if (config.video.x < 0 || config.video.y < 0 || config.video.width < 1 || config.video.height < 1 ||
      config.video.x + config.video.width > config.width || config.video.y + config.video.height > config.height) {
    throw new Error('A área de vídeo precisa estar dentro das dimensões do template.');
  }
  if (!Number.isInteger(config.maxWords) || config.maxWords < 1 || config.minHeadlineFontSize < 1) throw new Error('Limites de manchete inválidos.');
  if (path.isAbsolute(config.logoPath) || config.logoPath.split(/[\\/]/u).includes('..')) throw new Error('O logo deve usar um caminho relativo seguro.');
}

export type OverlayResult = { pngPath: string; video: TemplateConfig['video']; headlineFontSize: number; lines: number; warning?: string };

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.toLocaleUpperCase('pt-BR').trim().split(/\s+/u).filter(Boolean);
  const maxChars = Math.max(8, Math.floor(maxWidth / (fontSize * 0.56)));
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    // Split an unusually long unbroken token while preserving every code point.
    const chunks = Array.from(word).reduce<string[]>((result, character) => {
      if (!result.length || Array.from(result[result.length - 1]).length >= maxChars) result.push(character);
      else result[result.length - 1] += character;
      return result;
    }, []);
    for (const chunk of chunks) {
      const next = line ? `${line} ${chunk}` : chunk;
      if (next.length > maxChars && line) { lines.push(line); line = chunk; }
      else line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Decide before queueing whether a headline needs the WhatsApp correction/MANTER confirmation flow. */
export function headlineNeedsConfirmation(headline: string, template: TemplateConfig = tarolandoTemplate): boolean {
  const words = headline.trim().split(/\s+/u).filter(Boolean).length;
  if (!headline.trim() || words > template.maxWords) return true;
  const width = template.width - 80;
  let fontSize = template.headlineFontSize;
  let lines = wrapText(headline, fontSize, width);
  const maxTextHeight = template.height - template.minVideoHeight - 210;
  while ((lines.length > template.maxLines || lines.length * Math.round(fontSize * 1.25) > maxTextHeight) && fontSize > template.minHeadlineFontSize) {
    fontSize = Math.max(template.minHeadlineFontSize, fontSize - 2);
    lines = wrapText(headline, fontSize, width);
  }
  return lines.length > template.maxLines || lines.length * Math.round(fontSize * 1.25) > maxTextHeight;
}

/** Render one transparent overlay PNG with opaque header/headline and a fully transparent media area. */
export async function createOverlay(options: {
  headline: string; template?: TemplateConfig; dataDir: string; forceKeepLong?: boolean;
}): Promise<OverlayResult> {
  const config = options.template ?? tarolandoTemplate;
  validateTemplate(config);
  const headline = options.headline.trim();
  if (!headline) throw new Error('A manchete não pode ficar vazia.');
  const words = headline.split(/\s+/u).length;
  const contentX = 40;
  const contentWidth = config.width - 80;
  let fontSize = config.headlineFontSize;
  let lines = wrapText(headline, fontSize, contentWidth);
  const maximumMediaY = config.height - config.minVideoHeight;
  const fits = () => lines.length * Math.round(fontSize * 1.25) + 174 + 36 <= maximumMediaY;
  const minimumFontSize = options.forceKeepLong ? Math.min(config.minHeadlineFontSize, 7) : config.minHeadlineFontSize;
  while ((lines.length > config.maxLines || (options.forceKeepLong && !fits())) && fontSize > minimumFontSize) {
    fontSize = Math.max(minimumFontSize, fontSize - (options.forceKeepLong ? 1 : 2));
    lines = wrapText(headline, fontSize, contentWidth);
  }
  const lineHeight = Math.round(fontSize * 1.25);
  const headlineTop = 174;
  const headerBottom = headlineTop + lines.length * lineHeight + 36;
  const mediaY = Math.max(300, headerBottom);
  const mediaHeight = config.height - mediaY;
  if (mediaHeight < config.minVideoHeight && !options.forceKeepLong) throw new Error('A manchete ocupa espaço demais para manter a área mínima de vídeo.');
  const resolved = { ...config, video: { x: 0, y: mediaY, width: config.width, height: mediaHeight } };

  const logo = path.resolve(options.dataDir, config.logoPath);
  if (config.id === 'tarolando') {
    try { await fs.access(logo); }
    catch {
      const bundled = path.resolve(__dirname, '../assets/tarolando-logo.png');
      await fs.mkdir(path.dirname(logo), { recursive: true });
      await fs.copyFile(bundled, logo).catch(() => undefined);
    }
  }
  let logoMarkup = '';
  try {
    await fs.access(logo);
    const meta = await sharp(logo).metadata();
    const size = 96;
    logoMarkup = `<image href="data:image/${meta.format === 'jpeg' ? 'jpeg' : 'png'};base64,${(await fs.readFile(logo)).toString('base64')}" x="40" y="32" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet"/>`;
  } catch {
    logoMarkup = `<circle cx="88" cy="80" r="48" fill="#e8f2ff"/><text x="88" y="93" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#1265a8">TR</text>`;
  }
  const headlineMarkup = lines.map((line, index) => `<text x="40" y="${headlineTop + (index + 1) * lineHeight}" font-family="Arial,sans-serif" font-size="${fontSize}" font-weight="700" fill="#111111">${escapeXml(line)}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${config.width}" height="${config.height}" viewBox="0 0 ${config.width} ${config.height}">
    <rect width="${config.width}" height="${mediaY}" fill="#fff"/>
    ${logoMarkup}
    <text x="154" y="91" font-family="Arial,sans-serif" font-size="44" font-weight="700" fill="#111">Tá Rolando</text>
    <circle cx="388" cy="75" r="15" fill="#0095f6"/><path d="m380 75 6 6 11-13" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    ${headlineMarkup}
  </svg>`;
  await fs.mkdir(options.dataDir, { recursive: true });
  const pngPath = path.join(options.dataDir, `overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  const warning = words > config.maxWords || lines.length > config.maxLines
    ? (options.forceKeepLong ? 'Manchete longa: a fonte foi ajustada deterministicamente.' : 'Manchete acima do limite configurado.')
    : undefined;
  return { pngPath, video: resolved.video, headlineFontSize: fontSize, lines: lines.length, warning };
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
}
