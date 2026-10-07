/**
 * Minimal DOM helpers (no framework): element builder, raw SVG injection, toasts.
 */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  html?: string;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'on') {
        for (const [ev, fn] of Object.entries(v as Record<string, (e: Event) => void>))
          el.addEventListener(ev, fn);
      } else if (k === 'html') el.innerHTML = String(v);
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Wraps trusted, app-authored SVG markup (our own icons) in a span. */
export function svgIcon(svg: string, cls = 'icon'): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = cls;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = svg;
  return s;
}

export interface ButtonOpts {
  variant?: 'primary' | 'secondary' | 'blue' | 'ghost' | '';
  small?: boolean;
  wide?: boolean;
  icon?: string;
  disabled?: boolean;
  /** Ignore taps for this long after creation (accidental-tap guard for ad buttons, GDD §11.4). */
  armDelayMs?: number;
  label?: string;
  /** Smaller second line (e.g. "free", "+3 sheets"); the aria-label then reads "text · sub". */
  sub?: string;
}

export function button(text: string, onClick: () => void, opts: ButtonOpts = {}): HTMLButtonElement {
  const cls = ['btn', opts.variant ?? '', opts.small ? 'small' : '', opts.wide ? 'wide' : '']
    .filter(Boolean)
    .join(' ');
  const label = opts.label ?? (opts.sub ? `${text} · ${opts.sub}` : undefined);
  const b = h('button', { class: cls, type: 'button', 'aria-label': label });
  if (opts.icon) b.append(svgIcon(opts.icon));
  if (opts.sub)
    b.append(h('span', { class: 'lbl' }, h('span', null, text), h('span', { class: 'sub' }, opts.sub)));
  else b.append(h('span', null, text));
  if (opts.disabled) b.disabled = true;
  const armedAt = performance.now() + (opts.armDelayMs ?? 0);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (performance.now() < armedAt) return;
    onClick();
  });
  return b;
}

let toastTimer = 0;
export function toast(text: string, ms = 2200): void {
  const host = document.getElementById('toast');
  if (!host) return;
  host.replaceChildren(h('div', { class: 'toast', role: 'status' }, text));
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host.replaceChildren(), ms);
}

export function announce(text: string): void {
  const el = document.getElementById('sr-live');
  if (!el) return;
  el.textContent = '';
  // Re-set on the next frame so screen readers announce repeated messages.
  requestAnimationFrame(() => (el.textContent = text));
}

export function toggle(checked: boolean, onChange: (v: boolean) => void, label: string): HTMLButtonElement {
  const t = h('button', {
    class: 'toggle',
    type: 'button',
    role: 'switch',
    'aria-checked': String(checked),
    'aria-label': label,
  });
  t.addEventListener('click', () => {
    const v = t.getAttribute('aria-checked') !== 'true';
    t.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return t;
}

export function segmented<T extends string>(
  options: Array<{ value: T; label: string }>,
  value: T,
  onChange: (v: T) => void,
): HTMLDivElement {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const buttons = options.map((o) => {
    const b = h('button', { type: 'button', 'aria-pressed': String(o.value === value) }, o.label);
    b.addEventListener('click', () => {
      for (const x of buttons) x.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      onChange(o.value);
    });
    return b;
  });
  wrap.append(...buttons);
  return wrap;
}
