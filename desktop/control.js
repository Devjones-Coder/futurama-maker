const byId = id => document.getElementById(id);
function render(s) {
  byId('status').textContent = s.status || 'Iniciando';
  byId('port').textContent = s.port || '—';
  byId('url').textContent = s.dashboardUrl || (s.port ? `http://127.0.0.1:${s.port}` : 'Aguardando serviço…');
  byId('queue').textContent = `${Number(s.queueCount || 0)} aguardando`;
  byId('job').textContent = s.currentJob ? (s.currentJob.id || s.currentJob.status || 'Em andamento') : 'Nenhum';
  byId('pause').textContent = s.paused ? 'Continuar serviço' : 'Pausar serviço';
  byId('pause').disabled = s.status === 'Erro' || s.status === 'Iniciando';
  byId('error').textContent = s.error || '';
}
window.futurama.getStatus().then(render); window.futurama.onStatus(render);
byId('open').addEventListener('click', () => window.futurama.openDashboard());
byId('pause').addEventListener('click', async () => { try { render(await window.futurama.togglePause()); } catch (e) { byId('error').textContent = e.message; } });
byId('quit').addEventListener('click', () => window.futurama.quit());
