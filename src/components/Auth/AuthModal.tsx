import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { validateEmail, validatePassword } from './validation';

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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-neutral-900 border border-neutral-700 rounded-lg p-6 w-96 shadow-2xl">
        <div className="flex gap-1 mb-5 border-b border-neutral-700">
          <button
            type="button"
            className={`pb-2 px-1 text-sm transition-colors ${
              tab === 'login'
                ? 'border-b-2 border-blue-500 text-neutral-100 font-medium'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
            onClick={() => { setTab('login'); setError(null); }}>
            Login
          </button>
          <button
            type="button"
            className={`pb-2 px-1 text-sm transition-colors ${
              tab === 'signup'
                ? 'border-b-2 border-blue-500 text-neutral-100 font-medium'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
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
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
            autoComplete="email"
          />
          <input
            type="password"
            placeholder="Password (min 8)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-blue-500 transition-colors"
            autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
          />
          {error && <p className="text-red-400 text-xs" role="alert">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs border border-neutral-700 text-neutral-400 rounded hover:bg-neutral-800 hover:text-neutral-200 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              {busy ? '…' : tab === 'login' ? 'Login' : 'Create account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
