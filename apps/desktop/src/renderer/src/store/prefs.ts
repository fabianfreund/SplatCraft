/**
 * User preferences: appearance + workspace layout. Applied to <html> as
 * data attributes and CSS variables (see styles/tokens.css), persisted per user.
 */
import { create } from 'zustand';
import { load, save } from './persist';

export type ThemePref = 'dark' | 'light' | 'system';
export type Density = 'compact' | 'default' | 'comfortable';
export type TextScale = 'sm' | 'md' | 'lg';
/** Which hardware meters the status bar shows ('auto' = essential in Simple, all in Advanced). */
export type DockMeters = 'auto' | 'essential' | 'all';

export interface Prefs {
  theme: ThemePref;
  accent: string;
  density: Density;
  textScale: TextScale;
  reduceMotion: boolean;
  /** Solid surfaces instead of frosted glass. */
  reduceTransparency: boolean;
  dockMeters: DockMeters;
  /** Panel widths in px (undefined = density default). */
  railW?: number;
  drawerW?: number;
  /** Raw token overrides from an imported theme, e.g. { "--sc-bg": "#000" }. */
  tokens: Record<string, string>;
}

export const ACCENTS = [
  { id: 'teal', label: 'Teal', value: '#6cc3b5' },
  { id: 'blue', label: 'Blue', value: '#7fa6e3' },
  { id: 'violet', label: 'Violet', value: '#a59ae0' },
  { id: 'rose', label: 'Rose', value: '#d79ab4' },
  { id: 'amber', label: 'Amber', value: '#d9a86c' },
  { id: 'sage', label: 'Sage', value: '#9fbd85' },
] as const;

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  accent: ACCENTS[0].value,
  density: 'default',
  textScale: 'md',
  reduceMotion: false,
  reduceTransparency: false,
  dockMeters: 'auto',
  tokens: {},
};

export const PANEL_LIMITS = { rail: [232, 380], drawer: [280, 520] } as const;

const TEXT_SCALE: Record<TextScale, number> = { sm: 0.92, md: 1, lg: 1.1 };
const TOKEN_RE = /^--sc-[a-z0-9-]+$/;

interface PrefsState extends Prefs {
  set(patch: Partial<Prefs>): void;
  reset(): void;
  /** JSON theme (accent + token overrides) for sharing. */
  exportTheme(): string;
  /** Accepts { accent?, theme?, tokens? } or a flat { "--sc-…": value } map. Returns the number of tokens applied. */
  importTheme(json: string): number;
}

const stored = load<Partial<Prefs>>('prefs', {});

export const usePrefs = create<PrefsState>()((set, get) => ({
  ...DEFAULT_PREFS,
  ...stored,
  tokens: { ...(stored.tokens ?? {}) },
  set(patch) {
    set(patch);
    persist(get());
  },
  reset() {
    set({ ...DEFAULT_PREFS, dockMeters: get().dockMeters, railW: undefined, drawerW: undefined });
    persist(get());
  },
  exportTheme() {
    const { theme, accent, tokens } = get();
    return JSON.stringify({ name: 'My SplatCraft theme', theme, accent, tokens }, null, 2);
  },
  importTheme(json) {
    const raw = JSON.parse(json) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Not a theme object.');
    const src = (raw.tokens && typeof raw.tokens === 'object' ? raw.tokens : raw) as Record<string, unknown>;
    const tokens: Record<string, string> = {};
    for (const [k, v] of Object.entries(src)) if (TOKEN_RE.test(k) && typeof v === 'string' && !/[;{}]/.test(v)) tokens[k] = v;
    const patch: Partial<Prefs> = { tokens };
    if (typeof raw.accent === 'string' && isHex(raw.accent)) patch.accent = raw.accent;
    if (raw.theme === 'dark' || raw.theme === 'light' || raw.theme === 'system') patch.theme = raw.theme;
    if (!Object.keys(tokens).length && !patch.accent && !patch.theme) throw new Error('No theme values found (expected "accent", "theme" or --sc-* tokens).');
    get().set(patch);
    return Object.keys(tokens).length;
  },
}));

let persistTimer: number | undefined;
function persist(s: PrefsState) {
  // Debounced: panel drags and the color well call set() on every move.
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => write(s), 250);
}
function write(s: PrefsState) {
  const { theme, accent, density, textScale, reduceMotion, reduceTransparency, dockMeters, railW, drawerW, tokens } = s;
  save('prefs', { theme, accent, density, textScale, reduceMotion, reduceTransparency, dockMeters, railW, drawerW, tokens });
}

/* ── Applying prefs to the document ─────────────────────────────────────── */

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : undefined;

export function resolvedTheme(p: Pick<Prefs, 'theme'>): 'dark' | 'light' {
  return p.theme === 'system' ? (media?.matches ? 'light' : 'dark') : p.theme;
}

let appliedTokens: string[] = [];
let lastColorKey = '';

export function applyPrefs(p: Prefs) {
  const root = document.documentElement;
  const theme = resolvedTheme(p);
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'dark');
  root.dataset.density = p.density;
  root.dataset.motion = p.reduceMotion ? 'reduced' : 'full';
  root.dataset.glass = p.reduceTransparency ? 'off' : 'on';

  const accent = isHex(p.accent) ? p.accent : DEFAULT_PREFS.accent;
  // Light surfaces need a deeper accent for legible text and fills.
  const shown = theme === 'light' ? deepen(accent, 3.2) : accent;
  root.style.setProperty('--sc-accent', shown);
  root.style.setProperty('--sc-accent-ink', inkFor(shown));
  root.style.setProperty('--sc-text-scale', String(TEXT_SCALE[p.textScale]));
  root.style.setProperty('--sc-rail-w', p.railW ? `${p.railW}px` : '');
  root.style.setProperty('--sc-drawer-w', p.drawerW ? `${p.drawerW}px` : '');

  for (const k of appliedTokens) if (!(k in p.tokens)) root.style.removeProperty(k);
  for (const [k, v] of Object.entries(p.tokens)) root.style.setProperty(k, v);
  appliedTokens = Object.keys(p.tokens);

  // Only colour changes concern the 3D viewer (it rebuilds its grid).
  const colorKey = `${theme}|${shown}|${JSON.stringify(p.tokens)}`;
  if (colorKey !== lastColorKey) {
    lastColorKey = colorKey;
    window.dispatchEvent(new Event('sc-theme-change'));
  }
}

/** Subscribes the document to prefs (and the OS theme when theme = system). */
export function bindPrefs() {
  applyPrefs(usePrefs.getState());
  const off = usePrefs.subscribe((s) => applyPrefs(s));
  const onOs = () => usePrefs.getState().theme === 'system' && applyPrefs(usePrefs.getState());
  media?.addEventListener('change', onOs);
  return () => {
    off();
    media?.removeEventListener('change', onOs);
  };
}

/* ── Color helpers ──────────────────────────────────────────────────────── */

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);
}
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;
}
function luminance(c: [number, number, number]): number {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** Text color on an accent fill: near-black tint or white, whichever reads better. */
export function inkFor(accent: string): string {
  const c = rgb(accent);
  const dark = hex(c.map((v) => v * 0.12) as [number, number, number]);
  return contrast(c, rgb(dark)) >= contrast(c, [255, 255, 255]) ? dark : '#ffffff';
}
/** Darkens a color until it reaches `min` contrast against white. */
function deepen(accent: string, min: number): string {
  let c = rgb(accent);
  for (let i = 0; i < 20 && contrast(c, [255, 255, 255]) < min; i++) c = c.map((v) => v * 0.92) as [number, number, number];
  return hex(c);
}
