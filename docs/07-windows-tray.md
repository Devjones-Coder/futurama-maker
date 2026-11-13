# 07 — Executável Windows e controle pela bandeja do sistema (MVP obrigatório)

## Decisão de arquitetura
O MVP continua sendo **exclusivamente o serviço WhatsApp**. Em vez de exigir Node/terminal aberto, entregar um **host desktop mínimo para Windows** que inicia e controla o backend local. Preferir Electron (processo principal + Tray) pela praticidade de empacotar um `.exe`; **não construir o editor de vídeos Electron** descrito em `06-future-electron.md`. Dashboard continua no navegador, servido pelo backend.

Fluxo: iniciar `Futurama Maker.exe` → backend Node no próprio Windows → dashboard localhost + SQLite + FFmpeg local + Evolution remota → vídeo volta via WhatsApp.

## Empacotamento e entrega
- Gerar executável **Windows x64** autocontido, preferencialmente alvo **portable** do electron-builder, nome `Futurama Maker.exe`, sem exigir instalação de Node ou FFmpeg pelo usuário final.
- Incluir na distribuição os assets do template inicial, UI compilada, migrations e binários Windows compatíveis de `ffmpeg.exe` e `ffprobe.exe`; respeitar redistribuição/licenças dos binários usados. Não depender de FFmpeg global do PATH.
- Produzir no Windows do usuário, e **copiar o EXE final para a Área de Trabalho real**: descobrir com a API do Windows/PowerShell o caminho correto (incluindo redirecionamento OneDrive), não presumir `C:\\Users\\...\\Desktop`. Confirmar fisicamente arquivo, nome, tamanho e caminho final.
- Se ambiente não tiver Windows/acesso ao Desktop, produzir build no alvo disponível quando tecnicamente viável e **relatar limitação real**, sem afirmar que copiou. Não criar download falso.
- Recursos persistentes em `app.getPath('userData')` ou equivalente `%APPDATA%/Futurama Maker`; **nunca** dentro do `.exe`, da pasta temporária de extração ou do diretório somente-leitura do bundle.
- O executável deve iniciar por duplo clique, sem console visível. Uma só instância: segundo clique traz janela de controle/status à frente.

## Comportamento da tray
- Ícone permanente na **bandeja do sistema/área de notificação** do Windows enquanto o processo estiver ativo.
- Fechar a janela no X ou minimizar **oculta a janela para a tray**, mas o backend continua vivo. Não matar a fila ao fechar janela.
- Duplo clique no ícone abre janela compacta `Futurama Maker — Serviço` mostrando:
  - status: `Iniciando`, `Em execução`, `Pausado` ou `Erro`;
  - **porta real** do servidor local;
  - URL exata do dashboard (ex.: `http://127.0.0.1:3788`);
  - fila atual e job em execução (contadores simples);
  - botões `Abrir dashboard`, `Pausar serviço`/`Continuar serviço` e `Sair`.
- Menu contextual da bandeja também oferece `Abrir painel`, `Abrir dashboard`, `Pausar`/`Continuar` e `Sair`. Não inventar outras opções.
- Porta inicial padrão: `3788` configurável; confirmar porta efetivamente vinculada antes de exibir. Preferir binder `127.0.0.1` para dashboard. Se porta ocupada: escolher automaticamente outra disponível e exibir a porta real (e registrar no log).
- Usar comunicação segura entre processo principal e serviço (IPC/local HTTP protegido contra acessos indevidos). Não habilitar Node integration no renderer; não expor API key da Evolution na janela de controle.
- `Pausar` = persistir estado pausado e **não iniciar novos renders**. Job já em execução conclui de modo seguro; novos pedidos válidos permanecem na fila e recebem aviso. `Continuar` volta a consumir fila FIFO. No reinício, restaurar o estado anterior. `Sair` encerra com segurança, preserva fila e banco; nada de subprocessos órfãos.
- Estado visível não pode ser fictício: validar `health`/porta/backend antes de informar `Em execução`. Se backend falhar, mostrar `Erro` e código resumido.

## Transporte de eventos Evolution: atenção ao localhost
A Evolution API geralmente roda remotamente. **Ela não consegue fazer webhook HTTP diretamente para `127.0.0.1` do Windows do usuário.**

Para a entrega local, **priorizar conexão de saída persistente via WebSocket/Socket.IO da Evolution**, quando a versão/instância realmente permitir `MESSAGES_UPSERT` e eventos de conexão. Confirmar versão, configuração, autenticação e nomes de eventos na documentação/instância real. Implementar reconexão e deduplicação via messageId.

Manter o adapter de webhook para uso futuro num servidor ou quando houver endpoint alcançável explicitamente configurado, mas **não pressupor que webhook de localhost funciona pela internet** e não criar domínio, túnel ou serviço pago por conta própria. Se a Evolution instalada não oferecer transporte compatível nem webhook alcançável, exibir bloqueio específico no dashboard/log e informar o que precisa ser habilitado; nunca simular recebimento real.

## Dashboard e controle
- Rota de health/status e controle de pausa/retomada disponíveis apenas localmente/autenticados conforme o desenho adotado; manter botão de controle local na janela de tray e dashboard administrativo como já especificado.
- Logs mostram startup/stop, porta usada, falha do backend, conectar/desconectar transporte Evolution, pausa/retomada, jobs e consumo de recursos.
- Login/dashboard continua simples e em pt-BR. Visual segue **somente a skill de design system** do ambiente. A janela de tray é utilitária e legível, sem adicionar editor ou painéis novos.

## Testes mínimos do EXE
1. Build e execução **do arquivo empacotado** no Windows, não somente `npm run dev`.
2. Abre status com porta real e `Abrir dashboard` abre rota local correta.
3. Minimizar e X mantêm app/serviço ativos na tray.
4. Pausar impede início de novo job; retomar libera fila; job em execução não é interrompido abruptamente.
5. Encerrar e reabrir sem corromper SQLite e sem duplicar jobs.
6. FFmpeg/FFprobe funcionam quando invocados **pelo executável distribuído**.
7. EXE está realmente na Área de Trabalho indicada pelo sistema.

Sem homologação, serviços Windows extras, autostart, atualizador automático, assinatura digital obrigatória, instalador complexo ou editor de vídeo neste MVP.
