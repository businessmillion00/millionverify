'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ICONS, Icon } from '@/components/dashboard/nav-link';

type Props = {
  name: string | null;
  email: string;
  role?: string;
};

/** Iniciais tolerantes a nome ausente — cai no e-mail e, no limite, em '?'. */
function initialsOf(name: string | null, email: string): string {
  const base = (name ?? '').trim() || email.trim();
  if (!base) return '?';

  const parts = base.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('');

  return (letters || base.charAt(0)).toUpperCase();
}

const ITEM_CLASS =
  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-dark-300 outline-none transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:bg-white/[0.06] focus-visible:text-white';

export function UserMenu({ name, email, role }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const menuId = useId();

  const isAdmin = role === 'ADMIN';

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Foco no primeiro item assim que o menu aparece (navegação por teclado).
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus();
  }, [open]);

  const moveFocus = (direction: 1 | -1) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [],
    );
    if (items.length === 0) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    const next =
      current < 0
        ? direction === 1
          ? 0
          : items.length - 1
        : (current + direction + items.length) % items.length;

    items[next]?.focus();
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut({ callbackUrl: '/login' });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          'flex items-center gap-2 rounded-full border border-white/5 p-1 pr-1 transition-colors duration-200 hover:border-white/10 hover:bg-white/[0.04] sm:pr-3',
          open && 'border-white/10 bg-white/[0.04]',
        )}
      >
        <span
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-dark-950',
            isAdmin
              ? 'bg-gradient-to-br from-gold-400 to-gold-700'
              : 'bg-gradient-amber',
          )}
        >
          {initialsOf(name, email)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm text-dark-200 sm:block">
          {name ?? email}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="Conta"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                moveFocus(1);
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                moveFocus(-1);
              }
            }}
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={
              reduced
                ? { duration: 0 }
                : { type: 'spring', stiffness: 400, damping: 30 }
            }
            className="absolute right-0 top-[calc(100%+0.6rem)] z-50 w-64 origin-top-right overflow-hidden rounded-xl border border-dark-700 bg-dark-900/95 p-2 shadow-luxury backdrop-blur-xl"
          >
            <div className="px-3 pb-3 pt-2">
              <p className="truncate text-sm font-medium text-white">
                {name ?? 'Sem nome'}
              </p>
              <p className="mt-0.5 truncate text-xs text-dark-500">{email}</p>
              {isAdmin && (
                <span className="badge mt-2 bg-gold-500/15 text-[10px] uppercase tracking-wider text-gold-400">
                  Administrador
                </span>
              )}
            </div>

            <div className="divider" />

            <div className="pt-2">
              <Link
                href="/dashboard"
                role="menuitem"
                data-menu-item
                onClick={() => close()}
                className={ITEM_CLASS}
              >
                <Icon path={ICONS.grid} className="h-4 w-4 text-dark-500" />
                Meu painel
              </Link>

              <Link
                href="/dashboard/tokens"
                role="menuitem"
                data-menu-item
                onClick={() => close()}
                className={ITEM_CLASS}
              >
                <Icon path={ICONS.coins} className="h-4 w-4 text-dark-500" />
                Tokens
              </Link>

              {isAdmin && (
                <Link
                  href="/admin"
                  role="menuitem"
                  data-menu-item
                  onClick={() => close()}
                  className={cn(ITEM_CLASS, 'text-gold-400 hover:text-gold-300')}
                >
                  <Icon path={ICONS.shield} className="h-4 w-4" />
                  Master Control
                </Link>
              )}

              <button
                type="button"
                role="menuitem"
                data-menu-item
                disabled={signingOut}
                onClick={handleSignOut}
                className={cn(ITEM_CLASS, 'mt-1 hover:text-red-300 disabled:opacity-60')}
              >
                <Icon path={ICONS.logout} className="h-4 w-4 text-dark-500" />
                {signingOut ? 'Saindo…' : 'Sair'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
