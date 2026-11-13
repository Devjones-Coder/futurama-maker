# Futurama Maker

Gerador interno de vídeos de notícias para o feed do Instagram.

**Entrega prioritária:** serviço WhatsApp com Evolution API, templates, FFmpeg, SQLite e dashboard operacional, empacotado como **EXE Windows com ícone na bandeja, status, porta, abrir dashboard, pausar/continuar e sair**.

**Próxima frente (fora do MVP):** **editor** Electron com renderização local, importação de templates, vídeos do YouTube via `yt-dlp` e corte visual com duas alças. O MVP usa apenas um **host Electron mínimo de tray** para executar o serviço WhatsApp localmente.

As duas frentes compartilharão o motor de renderização, esquema de templates e interpretação de flags.

## Desenvolvimento

- `main`: linha estável.
- `dev`: trabalho em andamento, commits e pushs frequentes.
- Sem ambiente de homologação.
- Priorizar o caminho completo vídeo + legenda → MP4 entregue no WhatsApp.
- Preparar build Windows x64 portátil que rode sem Node/FFmpeg instalados globalmente e copiar o EXE final para a Área de Trabalho real do Windows; ver `docs/07-windows-tray.md`.
- Evolution remota não pode enviar webhook diretamente a `localhost` do PC: priorizar transporte de eventos por WebSocket de saída quando disponível, com webhook como alternativa somente se realmente alcançável.
- O dashboard seguirá **exclusivamente o design system definido pela skill disponível no ambiente do Codex**; Stitch e ZIP de protótipo deixam de ser referências. Os requisitos funcionais estão em `docs/04-dashboard-observability.md`. Interface inteiramente em pt-BR.
- As especificações detalhadas estão em `docs/` na branch `dev`.
- Instruções para Codex: `AGENTS.md` na branch `dev`.

> Não publicar chaves da Evolution, senhas reais, telefones ou arquivos de mídia neste repositório.
