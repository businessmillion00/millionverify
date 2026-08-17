import Link from 'next/link';
import { RegisterForm } from '@/components/auth/register-form';

export default function RegisterPage() {
  return (
    <main className="container-safe flex min-h-screen flex-col items-center justify-center py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        Criar <span className="text-gradient">conta</span>
      </h1>
      <p className="mt-2 text-sm text-dark-400">
        Ganhe 100 tokens de bônus no cadastro.
      </p>

      <div className="card mt-10 w-full max-w-md">
        <RegisterForm />
      </div>

      <p className="mt-6 text-sm text-dark-400">
        Já tem conta?{' '}
        <Link href="/login" className="text-amber-400 hover:underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
