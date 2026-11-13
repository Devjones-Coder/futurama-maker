# Instruções para Codex — Futurama Maker

## Prioridade absoluta
Entregar HOJE o fluxo WhatsApp funcional: vídeo + manchete recebidos pela Evolution → template Tá Rolando → FFmpeg → MP4 devolvido ao remetente, com fila única e dashboard mínimo utilizável. **Funcionar vale mais que arquitetura elaborada.**

Leia `docs/01-mvp-whatsapp.md` e `docs/02-core-and-templates.md` antes de implementar. Use os demais documentos apenas quando entrar naquele módulo.

## Regras de execução
- Trabalhe em `dev`. Faça commits pequenos, com mensagens objetivas, e push automático ao concluir cada fatia funcional. Não crie branches adicionais. `main` é estável; só avance quando o fluxo principal estiver comprovado.
- **Sem homologação**, Docker/Kubernetes, microserviços, CI elaborado, filas externas ou serviços pagos se não forem necessários.
- **Sem IA**, inclusive sugestões de manchetes, análise de frames ou flag `-ia`.
- Não redesenhe o dashboard por conta própria. O usuário enviará um ZIP exportado pelo Stitch contendo HTML/CSS; siga a linguagem visual desse protótipo e adapte somente o indispensável para os recursos especificados. Se o ZIP ainda não estiver disponível, construa uma UI funcional discreta, sem inventar controles; ajuste a estética depois.
- Prefira Node.js + TypeScript, SQLite, Sharp e FFmpeg/FFprobe no sistema; escolha bibliotecas simples e mantenha dependências reduzidas.
- Paralelize apenas tarefas de arquivos/módulos independentes (parser, renderer, banco, integração, UI). Defina contratos primeiro. Evite agentes mexendo nos mesmos arquivos e evite sessões de contexto gigantes.
- Se um comando, tool ou sessão falhar repetidamente, pare de insistir no mesmo caminho: registre o erro, reduza o escopo e tente uma abordagem alternativa. Não gaste tempo refazendo configuração de infraestrutura que já funciona.
- Testes focados: parser de flags, geometria de contain/cover, título longo, um teste de render com FFmpeg e um fluxo simulado Evolution. Não criar suíte gigantesca.
- Não finja sucesso: prove um MP4 gerado e um ciclo de webhook/resposta (com integração real ou mock identificado). Informe claramente o que falta configurar.
- Não publique API keys, telefones reais, mídia ou senhas operacionais. Use `.env.example`. Trate webhook idempotente e registre eventos sem segredos.
- Não amplie o escopo. Diante de escolha não definida, implemente a solução mais direta e documente brevemente.

## Ordem recomendada
1. `packages/commands`, `packages/templates`, `packages/core` com contrato reutilizável;
2. ingestão Evolution + download + entrega; 
3. fila única + sessões + SQLite;
4. dashboard de instâncias, telefones, templates, jobs e logs;
5. refinamento visual segundo o ZIP do Stitch.

## Entrega/relato
Ao concluir cada etapa: arquivos alterados, teste executado, commit SHA, branch e bloqueio real (se houver). Sem relatórios longos, auditorias genéricas ou revisões de componentes não tocados.
