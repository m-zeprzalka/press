/**
 * Shared visual constants (GDD §14). Used by Pixi rendering, DOM CSS variables and build scripts.
 */

export const PAPER = 0xf2ecdf;
export const PAPER_SHADE = 0xe4dccb;
export const INK = 0x231f20;

/** Riso ink colours, index = core Ink (0 pink, 1 orange, 2 yellow, 3 teal, 4 blue). */
export const INKS = [0xff4fa3, 0xff7a2f, 0xffd31a, 0x00806c, 0x2f6fd6] as const;
/** Darker overprint shade per ink (misregistration layer). */
export const INKS_DARK = [0xc8327d, 0xc95518, 0xc79f00, 0x005446, 0x1d4a99] as const;
/** Text colour that reaches ≥4.5:1 on each ink (GDD §14.1 pairing table). */
export const ON_INK = [INK, INK, INK, INK, 0xffffff] as const;

export const BLIND_FACE = 0xfbf8f1;
export const LEAD_GREY = 0x8d8a86;
export const JAM_DARK = 0x3a3436;

export const RARITY = {
  common: 0x231f20,
  rare: 0x2f6fd6,
  legendary: 0xff4fa3,
} as const;

/** Colour-symbol glyphs per ink (GDD §17 "Symbole farb"). */
export const INK_SYMBOLS = ['●', '▲', '■', '◆', '✚'] as const;

export const FONT_DISPLAY = 'PRESS Display';

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

/** CSS custom properties for the DOM layer. */
export function cssVariables(): Record<string, string> {
  return {
    '--paper': hex(PAPER),
    '--paper-shade': hex(PAPER_SHADE),
    '--ink': hex(INK),
    '--ink-pink': hex(INKS[0]),
    '--ink-orange': hex(INKS[1]),
    '--ink-yellow': hex(INKS[2]),
    '--ink-teal': hex(INKS[3]),
    '--ink-blue': hex(INKS[4]),
    '--rare': hex(RARITY.rare),
    '--legendary': hex(RARITY.legendary),
  };
}
