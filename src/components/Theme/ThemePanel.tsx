import { useRef } from 'react';
import { X, Moon, Sun, SunMoon } from 'lucide-react';
import { useThemeStore, ACCENT_PRESETS, BG_PRESETS, hexToOklch, type ThemeMode } from '@/store/theme';

const THEMES: { id: ThemeMode; label: string; Icon: React.ElementType }[] = [
  { id: 'dark',  label: 'Ciemny',        Icon: Moon    },
  { id: 'dim',   label: 'Przyciemniony', Icon: SunMoon },
  { id: 'light', label: 'Jasny',         Icon: Sun     },
];

interface ThemePanelProps {
  onClose: () => void;
}

function ColorSwatch({
  value, selected, title, onClick,
}: { value: string; selected: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`relative h-7 w-7 rounded-full transition-all duration-150 hover:scale-110 ${
        selected
          ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-neutral-900'
          : 'ring-1 ring-white/20'
      }`}
      style={{ background: value }}
    />
  );
}

export function ThemePanel({ onClose }: ThemePanelProps) {
  const { mode, accent, bg, setMode, setAccent, setBg } = useThemeStore();
  const accentColorRef = useRef<HTMLInputElement>(null);
  const bgColorRef = useRef<HTMLInputElement>(null);

  const handleCustomAccent = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAccent(hexToOklch(e.target.value));
  };

  const handleCustomBg = (e: React.ChangeEvent<HTMLInputElement>) => {
    setBg(hexToOklch(e.target.value));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-80 rounded-2xl border border-neutral-700/60 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 className="text-sm font-semibold text-neutral-100">Wygląd</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
          >
            <X size={15} />
          </button>
        </div>

        <div className="space-y-5 p-5">
          {/* Mode */}
          <div>
            <p className="mb-2.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">Tryb</p>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map(({ id, label, Icon }) => {
                const active = mode === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setMode(id)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 text-xs font-medium transition-all duration-150 ${
                      active
                        ? 'border-blue-500/50 bg-blue-600/15 text-blue-400'
                        : 'border-neutral-700/60 text-neutral-400 hover:border-neutral-600 hover:bg-neutral-800/50 hover:text-neutral-200'
                    }`}
                  >
                    <Icon size={16} strokeWidth={active ? 2 : 1.5} />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Accent */}
          <div>
            <p className="mb-2.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">Akcent</p>
            <div className="flex flex-wrap gap-2">
              {ACCENT_PRESETS.map((p) => (
                <ColorSwatch
                  key={p.value}
                  value={p.value}
                  selected={accent === p.value}
                  title={p.name}
                  onClick={() => setAccent(p.value)}
                />
              ))}
              <button
                type="button"
                title="Kolor niestandardowy"
                onClick={() => accentColorRef.current?.click()}
                className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-neutral-600 text-[11px] text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-300"
              >
                +
                <input
                  ref={accentColorRef}
                  type="color"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={handleCustomAccent}
                  tabIndex={-1}
                />
              </button>
            </div>
          </div>

          {/* Background — only applies in dark mode */}
          <div className={mode !== 'dark' ? 'opacity-40' : ''}>
            <div className="mb-2.5 flex items-baseline gap-2">
              <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Tło</p>
              {mode !== 'dark' && (
                <span className="text-[10px] text-neutral-600">tylko w trybie ciemnym</span>
              )}
            </div>
            <div className={`flex flex-wrap gap-2 ${mode !== 'dark' ? 'pointer-events-none' : ''}`}>
              {BG_PRESETS.map((p) => (
                <ColorSwatch
                  key={p.value}
                  value={p.value}
                  selected={bg === p.value}
                  title={p.name}
                  onClick={() => setBg(p.value)}
                />
              ))}
              <button
                type="button"
                title="Kolor niestandardowy"
                onClick={() => bgColorRef.current?.click()}
                className="relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-dashed border-neutral-600 text-[11px] text-neutral-500 transition-colors hover:border-neutral-400 hover:text-neutral-300"
              >
                +
                <input
                  ref={bgColorRef}
                  type="color"
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  onChange={handleCustomBg}
                  tabIndex={-1}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
