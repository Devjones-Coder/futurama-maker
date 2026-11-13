# 05 — Plano de execução direta, paralelismo e aceitação

## Prioridade da entrega
Caminho feliz completo antes de acabamento. **Construir apenas host Electron mínimo de tray para o WhatsApp**, não editor Electron/YouTube. Sem staging.

## Frentes independentes para trabalho paralelo
**A. Core/commands/templates:** parser de flags, geometria, modelo JSON, PNG do Tá Rolando e render FFmpeg testado com um vídeo local.

**B. Evolution/SQLite/sessões:** migrations, adapter de eventos idempotente (WebSocket de saída para execução local, webhook acessível como opção), autorização, download, envio, fila FIFO concurrency 1 e estados de conversa. Pode começar com renderizador falso e integrar o core depois.

**C. Dashboard:** telas administrativas e detalhe de logs com dados simulados/local; integrar API após B. Para aparência, localizar e ler a skill de design system e segui-la como **única referência visual**, sem ampliar as funcionalidades. Nunca aguardar ZIP do Stitch.

**D. Host Windows/tray:** build empacotável Electron mínimo, lifecycle/pausa/retomada/porta, FFmpeg/FFprobe embutidos, gravação em userData, distribuição `.exe`. Iniciar depois de fixar contrato de backend; pode seguir paralelo à UI.

Um integrador faz o encaixe e valida contrato. Trabalhadores/agentes não editam arquivos uns dos outros. Evitar contexto enorme: cada tarefa pequena, arquivos-alvo claros, commit e resumo curto.

## Ordem de integração
1. Criar contrato único de `RenderRequest` e config template.
2. Fazer job local produzir MP4 1080×1350 com overlay correto.
3. Plugar webhook/download/send real da Evolution.
4. Validar fila com dois pedidos simultâneos.
5. Adicionar dashboard e métricas; aplicar somente o design system da skill, preservando escopo e textos em pt-BR.
6. Gerar, executar e testar o **EXE Windows** com tray, controles e FFmpeg empacotado; copiar para Área de Trabalho real e confirmar o arquivo.
7. Registrar no README comandos de setup e início realmente executados, com env vars em `.env.example`.

## Testes focados (sem exageros)
- Parser: `-top`, `-bottom30 -left5 -pb`, ausente, dois opostos, valores inválidos.
- Geometria: vídeo horizontal/vertical com cover/contain, um eixo central, 100% na borda, zero espaço disponível.
- Render: arquivo curto 9:16 e 16:9; verificar resolução e duração com FFprobe; `-pb` sem descolorir logo; manchete curta/longa.
- Evolution: webhook duplicado não duplica job; não autorizado bloqueado; solicitação sem título pede resposta; dois pedidos em sequência FIFO, erro chega ao dashboard.
- Testes de integração no ambiente local e uma demonstração real com instância autorizada, quando houver credenciais disponíveis.

## Git e operação
- Branches somente `main` e `dev`. Trabalhar em `dev`, commits/push automáticos por unidade funcional.
- `main` recebe integração validada; não forçar merge se testes-chave falharem.
- Ao falhar duas vezes no mesmo comando/sessão, diagnosticar e trocar estratégia, sem repetir cegamente.
- Sem auditoria/reinstalação de infraestrutura pronta, sem CI extenso, sem documentação redundante.
- Manter lista de bloqueios reais em texto curto, não criar tarefas especulativas.

## Checklist final
- [ ] Instância conectada por QR via dashboard.
- [ ] Telefone autorizado e template padrão definido.
- [ ] Vídeo com manchete e flags gera MP4 fiel.
- [ ] `-pb` deixa a mídia em cinza e moldura colorida.
- [ ] Fila global impede processamentos simultâneos.
- [ ] Resultado volta ao WhatsApp; sessão fecha.
- [ ] Falhas e consumo aparecem no detalhe do job.
- [ ] Dashboard em pt-BR segue apenas o design system da skill, sem recursos inventados.
- [ ] EXE na Área de Trabalho, executa sem Node/FFmpeg global e permanece ativo na tray ao fechar janela.
- [ ] Porta real exibida; dashboard abre; pausar/retomar controla a fila; sair encerra sem corrupção.
- [ ] Evolução remota recebe eventos via transporte válido (preferencialmente WebSocket de saída) e não pressupõe localhost público.
- [ ] Commits/push em `dev` e instrução clara de como promover para `main`.
