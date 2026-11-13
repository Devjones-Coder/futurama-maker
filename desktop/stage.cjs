const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const staged = path.join(__dirname, 'staged');
fs.rmSync(staged, { recursive: true, force: true });
function copy(source, target) { if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true }); }
copy(path.join(root, 'apps', 'whatsapp', 'dist'), path.join(staged, 'apps', 'whatsapp', 'dist'));
copy(path.join(root, 'apps', 'whatsapp', 'package.json'), path.join(staged, 'apps', 'whatsapp', 'package.json'));
copy(path.join(root, 'apps', 'dashboard', 'dist'), path.join(staged, 'apps', 'dashboard', 'dist'));
const dependencies = {};
for (const manifest of [path.join(root, 'apps', 'whatsapp', 'package.json'), ...fs.readdirSync(path.join(root, 'packages')).map((name) => path.join(root, 'packages', name, 'package.json'))]) {
  const packageJson = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  for (const [name, version] of Object.entries(packageJson.dependencies ?? {})) if (!name.startsWith('@futurama/')) dependencies[name] = version;
}
fs.mkdirSync(staged, { recursive: true });
fs.writeFileSync(path.join(staged, 'package.json'), JSON.stringify({ name: 'futurama-runtime', version: '0.1.0', private: true, dependencies }, null, 2));
const ffmpegCandidates = [process.env.FUTURAMA_FFMPEG_SOURCE, 'C:/ffmpeg/ffmpeg-8.0.1-essentials_build/bin/ffmpeg.exe'].filter(Boolean);
const ffmpeg = ffmpegCandidates.find((file) => fs.existsSync(file));
const ffprobe = ffmpeg ? path.join(path.dirname(ffmpeg), 'ffprobe.exe') : '';
if (!ffmpeg || !fs.existsSync(ffprobe)) throw new Error('FFmpeg/FFprobe Windows não encontrados. Configure FUTURAMA_FFMPEG_SOURCE para o ffmpeg.exe compatível.');
const resources = path.join(staged, 'resources'); fs.mkdirSync(resources, { recursive: true });
fs.copyFileSync(ffmpeg, path.join(resources, 'ffmpeg.exe'));
fs.copyFileSync(ffprobe, path.join(resources, 'ffprobe.exe'));
const lic = path.resolve(path.dirname(ffmpeg), '..', 'LICENSE');
const readme = path.resolve(path.dirname(ffmpeg), '..', 'README.txt');
if (!fs.existsSync(lic) || !fs.existsSync(readme)) throw new Error('Os avisos de licença do pacote FFmpeg não foram encontrados junto aos binários.');
fs.copyFileSync(lic, path.join(resources, 'FFmpeg-LICENSE.txt'));
fs.copyFileSync(readme, path.join(resources, 'FFmpeg-README.txt'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const install = spawnSync(pnpm, ['install', '--prod', '--dir', staged, '--ignore-workspace', '--config.node-linker=hoisted'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (install.status !== 0) throw new Error(`A instalação pnpm das dependências de execução falhou (status ${install.status}).`);
for (const file of ['pnpm-lock.yaml']) fs.rmSync(path.join(staged, file), { force: true });
for (const name of fs.readdirSync(path.join(root, 'packages'))) {
  const source = path.join(root, 'packages', name);
  const target = path.join(staged, 'node_modules', '@futurama', name);
  copy(path.join(source, 'dist'), path.join(target, 'dist'));
  copy(path.join(source, 'assets'), path.join(target, 'assets'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  packageJson.dependencies = Object.fromEntries(Object.entries(packageJson.dependencies ?? {}).filter(([dependency]) => !dependency.startsWith('@futurama/')));
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(packageJson, null, 2));
}
console.log(`Desktop resources staged: ${staged}`);
