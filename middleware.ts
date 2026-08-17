import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

const ROOT_HOSTS = new Set([
  'businessmillion.app',
  'www.businessmillion.app',
  'localhost:3000',
]);

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
