# 06 — Editor Electron futuro (NÃO implementar no MVP)

**Distinção:** o MVP já terá um **host Electron mínimo** para tray/controle do serviço WhatsApp no Windows, documentado em `07-windows-tray.md`. Este documento trata apenas do **futuro editor** local de vídeos e recursos de YouTube.

Objetivo: app desktop para preparar e gerar localmente o mesmo vídeo com o mesmo template e flags, sem depender do servidor; exportar MP4. UI inspirada no Canva apenas no visual e restrita aos controles definidos, sem recursos extras.

## Reuso real
Consumir `packages/commands`, `packages/templates` e `packages/core` do monorepo. O core não pode acoplar-se à Evolution, browser, SQLite ou dashboard. Priorizar caminhos de arquivos + render config puros. Template poderá ser empacotado como `.vtemplate` (ZIP com manifesto/JSON/logo/fonts, sem execução de código).

## Recursos do desktop (etapa futura)
- Seleção de template e vídeo local; título; sliders/arraste de alinhamento com preview local; preto e branco; gerar MP4; copiar comando WhatsApp.
- Importar vídeo do YouTube por URL usando `yt-dlp` CLI, para conteúdo cujo uso seja autorizado. Download local, sem serviço pago.
- Seleção de trecho com experiência de duas alças arrastáveis sobre uma linha do tempo, marcando início e fim, semelhante ao corte de vídeo do WhatsApp; prévia do trecho e exportação local. Implementação de corte pelo FFmpeg com precisão adequada.
- Sem IA. Sem upload de vídeo para servidor para fazer preview ou render no desktop.
- Electron não substitui o serviço WhatsApp: são dois frontends diferentes sobre um motor compartilhado.

Esta página é um contrato de compatibilidade, **não uma tarefa para iniciar agora**.
