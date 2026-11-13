# 04 — Dashboard e diagnóstico operacional

## Design system: única referência visual
O **único guia de design** é a skill de design system disponibilizada no ambiente do Codex. Antes de criar componentes ou estilos, localizar, ler e seguir integralmente suas instruções e referências pertinentes: tokens, cores, tipografia, espaçamentos, componentes, estados, contraste e padrões de navegação. **Não usar Stitch, ZIP, templates visuais externos, estilos arbitrários ou inferência criativa de recursos.** Esta spec define somente telas e comportamentos; a skill define a apresentação.

Todas as telas, rótulos, mensagens, estados e erros devem estar em **português brasileiro (pt-BR)**. Não acrescentar controles, páginas, gráficos ou ações que não estejam especificados aqui apenas porque a skill oferece componentes prontos. Se a skill estiver indisponível, priorizar uma UI funcional básica, registrar a ausência e aguardar a referência visual; não inventar um design system.

## Telas estritamente necessárias
1. **Visão geral:** conectividade das instâncias, jobs em fila/processamento/concluídos/com erro, disco ocupado por mídias, uso atual aproximado de CPU/RAM do processo e último erro.
2. **Instâncias Evolution:** URL, nome, chave (entrada mascarada), status, QR Code, conectar/desconectar, template padrão.
3. **Telefones:** nome, número autorizado, ativo/inativo e vínculos com instâncias.
4. **Templates:** lista/edição de configuração e logo; template inicial Tá Rolando. Não construir editor tipo Canva neste MVP.
5. **Fila/Jobs:** listagem filtrável por data/status/instância/telefone; status atual, duração, espera, entrada/saída, identificação do job.
6. **Detalhe do job:** linha do tempo com eventos e tempos por etapa, tamanhos, códigos de erro e trechos seguros de stderr/FFmpeg, progresso disponível.
7. **Configurações:** parâmetros locais de FFmpeg, retenção de arquivos, limites de vídeo, credenciais operacionais e vinculação Evolution.

Não inventar finanças, cobrança, publicação em redes sociais, notificações push nem analytics complexos.

## Telemetria mínima por job
Registrar `job_id`, `session_id`, `message_id` (somente identificação técnica), `instance_id`, template, dimensão/FPS/duração original, dimensões de saída, inputBytes/outputBytes, tempo total, tempo de espera e tempo gasto em cada estágio:
`webhook → autorização → download → ffprobe → título → fila → overlay PNG → FFmpeg → envio → confirmação`.

Nos logs:
- timestamp UTC ISO; nível (`info/warn/error`); estágio; duração ms; código de falha; status da requisição Evolution quando aplicável; mensagem sanitizada.
- FFmpeg: linhas de diagnóstico relevantes, exit code, frames processados, velocidade FPS/tempo de render, consumo observado (CPU/memória do processo quando viável).
- Recursos do host: CPU/RAM aproximados, espaço de disco e tamanho da fila, snapshots durante o processamento.
- Uso de rede/armazenamento: bytes baixados, gerados e enviados. Não há custo de IA (proibida) nem API de compressão.
- Cada falha deve deixar claro **em qual etapa ocorreu**, o erro técnico e uma mensagem curta para atendimento.

## Cuidados para logs serem úteis
Não registrar senhas, tokens, API keys, payloads inteiros, base64, arquivos de vídeo, manchetes privadas ou nomes reais desnecessários em logs públicos. Telefone mascarado na interface padrão quando apropriado; identificador de job permite localizar caso. Evitar explosão de eventos: persistir transições e erros, manter progresso FFmpeg em memória ou amostrado.

## Critério de diagnóstico
Recebendo o ID do vídeo com erro, operador encontra em até poucos cliques: remetente/instância, posição na fila, etapa exata, duração, último evento, saída FFmpeg/Evolution relevante e consumo aproximado. Não exigir SSH para entender a falha comum.
