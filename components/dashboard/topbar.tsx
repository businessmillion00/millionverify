'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { cn } from '@/lib/utils';
import { ICONS, Icon } from '@/components/dashboard/nav-link';
import { useSidebar } from '@/components/dashboard/sidebar';
import { UserMenu } from '@/components/dashboard/user-menu';

type Props = {
  user: {
    name: string | null;
    email: string;
    role?: string;
    tokenBalance: number;
  };
};

/** Rótulos das rotas que existem no shell. Fora daqui, cai no slug formatado. */
const ROUTE_LABELS: Record<string, string> = {
  '/dashboard': 'Visão geral',
  '/dashboard/sites': 'Meus sites',
  '/dashboard/sites/new': 'Novo site',
  '/dashboard/tokens': 'Tokens',
  '/dashboard/billing': 'Faturamento',
  '/admin': 'Master Control',
  '/admin/users': 'Usuários',
};

/** Rotas dinâmicas: o último segmento é um id e não serve de rótulo. */
const ROUTE_PREFIX_LABELS: Array<[string, string]> = [
  ['/dashboard/sites/', 'Detalhes do site'],
  ['/dashboard/billing/', 'Pagamento'],
];

function labelFor(pathname: string): string {
  const known = ROUTE_LABELS[pathname];
  if (known) return known;

  for (const [prefix, label] of ROUTE_PREFIX_LABELS) {
    if (pathname.startsWith(prefix)) return label;
  }

  const segments = pathname.split('/').filter(Boolean);
  const segment = segments.length > 0 ? segments[segments.length - 1] : '';
  if (!segment) return 'Painel';

  const readable = segment.replace(/-/g, ' ');
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

const formatTokens = (value: number) => Math.round(value).toLocaleString('pt-BR');

/** Interpola o saldo quando ele muda (compra, ajuste, refresh do router). */
function useTweenedTokens(value: number) {
  const ref = useRef<HTMLSpanElement>(null);
  const proxy = useRef({ v: value });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = formatTokens(value);
      proxy.current.v = value;
      return;
    }

    const tween = gsap.to(proxy.current, {
      v: value,
      duration: 0.6,
      ease: 'power3.out',
      onUpdate: () => {
        el.textContent = formatTokens(proxy.current.v);
      },
    });

    // kill() em vez de context/revert: o texto interpolado deve permanecer no
    // último valor, não voltar ao inicial (mesmo padrão do token-slider).
    return () => {
      tween.kill();
    };
  }, [value]);

  return ref;
}

export function Topbar({ user }: Props) {
  const pathname = usePathname();
  const { setMobileOpen } = useSidebar();
  const [scrolled, setScrolled] = useState(false);
  const tokensRef = useTweenedTokens(user.tokenBalance);

  const isAdminArea = pathname.startsWith('/admin');

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b bg-dark-950/75 backdrop-blur-xl transition-colors duration-300',
        scrolled ? 'border-white/5 shadow-luxury-sm' : 'border-transparent',
      )}
    >
      <div className="container-safe flex h-16 items-center gap-3">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir navegação"
          className="-ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-lg text-dark-300 transition-colors hover:bg-white/5 hover:text-white lg:hidden"
        >
          <Icon path={ICONS.menu} />
        </button>

        <div className="min-w-0">
          <p
            className={cn(
              'text-[10px] uppercase tracking-[0.35em]',
              isAdminArea ? 'text-gold-500/80' : 'text-amber-500/70',
            )}
          >
            {isAdminArea ? 'Administração' : 'Painel'}
          </p>
          <p className="truncate text-sm font-medium text-white">
            {labelFor(pathname)}
          </p>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
          {isAdminArea && (
            <span className="badge hidden bg-gold-500/15 text-[10px] uppercase tracking-wider text-gold-400 md:inline-flex">
              Modo administrador
            </span>
          )}

          <Link
            href="/dashboard/tokens"
            title="Saldo de tokens"
            className="badge badge-amber gap-2 border border-amber-500/20 transition-colors hover:bg-amber-500/30"
          >
            <Icon path={ICONS.coins} className="h-4 w-4" />
            <span className="tabular-nums">
              <span ref={tokensRef}>{formatTokens(user.tokenBalance)}</span>
              <span className="ml-1 hidden text-amber-400/70 sm:inline">tokens</span>
            </span>
          </Link>

          <UserMenu name={user.name} email={user.email} role={user.role} />
        </div>
      </div>
    </header>
  );
}
