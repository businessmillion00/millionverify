import Link from 'next/link';
import { LoginForm } from '@/components/auth/login-form';

/** Avisos que o painel manda ao expulsar uma sessão. Chave fechada: nada de eco de texto livre. */
const AVISOS: Record<string, string> = {
  'conta-desativada': 'Esta conta foi desativada. Fale com o suporte para reativá-la.',
};

type Props = { searchParams: Promise<{ erro?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const { erro } = await searchParams;
  const aviso = erro ? AVISOS[erro] : undefined;

  return (
    <main className="container-safe flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        Entrar na <span className="text-gradient">Million Verify</span>
      </h1>
      <p className="mt-2 text-sm text-dark-400">
        Acesse seu painel de sites e tokens.
      </p>

      {aviso && (
        <p role="alert" className="badge badge-warning mt-6">
          {aviso}
        </p>
      )}

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
