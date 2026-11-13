# 02 — Núcleo compartilhado, flags, geometria e template inicial

## Contrato central
O motor não conhece WhatsApp nem Electron.

```ts
type Alignment = { vertical?: { direction: 'top'|'bottom'; percent: number }; horizontal?: { direction: 'left'|'right'; percent: number } };
type RenderRequest = {
  inputPath: string;
  outputPath: string;
  template: TemplateConfig;
  headline: string;
  alignment: Alignment;
  grayscale: boolean;
};
type RenderResult = { outputPath: string; width: number; height: number; durationSeconds: number; inputBytes: number; outputBytes: number };
```

Separar módulos:
- `packages/commands`: extrai título/flags e resolve conflitos; puro/testável.
- `packages/templates`: schema, validação de dimensões, assets e geração da moldura transparente (SVG + Sharp).
- `packages/core`: FFprobe, dimensões, cálculo geométrico, FFmpeg, progress/eventos e saída.
- `apps/whatsapp`: regras da conversa, Evolution, SQLite, fila e dashboard.

## Flags (sintaxe literal)
- `-top`, `-top1` … `-top100`; `-bottom`, `-bottom1` … `-bottom100`.
- `-left`, `-left1` … `-left100`; `-right`, `-right1` … `-right100`.
- Sem número = 100. Sem nenhuma flag de alinhamento = centralizado.
- `-pb`: apenas vídeo (principal e fundo), em tons de cinza; **não descolorir logo nem manchete**.
- A combinação de um eixo vertical com outro horizontal é válida.
- Se `top` + `bottom` coexistirem, prevalece `top`; avisar ao remetente e continuar.
- Se `left` + `right` coexistirem, prevalece `left`; avisar e continuar.
- Valores fora de 1..100 e flags desconhecidas: não tratá-los como parte do título; informar erro de comando com exemplo quando parecer flag inválida.
- **Não implementar `-ia` ou qualquer IA.**

## Sem alinhamento = cover
Preencher o retângulo de vídeo usando `scale=...:force_original_aspect_ratio=increase,crop=...`, centrado. Nenhuma distorção, sem blur.

## Com alinhamento = contain + blur
1. A mesma mídia ocupa o fundo da área, ampliada/cortada para preenchê-la, com desfoque FFmpeg.
2. A mídia em primeiro plano é redimensionada por `contain` (não cortar; não distorcer) e posicionada no espaço livre conforme as flags.
3. Em cada eixo não especificado, usar centro. Valores 1..100 deslocam percentualmente **do centro ao extremo**: 100 encosta na borda; se o vídeo ocupa todo aquele eixo, não há deslocamento visível.
4. Fórmula por eixo: `free = areaSize - foregroundSize`; centro `free/2`; para top/left: `position=(free/2)*(1-p/100)`; para bottom/right: `position=(free/2)*(1+p/100)`.
5. Aplicar `-pb` à composição de mídia (fundo+primeiro plano) antes de aplicar a moldura branca/colorida.
6. A geometria usa área de vídeo do template, **não a tela toda**.

## Output
Resolução do template: 1080×1350 (4:5), padrão H.264 + AAC em MP4, `yuv420p`, `+faststart`, áudio mantido quando disponível, preservar FPS até 30. Um único comando de codificação; não produzir MP4 intermediário desnecessário. Usar presets/CRF configuráveis com defaults razoáveis; priorizar compatibilidade no WhatsApp. Sem GPU obrigatória.

## Template inicial: Tá Rolando
Reproduzir visual do HTML fornecido pelo usuário:
- Fundo branco, largura 100%, aspecto 4:5.
- Header flex com padding proporcional ao original (16px 20px 8px em 540px de largura), logo 48×48, gap 12px; proporcionalmente dobrados no output 1080px.
- Logo original: `https://tarolandonacidade.com.br/wp-content/uploads/2023/10/logo.png`. Baixar/cadastrar como asset local uma vez; não depender de URL remota em cada render.
- Texto “Tá Rolando” preto, negrito; selo verificado azul #0095f6 com check branco.
- Manchete preta, negrito, CAIXA ALTA, alinhada à esquerda, emoji preservado, padding proporcional de 20px, inicial ~22px em 540px, line-height 1.25.
- Retângulo de mídia abaixo da manchete até o limite inferior. A altura da área de manchete pode variar pela quebra de linha; registrar geometria real no template/render.
- Gerar PNG de overlay em 1080×1350; área da mídia com alfa 0 (transparente); header/manchete opacos. Evitar a antiga caixa preta de mídia.
- Sem controles de vídeo, botões, player, “vídeo” no canto nem elementos inventados.

## Manchetes longas
Config do template define `maxWords`, `maxLines`, tamanho padrão/mínimo da fonte e altura mínima da mídia. Detectar excesso de palavras ou estouro visual; fluxo WhatsApp permite correção ou MANTER. Caso MANTER, ajustar deterministicamente fonte/altura do header para exibir o texto completo, priorizando não cortar palavras (mesmo à custa de fonte pequena). Registrar aviso no job se legibilidade ficar comprometida.

## Assets e extensibilidade
`TemplateConfig` em JSON versionado; logo/fonts no disco, só caminhos relativos validados. Não executar scripts enviados por templates. Preparar futuramente importação `.vtemplate` no desktop, **sem desenvolver instalador no MVP**.
