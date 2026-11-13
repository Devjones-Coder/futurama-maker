# 01 — Escopo e fluxo do MVP WhatsApp

## Objetivo
Serviço interno para 4–5 pessoas: receber **vídeo e manchete** pelo WhatsApp via Evolution API, gerar vídeo de notícia no formato feed Instagram 4:5 usando template cadastrado, responder com o MP4 final. **O motor roda localmente no computador Windows que executa o EXE**, sem exigir servidor separado; o processo fica na tray. Uma renderização por vez. O mesmo núcleo poderá rodar em um servidor no futuro.

## MVP obrigatório
- Evolution: configuração da URL e API key pelo dashboard; múltiplas instâncias com status, QR Code, conexão e desconexão pelas ações compatíveis com a versão instalada da Evolution. Para o backend **local** preferir WebSocket de saída/Socket.IO de eventos quando disponível; manter webhook apenas para endpoint alcançável. Não presumir endpoints nem que Evolution remota alcança `localhost`. Ver `docs/07-windows-tray.md`.
- Telefones autorizados, vinculados a uma ou mais instâncias; cada instância tem um **template padrão** previamente cadastrado. Resolver template por instância de destino; não inventar flag de escolha de template neste MVP.
- Templates persistidos em SQLite (configuração JSON) e recursos visuais em disco. Seed inicial: **Tá Rolando**.
- Receber mensagem de vídeo com legenda contendo título e flags, ou vídeo e título em mensagens consecutivas na mesma conversa. Não baixar mídia de remetente não autorizado. Ignorar mensagens de grupo/status e eventos sem mídia/título relevantes.
- Validar formato/duração/tamanho de entrada por limites configuráveis; informar erro amigável em vez de travar fila.
- Aplicar regras de título longo sem IA. Gerar PNG transparente único da moldura, FFmpeg posiciona vídeo + aplica moldura e codifica H.264/AAC MP4; reenviar pela Evolution.
- Serialização global de render: **concorrência = 1**. Usuários adicionais recebem posição na fila quando o pedido estiver pronto para renderizar.
- Sessão conversacional por `instanceId + phone`; encerra após envio bem-sucedido, cancelamento, falha terminal ou expiração.
- Dashboard: login simples, administração de templates, telefones, instâncias, fila/jobs, logs detalhados e consumo de recursos; especificado em `docs/04-dashboard-observability.md`.
- EXE Windows x64 portátil com tray: mostrar status/porta real, abrir dashboard no navegador, pausar/retomar serviço, sair com segurança, manter backend vivo ao minimizar/fechar janela. Ver `docs/07-windows-tray.md`.

## Estados de uma solicitação
`receiving → waiting_title (se necessário) → waiting_title_choice (se necessário) → queued → downloading → rendering → sending → delivered`. Saídas: `failed`, `cancelled`, `expired`.

Título longo: avaliar **limite de palavras configurável por template** e capacidade visual real. Antes de enfileirar, avisar: “Este título está muito grande. Envie um novo título ou responda MANTER para usar o original.” A opção MANTER prossegue com ajuste tipográfico determinístico, mesmo que seja necessário reduzir muito a fonte; não gerar sugestões por IA. Limpar flags antes de medir o título.

O pedido só ocupa a vaga de render quando o texto estiver definido. Enquanto aguarda resposta, a sessão permanece persistida sem bloquear outras renderizações. Um segundo vídeo na mesma sessão deve ser tratado sem misturar os pedidos: responder que há solicitação em andamento (ou permitir cancelar e recomeçar, de forma explícita).

## Mensagens operacionais
- Não autorizado: resposta curta ou ignorar, conforme configuração.
- Aguardando título: pedir manchete.
- Título longo: pedir título corrigido ou MANTER.
- Fila: “Seu vídeo entrou na fila. Há N pedido(s) na sua frente.”
- Concluído: anexar MP4 e encerrar sessão.
- Falha: indicar etapa (“download”, “renderização”, “envio”) e um código curto de atendimento vinculado ao job, sem expor stack trace ao usuário.

## Não fazer agora
IA, `-ia`, YouTube/yt-dlp, corte temporal com alças, **editor completo Electron** (o host mínimo de tray é obrigatório), editor visual, analytics externos, armazenamento em nuvem obrigatório, múltiplos workers, assinaturas, cobrança, ambiente de homologação, funcionalidades inventadas pelo Stitch.

## Critério de pronto
Dois números autorizados em instância configurada conseguem enviar vídeos com título; um processa e outro entra na fila; output 1080×1350 com logo/manchete corretas e áudio preservado; flags e `-pb` respeitadas; vídeo entregue; dashboard mostra job, tempos, tamanhos e etapa eventual de erro.
