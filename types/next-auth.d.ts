import type { DefaultUser } from 'next-auth';

declare module 'next-auth' {
  interface User extends DefaultUser {
    role?: string;
  }

  interface Session {
    user: {
      id: string;
      role?: string;
    } & DefaultUser;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    role?: string;
  }
}
