/**
 * Facade over the hand-authored SVG icon set (src/ui/icons/**), with safe fallbacks.
 */
import type { ModifierId } from '../core/contracts';
import type { MatrixId } from '../core/matrices';
import { LOGO_SVG } from './icons/logo';
import { MODIFIER_ICONS } from './icons/modifiers';
import { PLATE_ICONS } from './icons/plates';
import { UI_ICONS } from './icons/ui';

let uidCounter = 0;
const nextUid = () => `i${(++uidCounter).toString(36)}`;

const BLANK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"></svg>';

export function plateIcon(id: MatrixId): string {
  const f = PLATE_ICONS[id];
  return f ? f(nextUid()) : BLANK;
}

export function modifierIcon(id: ModifierId): string {
  const f = MODIFIER_ICONS[id] as ((uid?: string) => string) | undefined;
  return f ? f(nextUid()) : BLANK;
}

export function uiIcon(name: string): string {
  const f = (UI_ICONS as Record<string, ((uid?: string) => string) | undefined>)[name];
  return f ? f(nextUid()) : BLANK;
}

export function logo(): string {
  return LOGO_SVG();
}
