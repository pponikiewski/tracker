export function authErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Wystąpił nieznany błąd.';

  const message = err.message.toLowerCase();
  if (message.includes('invalid login credentials')) {
    return 'Nieprawidłowy adres email lub hasło.';
  }
  if (message.includes('email not confirmed')) {
    return 'Najpierw potwierdź adres email.';
  }
  if (message.includes('supabase not configured')) {
    return 'Logowanie nie jest jeszcze skonfigurowane.';
  }
  if (message.includes('user already registered')) {
    return 'Konto z tym adresem email już istnieje.';
  }

  return err.message || 'Wystąpił nieznany błąd.';
}
