export type Alignment = {
  vertical?: { direction: 'top' | 'bottom'; percent: number };
  horizontal?: { direction: 'left' | 'right'; percent: number };
};

export type ParsedCommand = {
  headline: string;
  alignment: Alignment;
  grayscale: boolean;
  warnings: string[];
};

export class CommandParseError extends Error {
  readonly code = 'INVALID_COMMAND';
  constructor(message: string) { super(message); this.name = 'CommandParseError'; }
}

/** Parse literal command flags from a WhatsApp caption. Flag tokens are removed before returning the title. */
export function parseCommand(input: string): ParsedCommand {
  const tokens = input.trim().split(/\s+/u).filter(Boolean);
  const title: string[] = [];
  const vertical: Array<{ direction: 'top' | 'bottom'; percent: number }> = [];
  const horizontal: Array<{ direction: 'left' | 'right'; percent: number }> = [];
  let grayscale = false;

  for (const token of tokens) {
    if (!token.startsWith('-')) { title.push(token); continue; }
    if (token === '-pb') { grayscale = true; continue; }
    const match = /^-(top|bottom|left|right)(\d*)$/iu.exec(token);
    if (!match) throw new CommandParseError(`Comando inválido: ${token}. Use -top, -bottom30, -left5, -right ou -pb.`);
    const direction = match[1].toLowerCase() as 'top' | 'bottom' | 'left' | 'right';
    const percent = match[2] ? Number(match[2]) : 100;
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
      throw new CommandParseError(`Valor inválido em ${token}. Informe um número de 1 a 100.`);
    }
    if (direction === 'top' || direction === 'bottom') vertical.push({ direction, percent });
    else horizontal.push({ direction, percent });
  }

  const warnings: string[] = [];
  const resolve = <T extends { direction: string }>(items: T[], first: string, second: string, axis: string): T | undefined => {
    if (items.some((item) => item.direction === first) && items.some((item) => item.direction === second)) {
      warnings.push(`As flags ${first} e ${second} foram usadas juntas; prevaleceu ${first}.`);
    }
    return items.find((item) => item.direction === first) ?? items.find((item) => item.direction === second);
  };
  const v = resolve(vertical, 'top', 'bottom', 'vertical');
  const h = resolve(horizontal, 'left', 'right', 'horizontal');
  const headline = title.join(' ').trim();
  return {
    headline,
    alignment: { ...(v ? { vertical: v as Alignment['vertical'] } : {}), ...(h ? { horizontal: h as Alignment['horizontal'] } : {}) },
    grayscale,
    warnings,
  };
}
