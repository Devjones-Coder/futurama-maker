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
# Futurama Maker — serviço WhatsApp local

O aplicativo recebe vídeos por uma instância Evolution API, renderiza o template Tá Rolando neste computador com FFmpeg e devolve o MP4 ao remetente. O serviço escuta somente em `127.0.0.1`; a porta padrão é `3788` e muda automaticamente se já estiver ocupada.

## Desenvolvimento

Requisitos para desenvolvimento: Node.js 20 ou superior, Corepack/pnpm 9.15 ou superior e FFmpeg/FFprobe acessíveis durante a execução local. O usuário final não precisa instalar Node ou FFmpeg: o host Electron inclui os binários Windows.

```powershell
corepack enable
pnpm install
pnpm build
pnpm --filter @futurama/whatsapp run dev
pnpm test:focused
```

O build de `pnpm build` respeita a ordem dos workspaces declarada em `pnpm-workspace.yaml`: comandos/templates/core antes do backend e do dashboard. O pnpm mantém um store compartilhado de pacotes, reduzindo cópias entre workspaces. Os testes focados cobrem flags, geometria/renderização real, overlay e fluxo simulado Evolution/SQLite. Para empacotar no Windows x64: `pnpm desktop:dist`.

O empacotamento procura `ffmpeg.exe` em `C:\ffmpeg\ffmpeg-8.0.1-essentials_build\bin`; use `FUTURAMA_FFMPEG_SOURCE` para indicar outro build Windows que tenha `ffprobe.exe`, `LICENSE` e `README.txt` no diretório esperado pelo script. A distribuição mantém os avisos GPLv3 e a identificação da origem dos binários junto ao executável.

Configurações de ambiente seguras estão em `.env.example`. Em desenvolvimento, `FUTURAMA_USER_DATA` escolhe o diretório persistente; sem ele o backend usa `./data`. A porta pode ser definida com `PORT`. A primeira credencial do painel é `admin` / `123456` e deve ser alterada em Configurações.

## Evolution API

Cadastre no dashboard a URL base acessível, o nome da instância e a chave API. O backend abre uma conexão de saída Socket.IO para o namespace da instância Evolution e acompanha `messages.upsert` e `connection.update`; a Evolution precisa estar configurada para emitir esses eventos por WebSocket. O código também oferece `POST /webhooks/evolution/:instanceId`, mas a Evolution remota só poderá usá-lo quando o endereço deste computador estiver realmente acessível. `localhost` não é alcançável a partir de outro servidor. Nenhum túnel ou serviço externo é criado automaticamente.

Cadastre os números autorizados e vincule-os à instância. Cada instância precisa de um template padrão ativo. O template inicial Tá Rolando é criado automaticamente na primeira inicialização. O número de telefone e a chave Evolution são guardados localmente no SQLite; chaves são mascaradas nas respostas da API.

## Estado da entrega

O modo de desenvolvimento usa a instalação de dependências do repositório. A versão portátil precisa ser gerada e executada no Windows para comprovar tray, persistência no caminho do usuário, recursos empacotados e FFmpeg incluído.
