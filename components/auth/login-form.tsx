'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { LoginSchema } from '@/lib/validators/auth';

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /*
   * Estado próprio para a navegação. O `loading` sozinho não bastava: o
   * `finally` o desligava assim que signIn retornava, mas o /dashboard ainda
   * levava segundos para renderizar no servidor. Nesse intervalo o botão
   * voltava a dizer "Entrar" e a tela parecia travada.
   */
  const [entrando, setEntrando] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const parsed = LoginSchema.safeParse({ email, password });

      if (!parsed.success) {
        setError('Email ou senha inválidos');
        setLoading(false);
        return;
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError('Email ou senha incorretos');
        setLoading(false);
        return;
      }

      // Sem desligar o loading: a partir daqui a tela é a de transição, que só
      // sai quando o painel terminar de renderizar.
      setEntrando(true);
      router.push('/dashboard');
      router.refresh();
      return;
    } catch {
      setError('Erro ao fazer login');
    }

    setLoading(false);
  };

  if (entrando) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex w-full max-w-md flex-col items-center gap-4 py-12"
      >
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-amber-500/30 border-t-amber-400" />
        <p className="text-sm text-dark-300">Carregando seu painel…</p>
        <p className="text-xs text-dark-500">Buscando seus sites e o saldo de tokens.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
      {error && (
        <div className="badge badge-error">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          disabled={loading}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          disabled={loading}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full"
      >
        {loading ? 'Entrando...' : 'Entrar'}
      </button>
    </form>
  );
}
