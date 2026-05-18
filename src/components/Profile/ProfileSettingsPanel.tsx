import { useState, useRef, useEffect } from 'react';
import { useProfileStore } from '@/store/profile';
import { useAuthStore } from '@/store/auth';
import { validateDisplayName } from '@/lib/profile/profileService';
import { validateAvatarFile } from '@/lib/profile/avatarService';
import { AvatarBadge } from '@/components/Profile/AvatarBadge';

const AVATAR_COLOR_PALETTE = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#ec4899',
];

interface ProfileSettingsPanelProps {
  onClose: () => void;
}

/**
 * Slide-in panel for editing the current user's display name and avatar.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 9.3
 */
export function ProfileSettingsPanel({ onClose }: ProfileSettingsPanelProps) {
  const authState = useAuthStore((s) => s.state);
  const userId = authState.kind === 'authed' ? authState.user.id : null;
  const userEmail = authState.kind === 'authed' ? (authState.user.email ?? '') : '';

  const getProfile = useProfileStore((s) => s.getProfile);
  const updateDisplayName = useProfileStore((s) => s.updateDisplayName);
  const uploadAvatar = useProfileStore((s) => s.uploadAvatar);
  const clearAvatar = useProfileStore((s) => s.clearAvatar);
  const setAvatarColor = useProfileStore((s) => s.setAvatarColor);

  // Derive current profile (cached or fallback)
  const profile = userId ? getProfile(userId) : null;

  // ---- Display name state ----
  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameSubmitError, setNameSubmitError] = useState<string | null>(null);

  // Keep display name field in sync when profile loads/changes
  useEffect(() => {
    if (profile?.display_name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize editable draft from cached profile
      setDisplayName(profile.display_name);
    }
  }, [profile?.display_name]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ---- Avatar state ----
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Handlers ----

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDisplayName(val);
    // Live inline validation (Req 3.5)
    if (nameError) {
      try {
        validateDisplayName(val);
        setNameError(null);
      } catch (err) {
        setNameError((err as Error).message);
      }
    }
  };

  const handleNameBlur = () => {
    try {
      validateDisplayName(displayName);
      setNameError(null);
    } catch (err) {
      setNameError((err as Error).message);
    }
  };

  const handleNameSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // Client-side validation before any network request (Req 3.5)
    try {
      validateDisplayName(displayName);
    } catch (err) {
      setNameError((err as Error).message);
      return;
    }
    setNameError(null);
    setNameSubmitError(null);
    setNameSuccess(false);
    setNameBusy(true);

    try {
      await updateDisplayName(displayName);
      setNameSuccess(true);
      // Show success for at least 3 seconds (Req 3.4)
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (err) {
      setNameSubmitError((err as Error).message);
    } finally {
      setNameBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected after an error
    if (fileInputRef.current) fileInputRef.current.value = '';

    setAvatarError(null);

    // Client-side validation before upload (Req 3.6)
    try {
      await validateAvatarFile(file);
    } catch (err) {
      setAvatarError((err as Error).message);
      return;
    }

    // Upload (Req 3.7, 3.8, 3.9)
    setAvatarBusy(true);
    try {
      await uploadAvatar(file);
      // Success — the store updates the profile; AvatarBadge re-renders automatically
    } catch (err) {
      setAvatarError((err as Error).message);
    } finally {
      setAvatarBusy(false);
    }
  };

  const handleUploadClick = () => {
    if (!avatarBusy) {
      fileInputRef.current?.click();
    }
  };

  // Determine what to show when there is no authenticated user
  if (!userId) {
    return null;
  }

  // Fallback display values for offline / no-cache scenario (Req 9.3)
  const displayedName = profile?.display_name ?? userEmail.split('@')[0] ?? userId;
  const avatarUrl = profile?.avatar_url ?? null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-end z-50" onClick={onClose}>
      <div className="bg-neutral-900 border-l border-neutral-700 h-full w-full max-w-md shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-700 shrink-0">
          <h2 className="text-sm font-medium text-neutral-100">
            Ustawienia profilu
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none"
            aria-label="Zamknij"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* ---- Avatar section ---- */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Zdjęcie profilowe
            </h3>

            <div className="flex items-center gap-4">
              {/* Current avatar or fallback initials (Req 3.3) */}
              <AvatarBadge
                userId={userId}
                displayName={displayedName}
                avatarUrl={avatarUrl}
                size="md"
              />

              <div className="flex flex-col gap-1.5">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={avatarBusy}
                  aria-label="Wybierz zdjęcie profilowe"
                />

                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={handleUploadClick}
                    disabled={avatarBusy}
                    className="px-3 py-1.5 text-xs bg-neutral-700 text-neutral-200 rounded hover:bg-neutral-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                  >
                    {avatarBusy ? (
                      <>
                        <span className="inline-block h-3 w-3 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" aria-hidden="true" />
                        Przesyłanie…
                      </>
                    ) : (
                      'Zmień zdjęcie'
                    )}
                  </button>

                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        setAvatarError(null);
                        setAvatarBusy(true);
                        try {
                          await clearAvatar();
                        } catch (err) {
                          setAvatarError((err as Error).message);
                        } finally {
                          setAvatarBusy(false);
                        }
                      }}
                      disabled={avatarBusy}
                      className="px-3 py-1.5 text-xs border border-red-900 text-red-300 rounded hover:bg-red-950/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Usuń zdjęcie
                    </button>
                  )}
                </div>

                <p className="text-xs text-neutral-500">
                  JPEG, PNG lub WebP · maks. 256 KB · maks. 2048×2048 px
                </p>
              </div>
            </div>

            {avatarError && (
              <p className="text-red-400 text-xs mt-2" role="alert">
                {avatarError}
              </p>
            )}

            {/* Color picker — visible when no avatar uploaded */}
            {!avatarUrl && (
              <div className="mt-4">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
                  Kolor tła inicjałów
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {AVATAR_COLOR_PALETTE.map((color) => {
                    const active = (profile?.avatar_color ?? null) === color;
                    return (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        onClick={async () => {
                          setAvatarError(null);
                          try {
                            await setAvatarColor(color);
                          } catch (err) {
                            setAvatarError((err as Error).message);
                          }
                        }}
                        className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${active ? 'border-white' : 'border-transparent'}`}
                        style={{ backgroundColor: color }}
                        aria-label={`Wybierz kolor ${color}`}
                      />
                    );
                  })}
                  <button
                    type="button"
                    title="Domyślny (auto)"
                    onClick={async () => {
                      setAvatarError(null);
                      try {
                        await setAvatarColor(null);
                      } catch (err) {
                        setAvatarError((err as Error).message);
                      }
                    }}
                    className={`h-7 w-7 rounded-full border-2 border-dashed text-xs text-neutral-400 transition-colors hover:text-neutral-100 ${(profile?.avatar_color ?? null) === null ? 'border-white text-white' : 'border-neutral-600'}`}
                  >
                    A
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ---- Display name section ---- */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Nazwa wyświetlana
            </h3>

            <form onSubmit={handleNameSave} className="space-y-2">
              <div>
                {/* Pre-populated with current value (Req 3.2) */}
                <input
                  type="text"
                  value={displayName}
                  onChange={handleNameChange}
                  onBlur={handleNameBlur}
                  maxLength={100}
                  placeholder="Twoja nazwa"
                  className={`w-full bg-neutral-800 border rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none transition-colors ${
                    nameError
                      ? 'border-red-500 focus:border-red-400'
                      : 'border-neutral-700 focus:border-blue-500'
                  }`}
                  autoComplete="off"
                />
                {/* Inline validation error before network request (Req 3.5) */}
                {nameError && (
                  <p className="text-red-400 text-xs mt-1" role="alert">
                    {nameError}
                  </p>
                )}
              </div>

              {/* Network/server error (Req 1.7) */}
              {nameSubmitError && (
                <p className="text-red-400 text-xs" role="alert">
                  {nameSubmitError}
                </p>
              )}

              {/* Success confirmation for ≥ 3 s (Req 3.4) */}
              {nameSuccess && (
                <p className="text-green-400 text-xs">Nazwa została zapisana.</p>
              )}

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={nameBusy || !!nameError}
                  className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {nameBusy ? '…' : 'Zapisz'}
                </button>
              </div>
            </form>
          </section>

          {/* ---- Account info (read-only) ---- */}
          <section>
            <h3 className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-3">
              Konto
            </h3>
            <div className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2">
              <p className="text-xs text-neutral-400 mb-0.5">Adres email</p>
              <p className="text-sm text-neutral-200 truncate">{userEmail || '—'}</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
