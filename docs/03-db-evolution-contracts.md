# 03 — SQLite, Evolution e contratos mínimos

## Persistência SQLite
Usar SQLite em WAL e migrations pequenas. Estrutura mínima:

```text
templates(id, name, slug UNIQUE, config_json, logo_path, active, created_at, updated_at)
evolution_instances(id, display_name, base_url, instance_name, api_key, default_template_id, status, created_at, updated_at)
authorized_numbers(id, phone_e164 UNIQUE, display_name, active, created_at, updated_at)
authorized_number_instances(number_id, instance_id, PRIMARY KEY(number_id,instance_id))
sessions(id, instance_id, phone_e164, state, payload_json, expires_at, created_at, updated_at)
jobs(id, session_id, instance_id, template_id, phone_e164, input_path, output_path, title_original, title_final, flags_raw, config_json, status, error_stage, error_code, created_at, started_at, finished_at)
job_events(id, job_id, stage, level, message, meta_json, created_at)
inbound_messages(instance_id, provider_message_id, received_at, PRIMARY KEY(instance_id,provider_message_id))
```

Como o template padrão vem da instância, o relacionamento telefone-instância controla o acesso. Permitir futuramente associação explícita de vários templates ao telefone, mas não criar menu de seleção de template no WhatsApp do MVP.

`job_events` serve como trilha durável de troubleshooting; os logs completos e métricas temporárias podem ficar em arquivos rotativos, com referência a `job_id`.

## Integração Evolution
Criar um único adapter `EvolutionClient` com:
- `getStatus(instance)`
- `getConnectionQr(instance)`
- `connect/disconnect(instance)`
- `downloadIncomingMedia(event)`
- `sendText(instance, phone, text)`
- `sendVideo(instance, phone, path, caption?)`

Endpoints e payloads exatos dependem da versão da Evolution instalada. Isolar essa diferença no adapter e testar com a instância real. Webhook recebe eventos autenticados conforme mecanismo disponível na instalação, verifica instância, tipo, messageId, origem e autorizados; descarta duplicatas. Nunca armazenar o media base64 no banco.

## API interna do dashboard
Rotas REST mínimas (podem mudar nomes, mas manter responsabilidades):
- `POST /api/login`, `POST /api/logout`; sessão local simples.
- `GET/POST/PUT /api/templates`.
- `GET/POST/PUT /api/instances`, `POST /api/instances/:id/connect`, `POST /api/instances/:id/disconnect`, `GET /api/instances/:id/qr`.
- `GET/POST/PUT /api/authorized-numbers`; gerenciar vínculos com instâncias.
- `GET /api/jobs`, `GET /api/jobs/:id`, `GET /api/jobs/:id/events`, `GET /api/metrics`.
- `POST /webhooks/evolution/:instanceId` apenas para entrada Evolution.
- `GET /health` para processo/API/SQLite/FFmpeg disponíveis.

Não criar painel público. Login inicial de operação: `admin` / `123456` por configuração de bootstrap, com senha salva por hash e opção de alterá-la. Não expor essa credencial como valor fixo num deployment aberto; não incluir API keys reais no Git.

## Arquivos e retenção
`data/templates/`, `data/input/`, `data/output/`, `data/logs/` fora de git, com limpeza de arquivos temporários e outputs antigos após período configurável. Conservar metadados e eventos dos jobs após apagar mídia. Limitar uploads e validar caminhos/formatos; usar execução de FFmpeg via argumentos, nunca shell concatenada a partir de legenda.

## Sessões/fila
Chave lógica: `instance_id + phone_e164`. Uma sessão ativa por chave. Pedidos elegíveis entram FIFO em fila global com worker concurrency 1. Persistir `queued/running`; na reinicialização, recuperar `queued` e marcar job interrompido para retomada segura ou falha informativa (não duplicar envio).
