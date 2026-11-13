const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const { fork } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { randomBytes } = require('node:crypto');

let win, tray, backend, port = 3788, quitting = false, timer;
const controlToken = randomBytes(32).toString('hex');
const state = { status: 'Iniciando', queueCount: 0, currentJob: null, paused: false, dashboardUrl: '' };
const statePath = () => path.join(app.getPath('userData'), 'runtime.json');
function saveState() { try { fs.mkdirSync(path.dirname(statePath()), { recursive: true }); fs.writeFileSync(statePath(), JSON.stringify({ paused: state.paused })); } catch {} }
function setState(next) { Object.assign(state, next); if (win && !win.isDestroyed()) win.webContents.send('status', state); if (tray) tray.setToolTip(`Futurama Maker — ${state.status}`); }
function showControl() { if (!win || win.isDestroyed()) createWindow(); else { win.show(); win.focus(); } }
function createWindow() {
  win = new BrowserWindow({ width: 420, height: 330, resizable: false, show: false, title: 'Futurama Maker — Serviço', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'control.html')); win.once('ready-to-show', () => win.show());
  win.on('minimize', e => { e.preventDefault(); win.hide(); });
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
}
function api(pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method, headers: { 'x-futurama-control-token': controlToken }, timeout: 2500 }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', c => body += c); res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('timeout'))); req.end();
  });
}
async function refresh() {
  try { const s = await api('/api/status'); port = Number(s.port || port); const label = s.status === 'running' ? (s.paused ? 'Pausado' : 'Em execução') : s.status; setState({ ...s, status: label }); }
  catch { if (state.status !== 'Iniciando') setState({ status: 'Erro', error: 'BACKEND_INDISPONIVEL' }); }
}
async function togglePause() { const pause = !state.paused; await api(pause ? '/api/service/pause' : '/api/service/resume', 'POST'); state.paused = pause; saveState(); await refresh(); buildMenu(); return state; }
function buildMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir painel', click: showControl },
    { label: 'Abrir dashboard', click: () => shell.openExternal(state.dashboardUrl || `http://127.0.0.1:${port}`) },
    { label: state.paused ? 'Continuar' : 'Pausar', click: () => togglePause().catch(() => {}) },
    { type: 'separator' }, { label: 'Sair', click: shutdown }
  ]));
}
async function shutdown() {
  if (quitting) return;
  quitting = true; clearInterval(timer);
  if (backend && !backend.killed) {
    await new Promise(resolve => { backend.once('exit', resolve); backend.send({ type: 'shutdown' }); });
  }
  app.quit();
}
async function startBackend() {
  const entry = path.join(app.getAppPath(), 'staged', 'apps', 'whatsapp', 'dist', 'server.js');
  if (!fs.existsSync(entry)) { setState({ status: 'Erro', error: 'BACKEND_AUSENTE' }); return; }
  let saved = {}; try { saved = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch {}
  state.paused = Boolean(saved.paused);
  backend = fork(entry, [], { execPath: process.execPath, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', FUTURAMA_USER_DATA: app.getPath('userData'), FUTURAMA_FFMPEG: path.join(process.resourcesPath, 'ffmpeg.exe'), FUTURAMA_FFPROBE: path.join(process.resourcesPath, 'ffprobe.exe'), FUTURAMA_DASHBOARD_DIR: path.join(app.getAppPath(), 'staged', 'apps', 'dashboard', 'dist'), FUTURAMA_PORT: String(port), FUTURAMA_INITIAL_PAUSED: String(state.paused), FUTURAMA_CONTROL_TOKEN: controlToken }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  backend.stdout?.on('data', chunk => { const match = String(chunk).match(/(?:PORT|port)[=: ]+(\d+)/); if (match) port = Number(match[1]); });
  backend.stderr?.on('data', chunk => { const msg = String(chunk).trim(); if (msg) { const code = msg.match(/[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/)?.[0]; setState({ status: 'Erro', error: code || 'FALHA_BACKEND' }); } });
  backend.on('exit', code => { if (!quitting && code !== 0) setState({ status: 'Erro', error: `BACKEND_${code}` }); });
  timer = setInterval(refresh, 1800); setTimeout(refresh, 800);
}
app.on('second-instance', showControl);
app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.setName('Futurama Maker'); createWindow();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'icon.png'))); tray.setToolTip('Futurama Maker — Iniciando'); tray.on('double-click', showControl); buildMenu();
  ipcMain.handle('status', () => state); ipcMain.handle('open-dashboard', () => shell.openExternal(state.dashboardUrl || `http://127.0.0.1:${port}`));
  ipcMain.handle('toggle-pause', () => togglePause()); ipcMain.handle('quit', shutdown); startBackend();
});
app.on('before-quit', () => { quitting = true; clearInterval(timer); if (backend && !backend.killed) backend.kill('SIGTERM'); });
