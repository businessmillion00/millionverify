import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

/** "https://exemplo.com/" → "exemplo.com"; entrada vazia some da lista. */
function hostOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null;
}

/**
 * Hosts da própria plataforma. Tudo que não estiver aqui é tratado como site de
 * cliente e reescrito para /sites/{subdominio}.
 *
 * Os domínios da Vercel entram via env porque são gerados: sem eles, o painel
 * servido em *.vercel.app é confundido com um tenant e a home vira 404 — e todo
 * preview deploy nasce quebrado.
 */
const ROOT_HOSTS = new Set(
  [
    'million-verify.com',
    'www.million-verify.com',
    'localhost:3000',
    hostOf(process.env.NEXT_PUBLIC_APP_URL),
    // Domínio estável de produção na Vercel (millionverify-d1lr.vercel.app).
    hostOf(process.env.VERCEL_PROJECT_PRODUCTION_URL),
    // URL única deste deployment, usada pelos previews.
    hostOf(process.env.VERCEL_URL),
    hostOf(process.env.VERCEL_BRANCH_URL),
  ].filter((host): host is string => host !== null),
);

const ADMIN_ONLY = '/admin';
const PROTECTED = '/dashboard';

export default auth((request) => {
  const host = request.headers.get('host') ?? '';
  const { pathname } = request.nextUrl;

  // Multi-tenancy: qualquer host que não seja o root é um site de cliente.
  if (host && !ROOT_HOSTS.has(host)) {
    const subdomain = host.split('.')[0];
    return NextResponse.rewrite(
      new URL(`/sites/${subdomain}${pathname}`, request.url)
    );
  }

  const session = request.auth;

  if (pathname.startsWith(ADMIN_ONLY)) {
    if (session?.user?.role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith(PROTECTED) && !session?.user) {
    const login = new URL('/login', request.url);
    login.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
