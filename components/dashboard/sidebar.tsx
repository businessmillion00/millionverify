'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import gsap from 'gsap';
import { cn } from '@/lib/utils';
import { ICONS, Icon, NavLink, type NavAccent } from '@/components/dashboard/nav-link';

const WIDTH_EXPANDED = '16rem';
const WIDTH_RAIL = '5rem';
const STORAGE_KEY = 'bm:sidebar-recolhida';

/* ------------------------------------------------------------------ *
 * Estado do shell
 * ------------------------------------------------------------------ */

type SidebarContextValue = {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar precisa estar dentro de <SidebarProvider>.');
  }
  return ctx;
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // A preferência só pode ser lida depois da hidratação: o HTML do servidor não
  // conhece o localStorage e divergir aqui quebraria a hidratação.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  // A largura vive numa custom property do <html> porque o <main> que precisa
  // dela é IRMÃO da sidebar, não descendente — não há como herdar por contexto
  // de CSS. A propriedade fica no documento de propósito: o próximo layout do
  // painel a reaproveita sem piscar na largura padrão.
  useEffect(() => {
    document.documentElement.style.setProperty(
      '--bm-sidebar',
      collapsed ? WIDTH_RAIL : WIDTH_EXPANDED,
    );
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  }, [collapsed]);

  return (
    <SidebarContext.Provider
      value={{ collapsed, toggleCollapsed, mobileOpen, setMobileOpen }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

/* ------------------------------------------------------------------ *
 * Navegação
 * ------------------------------------------------------------------ */

export type SidebarVariant = 'user' | 'admin';

type NavItem = {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
};

const NAV: Record<SidebarVariant, NavItem[]> = {
  user: [
    { href: '/dashboard', label: 'Visão geral', icon: ICONS.grid, exact: true },
    { href: '/dashboard/sites', label: 'Meus sites', icon: ICONS.globe },
    { href: '/dashboard/tokens', label: 'Tokens', icon: ICONS.coins },
    { href: '/dashboard/billing', label: 'Faturamento', icon: ICONS.card },
  ],
  admin: [
    { href: '/admin', label: 'Visão geral', icon: ICONS.pulse, exact: true },
    { href: '/admin/users', label: 'Usuários', icon: ICONS.users },
  ],
};

const THEME: Record<
  SidebarVariant,
  {
    accent: NavAccent;
    kicker: string;
    kickerClass: string;
    mark: string;
    bar: string;
    tint: string;
  }
> = {
  user: {
    accent: 'amber',
    kicker: 'Painel',
    kickerClass: 'text-amber-500/70',
    mark: 'bg-gradient-amber',
    bar: 'bg-amber-500',
    tint: 'from-amber-500/[0.07]',
  },
  admin: {
    accent: 'gold',
    kicker: 'Master Control',
    kickerClass: 'text-gold-500/80',
    mark: 'bg-gradient-to-br from-gold-400 via-gold-500 to-gold-700',
    bar: 'bg-gold-500',
    tint: 'from-gold-500/[0.09]',
  },
};

/** Altura da lasca de acento colada na borda esquerda do trilho. */
const EDGE_HEIGHT = 20;

function NavRail({
  variant,
  collapsed,
  onNavigate,
}: {
  variant: SidebarVariant;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const theme = THEME[variant];
  const items = NAV[variant];

  useEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    const edge = edgeRef.current;
    if (!nav || !pill || !edge) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const active = nav.querySelector<HTMLElement>(
      '[data-nav-item][data-active="true"]',
    );

    // Rota fora do menu (ex.: /dashboard/sites/new): nada fica marcado.
    if (!active) {
      placed.current = false;
      const fade = gsap.to([pill, edge], {
        autoAlpha: 0,
        duration: reduced ? 0 : 0.2,
      });
      return () => fade.kill();
    }

    const toPill = {
      x: active.offsetLeft,
      y: active.offsetTop,
      width: active.offsetWidth,
      height: active.offsetHeight,
      autoAlpha: 1,
    };
    const toEdge = {
      y: active.offsetTop + (active.offsetHeight - EDGE_HEIGHT) / 2,
      height: EDGE_HEIGHT,
      autoAlpha: 1,
    };

    // Primeira pintura (e reduced-motion) sem deslizamento: o indicador nasce
    // no lugar certo em vez de correr do topo.
    if (!placed.current || reduced) {
      gsap.set(pill, toPill);
      gsap.set(edge, toEdge);
      placed.current = true;
      return;
    }

    // Sem gsap.context() aqui de propósito: o revert() do cleanup devolveria o
    // indicador à origem a cada troca de rota e ele saltaria para o topo antes
    // de deslizar. Mesmo motivo do tween.kill() em token-slider.tsx.
    const tweens = [
      gsap.to(pill, { ...toPill, duration: 0.45, ease: 'power3.out' }),
      gsap.to(edge, { ...toEdge, duration: 0.45, ease: 'power3.out' }),
    ];

    return () => tweens.forEach((tween) => tween.kill());
  }, [pathname, collapsed, items]);

  return (
    <nav
      ref={navRef}
      aria-label="Navegação principal"
      className={cn('relative flex flex-col gap-1', collapsed && 'items-center')}
    >
      {/* Indicador ativo — decorativo: o link ativo já se distingue por cor e
          aria-current, então começar invisível não esconde informação. */}
      <span
        ref={pillRef}
        aria-hidden
        style={{ width: 0, height: 0, opacity: 0 }}
        className="pointer-events-none absolute left-0 top-0 rounded-xl bg-white/[0.055] ring-1 ring-inset ring-white/[0.07]"
      />
      <span
        ref={edgeRef}
        aria-hidden
        style={{ height: 0, opacity: 0 }}
        className={cn(
          'pointer-events-none absolute -left-3 top-0 w-[2px] rounded-r-full',
          theme.bar,
        )}
      />

      {items.map((item) => (
        <NavLink
          key={item.href}
          href={item.href}
          label={item.label}
          exact={item.exact}
          collapsed={collapsed}
          accent={theme.accent}
          onNavigate={onNavigate}
          icon={<Icon path={item.icon} />}
        />
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * Conteúdo (compartilhado entre o trilho fixo e o drawer)
 * ------------------------------------------------------------------ */

function CrossLink({
  href,
  label,
  icon,
  collapsed,
  highlight,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: string;
  collapsed: boolean;
  highlight?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      className={cn(
        'flex h-11 items-center rounded-xl text-sm transition-colors duration-200 hover:bg-white/[0.04]',
        collapsed ? 'w-11 justify-center' : 'gap-3 px-3',
        highlight ? 'text-gold-400 hover:text-gold-300' : 'text-dark-400 hover:text-white',
      )}
    >
      <Icon path={icon} className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SidebarBody({
  variant,
  role,
  collapsed,
  onNavigate,
  onClose,
}: {
  variant: SidebarVariant;
  role?: string;
  collapsed: boolean;
  /** Chamado a cada navegação — fecha o drawer no mobile. */
  onNavigate?: () => void;
  /** Presente apenas no drawer. */
  onClose?: () => void;
}) {
  const { toggleCollapsed } = useSidebar();
  const theme = THEME[variant];

  return (
    <div className="relative flex h-full flex-col">
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b to-transparent',
          theme.tint,
        )}
      />

      {/* Marca */}
      <div
        className={cn(
          'relative flex h-16 shrink-0 items-center',
          collapsed ? 'justify-center px-0' : 'gap-3 px-6',
        )}
      >
        <Link
          href={variant === 'admin' ? '/admin' : '/dashboard'}
          onClick={onNavigate}
          className="flex items-center gap-3"
          title={collapsed ? 'Million Verify' : undefined}
        >
          <Image
            src="/logo.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0"
          />
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight">
                Million Verify
              </span>
              <span
                className={cn(
                  'mt-1 text-[10px] uppercase tracking-[0.3em]',
                  theme.kickerClass,
                )}
              >
                {theme.kicker}
              </span>
            </span>
          )}
        </Link>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar navegação"
            className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-dark-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icon path={ICONS.close} />
          </button>
        )}
      </div>

      {/* Ação principal */}
      {variant === 'user' && (
        <div
          className={cn(
            'relative mt-4 shrink-0 px-3',
            collapsed ? 'flex justify-center' : 'px-6',
          )}
        >
          <Link
            href="/dashboard/sites/new"
            onClick={onNavigate}
            title={collapsed ? 'Criar site' : undefined}
            className={cn(
              'flex items-center justify-center rounded-xl bg-gradient-amber font-medium text-dark-950 transition-all duration-200 hover:shadow-amber-glow',
              collapsed ? 'h-11 w-11' : 'h-11 w-full gap-2 text-sm',
            )}
          >
            <Icon path={ICONS.plus} className="h-4 w-4" />
            {!collapsed && 'Criar site'}
          </Link>
        </div>
      )}

      {/* Navegação */}
      <div className="relative mt-6 flex-1 overflow-y-auto px-3 pb-4">
        {!collapsed && (
          <p className="mb-2 px-3 text-[10px] uppercase tracking-[0.3em] text-dark-500">
            Navegar
          </p>
        )}
        <NavRail variant={variant} collapsed={collapsed} onNavigate={onNavigate} />
      </div>

      {/* Rodapé */}
      <div
        className={cn(
          'relative flex shrink-0 flex-col border-t border-white/5 px-3 py-3',
          collapsed && 'items-center',
        )}
      >
        {variant === 'admin' ? (
          <CrossLink
            href="/dashboard"
            label="Voltar ao painel"
            icon={ICONS.back}
            collapsed={collapsed}
            onNavigate={onNavigate}
          />
        ) : (
          role === 'ADMIN' && (
            <CrossLink
              href="/admin"
              label="Master Control"
              icon={ICONS.shield}
              collapsed={collapsed}
              highlight
              onNavigate={onNavigate}
            />
          )
        )}

        {/* O recolhimento só existe no trilho fixo (>= lg). */}
        {!onClose && (
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expandir navegação' : 'Recolher navegação'}
            aria-expanded={!collapsed}
            className={cn(
              'mt-1 flex h-11 items-center rounded-xl text-sm text-dark-500 transition-colors duration-200 hover:bg-white/[0.04] hover:text-white',
              collapsed ? 'w-11 justify-center' : 'w-full gap-3 px-3',
            )}
          >
            <Icon
              path={collapsed ? ICONS.chevronRight : ICONS.chevronLeft}
              className="h-5 w-5 shrink-0"
            />
            {!collapsed && <span>Recolher</span>}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Sidebar
 * ------------------------------------------------------------------ */

export function Sidebar({ variant, role }: { variant: SidebarVariant; role?: string }) {
  const { collapsed, mobileOpen, setMobileOpen } = useSidebar();
  const reduced = useReducedMotion();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    drawerRef.current?.focus();

    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileOpen, setMobileOpen]);

  return (
    <>
      {/* Trilho fixo (>= lg). A largura vem da custom property escrita pelo
          provider, para que o <main> irmão acompanhe o mesmo valor. */}
      <aside
        style={{ width: 'var(--bm-sidebar, 16rem)' }}
        className="fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-white/5 bg-dark-950/85 backdrop-blur-xl transition-[width] duration-300 ease-out lg:flex"
      >
        <SidebarBody variant={variant} role={role} collapsed={collapsed} />
      </aside>

      {/* Drawer (< lg). Framer Motion em vez de GSAP: o conteúdo nasce
          desmontado e um gsap.from com scrollTrigger nunca dispararia.
          Dois <AnimatePresence> em vez de um fragmento: o AnimatePresence só
          rastreia filhos diretos com key, e um Fragment não é rastreável. */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.25 }}
            onClick={() => setMobileOpen(false)}
            aria-hidden
            className="fixed inset-0 z-40 bg-dark-950/70 backdrop-blur-sm lg:hidden"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="drawer"
            ref={drawerRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Navegação"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 380, damping: 40 }
            }
            className="fixed inset-y-0 left-0 z-50 w-[17rem] border-r border-white/5 bg-dark-900 shadow-luxury outline-none lg:hidden"
          >
            <SidebarBody
              variant={variant}
              role={role}
              collapsed={false}
              onNavigate={() => setMobileOpen(false)}
              onClose={() => setMobileOpen(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
