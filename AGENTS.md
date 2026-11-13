# Instruções para Codex — Futurama Maker

## Prioridade absoluta
Entregar HOJE o fluxo WhatsApp funcional: vídeo + manchete recebidos pela Evolution → template Tá Rolando → FFmpeg → MP4 devolvido ao remetente, com fila única e dashboard mínimo utilizável; **empacotar como EXE Windows com tray** e colocar o executável na Área de Trabalho. **Funcionar vale mais que arquitetura elaborada.**

Leia `docs/01-mvp-whatsapp.md`, `docs/02-core-and-templates.md` e `docs/07-windows-tray.md` antes de implementar. Use os demais documentos apenas quando entrar naquele módulo.

## Regras de execução
- Trabalhe em `dev`. Faça commits pequenos, com mensagens objetivas, e push automático ao concluir cada fatia funcional. Não crie branches adicionais. `main` é estável; só avance quando o fluxo principal estiver comprovado.
- **Sem homologação**, Docker/Kubernetes, microserviços, CI elaborado, filas externas ou serviços pagos se não forem necessários.
- **Sem IA**, inclusive sugestões de manchetes, análise de frames ou flag `-ia`.
- **Design do dashboard: use exclusivamente a skill de design system disponível no ambiente do Codex como fonte de padrões visuais** (cores, tipografia, espaçamentos, componentes, estados e acessibilidade). Antes de implementar a UI, localize e leia essa skill e seus arquivos de referência, aplicando-a literalmente. Não use Stitch, ZIP de protótipo, referências externas de dashboards ou um design system inventado. A skill determina a aparência; `docs/04-dashboard-observability.md` determina as funcionalidades. Se a skill não estiver disponível, não invente identidade visual: mantenha apenas interface funcional e registre objetivamente a dependência visual. Toda a UI e mensagens devem estar em pt-BR.
- Prefira Node.js + TypeScript, SQLite, Sharp e FFmpeg/FFprobe no sistema; use Electron somente como **host Windows mínimo de tray/status/controle do backend** neste MVP. NÃO iniciar o editor de vídeo Electron. Empacotar com binaries FFmpeg/FFprobe e recursos necessários. Ver `docs/07-windows-tray.md`.
- Paralelize apenas tarefas de arquivos/módulos independentes (parser, renderer, banco, integração, UI). Defina contratos primeiro. Evite agentes mexendo nos mesmos arquivos e evite sessões de contexto gigantes.
- Se um comando, tool ou sessão falhar repetidamente, pare de insistir no mesmo caminho: registre o erro, reduza o escopo e tente uma abordagem alternativa. Não gaste tempo refazendo configuração de infraestrutura que já funciona.
- Testes focados: parser de flags, geometria de contain/cover, título longo, um teste de render com FFmpeg e um fluxo simulado Evolution. Não criar suíte gigantesca.
- Não finja sucesso: prove MP4 gerado e um ciclo de recebimento/resposta Evolution (real ou mock **identificado**), além do EXE empacotado **rodando** com FFmpeg e tray. Informe claramente o que falta configurar.
- Não publique API keys, telefones reais, mídia ou senhas operacionais. Use `.env.example`. Trate webhook idempotente e registre eventos sem segredos.
- Não amplie o escopo. Diante de escolha não definida, implemente a solução mais direta e documente brevemente.

## Ordem recomendada
1. `packages/commands`, `packages/templates`, `packages/core` com contrato reutilizável;
2. ingestão Evolution + download + entrega; 
3. fila única + sessões + SQLite;
4. dashboard de instâncias, telefones, templates, jobs e logs;
5. aplicar somente o design system da skill ao dashboard, sem alterar escopo nem atrasar a entrega funcional;
6. gerar e testar EXE Windows real com tray, minimizar, abrir dashboard, pausar/continuar; copiar à Área de Trabalho (localizar caminho real). Para Evolution remota e backend local, avaliar **WebSocket de saída**; webhook para localhost remoto não funciona.

## Entrega/relato
Ao concluir cada etapa: arquivos alterados, teste executado, commit SHA, branch e bloqueio real (se houver). Sem relatórios longos, auditorias genéricas ou revisões de componentes não tocados.
