import { useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { validateEmail, validatePassword } from './validation';

type Tab = 'login' | 'signup';

export function LoginPage() {
  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signupDone, setSignupDone] = useState(false);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);

  const switchTab = (t: Tab) => {
    setTab(t);
    setError(null);
    setSignupDone(false);
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
      if (tab === 'login') {
        await signIn(email, password);
      } else {
        await signUp(email, password);
        setSignupDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center bg-neutral-950">
      <div className="w-full max-w-sm">
        {/* Logo / app name */}
        <div className="mb-8 text-center">
          <span className="text-2xl font-bold tracking-tight text-neutral-100">tracker</span>
          <p className="mt-1 text-sm text-neutral-500">Time tracking for teams</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 shadow-2xl">
          {/* Tabs */}
          <div className="mb-5 flex gap-1 border-b border-neutral-800">
            <button
              type="button"
              className={`pb-2 px-2 text-sm font-medium transition-colors ${
                tab === 'login'
                  ? 'border-b-2 border-blue-500 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => switchTab('login')}
            >
              Log in
            </button>
            <button
              type="button"
              className={`pb-2 px-2 text-sm font-medium transition-colors ${
                tab === 'signup'
                  ? 'border-b-2 border-blue-500 text-neutral-100'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
              onClick={() => switchTab('signup')}
            >
              Sign up
            </button>
          </div>

          {signupDone ? (
            <div className="py-4 text-center">
              <p className="text-sm text-neutral-200">Check your email to confirm your account.</p>
              <button
                type="button"
                className="mt-4 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                onClick={() => switchTab('login')}
              >
                Back to log in
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-blue-500 focus:outline-none"
                autoComplete="email"
                autoFocus
              />
              <input
                type="password"
                placeholder={tab === 'login' ? 'Password' : 'Password (min 8 chars)'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 transition-colors focus:border-blue-500 focus:outline-none"
                autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              />
              {error && (
                <p className="text-xs text-red-400" role="alert">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? '…' : tab === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
