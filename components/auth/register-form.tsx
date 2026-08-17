'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { registerUser } from '@/app/actions/auth';
import { RegisterSchema } from '@/lib/validators/auth';

export function RegisterForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const parsed = RegisterSchema.safeParse({
        name,
        email,
        password,
        confirmPassword,
      });

      if (!parsed.success) {
        setError('Verifique todos os campos');
        return;
      }

      const result = await registerUser(parsed.data);

      if (!result.success) {
        setError(result.error || 'Erro ao registrar');
        return;
      }

      setTimeout(() => {
        router.push('/login');
      }, 1500);
    } catch (err) {
      setError('Erro ao registrar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4">
      {error && (
        <div className="badge badge-error">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-2">Nome</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Seu nome"
          disabled={loading}
          required
        />
      </div>

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
          placeholder="Mín. 8 caracteres"
          disabled={loading}
          required
        />
        <p className="text-xs text-dark-400 mt-1">
          Deve incluir maiúscula, minúscula, número e caractere especial
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">Confirmar Senha</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Repita sua senha"
          disabled={loading}
          required
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="btn-primary w-full"
      >
        {loading ? 'Registrando...' : 'Registrar'}
      </button>
    </form>
  );
}
