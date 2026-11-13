# Futurama Maker

Gerador interno de vídeos de notícias para o feed do Instagram.

**Entrega prioritária:** serviço WhatsApp com Evolution API, templates, FFmpeg, SQLite e dashboard operacional.

**Próxima frente (fora do MVP):** aplicativo Electron com renderização local, importação de templates, vídeos do YouTube via `yt-dlp` e corte visual com duas alças.

As duas frentes compartilharão o motor de renderização, esquema de templates e interpretação de flags.

## Desenvolvimento

- `main`: linha estável.
- `dev`: trabalho em andamento, commits e pushs frequentes.
- Sem ambiente de homologação.
- Priorizar o caminho completo vídeo + legenda → MP4 entregue no WhatsApp.
- O protótipo visual do Stitch será fornecido separadamente em ZIP com HTML; adotá-lo como referência de layout do dashboard, sem acrescentar recursos.
- As especificações detalhadas estão em `docs/` na branch `dev`.
- Instruções para Codex: `AGENTS.md` na branch `dev`.

> Não publicar chaves da Evolution, senhas reais, telefones ou arquivos de mídia neste repositório.
