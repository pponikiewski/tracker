import { create } from 'zustand';

export type ThemeMode = 'dark' | 'dim' | 'light';

export const ACCENT_PRESETS = [
  { name: 'Niebieski',     value: 'oklch(52.7% 0.2 261.3)' },
  { name: 'Fioletowy',    value: 'oklch(52% 0.24 300)'     },
  { name: 'Zielony',      value: 'oklch(52% 0.18 152)'     },
  { name: 'Pomarańczowy', value: 'oklch(60% 0.19 50)'      },
  { name: 'Różowy',       value: 'oklch(58% 0.22 340)'     },
  { name: 'Cyjan',        value: 'oklch(58% 0.16 200)'     },
];

// neutral-950 base colors; scale is auto-generated from these
export const BG_PRESETS = [
  { name: 'Czarny',   value: 'oklch(10.3% 0.004 286)' },  // default
  { name: 'Granat',   value: 'oklch(12% 0.03 240)'    },
  { name: 'Fiolet',   value: 'oklch(11% 0.04 290)'    },
  { name: 'Leśny',    value: 'oklch(11% 0.03 150)'    },
  { name: 'Burgund',  value: 'oklch(11% 0.04 15)'     },
  { name: 'Szary',    value: 'oklch(13% 0.002 286)'   },
];

// Lightness offsets for each neutral shade above neutral-950
const SHADE_OFFSETS: Record<string, number> = {
  '950': 0, '900': 4, '800': 10, '700': 18,
  '600': 28, '500': 40, '400': 52, '300': 62, '200': 70, '100': 78,
};

function parseOklch(v: string): { l: number; c: number; h: number } | null {
  const m = v.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/);
  if (!m) return null;
  const l = m[1] !== undefined ? parseFloat(m[1]) : NaN;
  const c = m[2] !== undefined ? parseFloat(m[2]) : NaN;
  const h = m[3] !== undefined ? parseFloat(m[3]) : NaN;
  if (isNaN(l) || isNaN(c) || isNaN(h)) return null;
  return { l, c, h };
}

function applyBgScale(base: string) {
  const parsed = parseOklch(base);
  if (!parsed) return;
  const { l, c, h } = parsed;
  for (const [shade, offset] of Object.entries(SHADE_OFFSETS)) {
    const lv = Math.min(100, Math.max(0, l + offset));
    document.documentElement.style.setProperty(
      `--color-neutral-${shade}`,
      `oklch(${lv.toFixed(1)}% ${c.toFixed(4)} ${h.toFixed(1)})`,
    );
  }
}

function applyAccent(accent: string) {
  document.documentElement.style.setProperty('--color-blue-600', accent);
  const shiftL = (v: string, d: number) => {
    const m = v.match(/(\d+\.?\d*)%/);
    const cap = m?.[1];
    const l = cap !== undefined ? parseFloat(cap) : 50;
    return v.replace(/\d+\.?\d*%/, `${Math.min(100, Math.max(0, l + d)).toFixed(1)}%`);
  };
  document.documentElement.style.setProperty('--color-blue-300', shiftL(accent, +24));
  document.documentElement.style.setProperty('--color-blue-400', shiftL(accent, +15));
  document.documentElement.style.setProperty('--color-blue-500', shiftL(accent, +8));
  document.documentElement.style.setProperty('--color-blue-700', shiftL(accent, -7));
  document.documentElement.style.setProperty('--color-blue-800', shiftL(accent, -15));
  document.documentElement.style.setProperty('--color-blue-900', shiftL(accent, -22));
}

function clearBgScale() {
  for (const shade of Object.keys(SHADE_OFFSETS)) {
    document.documentElement.style.removeProperty(`--color-neutral-${shade}`);
  }
}

function applyTheme(mode: ThemeMode, accent: string, bg: string) {
  document.documentElement.setAttribute('data-theme', mode);
  applyAccent(accent);
  if (mode === 'dark') {
    applyBgScale(bg);
  } else {
    clearBgScale();
  }
}

const DEFAULT_BG = BG_PRESETS[0]?.value ?? 'oklch(10.3% 0.004 286)';
const DEFAULT_ACCENT = ACCENT_PRESETS[0]?.value ?? 'oklch(52.7% 0.2 261.3)';

interface ThemeState {
  mode: ThemeMode;
  accent: string;
  bg: string;
  setMode: (mode: ThemeMode) => void;
  setAccent: (accent: string) => void;
  setBg: (bg: string) => void;
}

function load(): { mode: ThemeMode; accent: string; bg: string } {
  try {
    const s = localStorage.getItem('app-theme');
    if (s) {
      const p = JSON.parse(s) as Partial<{ mode: ThemeMode; accent: string; bg: string }>;
      return {
        mode: p.mode ?? 'dark',
        accent: p.accent ?? DEFAULT_ACCENT,
        bg: p.bg ?? DEFAULT_BG,
      };
    }
  } catch { /* ignore */ }
  return { mode: 'dark', accent: DEFAULT_ACCENT, bg: DEFAULT_BG };
}

function save(mode: ThemeMode, accent: string, bg: string) {
  try { localStorage.setItem('app-theme', JSON.stringify({ mode, accent, bg })); } catch { /* ignore */ }
}

const initial = load();
applyTheme(initial.mode, initial.accent, initial.bg);

export const useThemeStore = create<ThemeState>()((set, get) => ({
  mode: initial.mode,
  accent: initial.accent,
  bg: initial.bg,
  setMode: (mode) => {
    const { accent, bg } = get();
    applyTheme(mode, accent, bg);
    save(mode, accent, bg);
    set({ mode });
  },
  setAccent: (accent) => {
    const { mode, bg } = get();
    applyAccent(accent);
    save(mode, accent, bg);
    set({ accent });
  },
  setBg: (bg) => {
    const { mode, accent } = get();
    if (mode === 'dark') applyBgScale(bg);
    save(mode, accent, bg);
    set({ bg });
  },
}));

/** Convert #rrggbb to oklch(...) string */
export function hexToOklch(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
  const lc = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const mc = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const sc = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * lc + 0.793617785 * mc - 0.0040720468 * sc;
  const a = 1.9779984951 * lc - 2.4285922050 * mc + 0.4505937099 * sc;
  const bv = 0.0259040371 * lc + 0.7827717662 * mc - 0.8086757660 * sc;
  const C = Math.sqrt(a * a + bv * bv);
  const H = ((Math.atan2(bv, a) * 180 / Math.PI) + 360) % 360;
  return `oklch(${(L * 100).toFixed(1)}% ${C.toFixed(4)} ${H.toFixed(1)})`;
}
