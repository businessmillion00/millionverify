import Link from 'next/link';
import { Reveal } from '@/components/ui/reveal';

export function CtaFooter() {
  return (
    <>
      <section className="relative overflow-hidden py-32">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[720px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-500/10 blur-[130px]"
        />

        <Reveal className="container-safe relative text-center">
          <h2 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Sua BM verificada{' '}
            <span className="text-gradient">antes do café esfriar</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-lg text-dark-400">
            Cadastre-se, ganhe 100 tokens e publique o primeiro site agora.
          </p>
          <Link href="/register" className="btn-primary mt-10 inline-flex text-lg">
            Criar conta grátis
          </Link>
        </Reveal>
      </section>

      <footer className="border-t border-dark-800">
        <div className="container-safe flex flex-col items-center justify-between gap-6 py-10 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <span className="h-5 w-5 rounded bg-gradient-amber" />
            <span className="text-sm font-medium">Business Million</span>
          </div>

          <p className="text-xs text-dark-500">
            Serviço independente, sem vínculo com a Meta Platforms.
          </p>

          <div className="flex gap-6 text-xs text-dark-500">
            <Link href="/login" className="hover:text-amber-400">
              Entrar
            </Link>
            <Link href="/register" className="hover:text-amber-400">
              Criar conta
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
