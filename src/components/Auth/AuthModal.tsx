import { useState } from 'react';
import { useAuthStore } from '@/store/auth';

type Tab = 'login' | 'signup';

interface Props { onClose: () => void; }

export function AuthModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const validateEmail = (v: string): string | null => {
    if (!v.includes('@')) return 'Email must contain @';
    if (v.length > 254) return 'Email must be 254 characters or fewer';
    return null;
  };

  const validatePassword = (v: string): string | null => {
    if (v.length < 8) return 'Password must be at least 8 characters';
    if (v.length > 128) return 'Password must be 128 characters or fewer';
    return null;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const emailErr = validateEmail(email);
    if (emailErr) { setError(emailErr); return; }
    const pwErr = validatePassword(password);
    if (pwErr) { setError(pwErr); return; }
    setBusy(true);
    try {
      if (tab === 'login') await signIn(email, password);
      else await signUp(email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96 shadow-xl">
        <div className="flex gap-4 mb-4 border-b">
          <button
            type="button"
            className={`pb-2 ${tab === 'login' ? 'border-b-2 border-blue-500 font-medium' : ''}`}
            onClick={() => { setTab('login'); setError(null); }}>
            Login
          </button>
          <button
            type="button"
            className={`pb-2 ${tab === 'signup' ? 'border-b-2 border-blue-500 font-medium' : ''}`}
            onClick={() => { setTab('signup'); setError(null); }}>
            Sign up
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded px-3 py-2"
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded px-3 py-2"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <p className="text-red-600 text-sm" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-3 py-1 border rounded text-sm">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
              {busy ? '…' : tab === 'login' ? 'Login' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
