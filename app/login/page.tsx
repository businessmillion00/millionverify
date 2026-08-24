import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <main className="container-safe flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Entrar na <span className="text-gradient">Million Verify</span>
      </h1>
      <p className="mt-2 text-sm text-dark-400">
        Acesse seu painel de sites e tokens.
      </p>

      <div className="card mt-10 w-full max-w-md">
        <LoginForm />
      </div>

      <p className="mt-6 text-sm text-dark-400">
        Não tem conta?{' '}
        <Link href="/register" className="text-amber-400 hover:underline">
          Criar conta
        </Link>
      </p>
    </main>
  );
}
