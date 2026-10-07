/**
 * PRESS icon set: original two-ink risograph SVGs authored in code (GDD §14).
 *
 *   el.innerHTML = PLATE_ICONS.roller('rack-2');        // inline (uid namespaces pattern ids)
 *   img.src = svgDataUri(UI_ICONS.pause());             // <img> / CSS / Pixi texture
 */
export { C as ICON_COLORS, svgDataUri, type IconFn } from './kit';
export { PLATE_ICONS, inkSymbolPath } from './plates';
export { MODIFIER_ICONS } from './modifiers';
export { UI_ICONS, type UiIconId } from './ui';
export { LOGO_SVG, LOGO_WIDTH, LOGO_HEIGHT, type LogoOptions } from './logo';
export {
  APP_ICON_SVG,
  APP_ICON_FOREGROUND_SVG,
  APP_ICON_BACKGROUND_SVG,
  APP_ICON_MONOCHROME_SVG,
  APP_ICON_MASKABLE_SVG,
} from './app-icon';
