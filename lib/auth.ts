import NextAuth, { type NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@auth/prisma-adapter';
import { prisma } from '@/lib/prisma';
import { LoginSchema } from '@/lib/validators/auth';
import { verifyPassword } from '@/lib/utils/auth-utils';
import { getClientIp, rateLimit, rateLimitByName } from '@/lib/utils/rate-limit';

/**
 * Teto de tentativas de login por IP, além do limite por e-mail do catálogo
 * (`auth:login`). O bcrypt já torna cada tentativa cara, mas sem teto um
 * atacante distribui as tentativas por muitos e-mails e ninguém percebe.
 */
const LOGIN_IP_LIMIT = 30;
const LOGIN_IP_WINDOW_MS = 15 * 60 * 1000;

export const config = {
  adapter: PrismaAdapter(prisma),
  /*
   * Segredo lido AQUI, e não deixado por conta do next-auth.
   *
   * O `setEnvDefaults` da biblioteca faz `process.env.AUTH_SECRET ?? NEXTAUTH_SECRET`,
   * mas esse código roda de dentro do node_modules — e o Next.js só garante a
   * substituição de `process.env.X` no código da aplicação. Em produção na Vercel
   * a variável existia no painel e ainda assim a biblioteca via `undefined`,
   * derrubando toda requisição com MissingSecret (middleware e function).
   *
   * Lendo no nosso módulo, o valor entra na config e o `config.secret ?? ...`
   * da biblioteca nem consulta o ambiente.
   */
  // `||` e não `??`: variável definida com valor VAZIO é o caso comum de erro no
  // painel, e `??` a manteria — resultando no mesmo MissingSecret, só que mais
  // difícil de enxergar.
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || undefined,
  /*
   * O middleware reescreve hosts de tenant (*.million-verify.com), então o host
   * da requisição varia. Sem isto o next-auth recusa hosts que não reconhece.
   */
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 }, // 30 dias
  pages: {
    signIn: '/login',
    error: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
      }
      return session;
    },
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/')) return `${baseUrl}${url}`;
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl + '/dashboard';
    },
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Senha', type: 'password' },
      },
      async authorize(credentials) {
        const parsed = LoginSchema.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        // Limites ANTES de tocar no banco: tentativa barrada não custa bcrypt.
        // A chave por e-mail é normalizada só para o balde; a busca usa o
        // e-mail como foi cadastrado.
        const ip = await getClientIp();
        const [byEmail, byIp] = await Promise.all([
          rateLimitByName('auth:login', parsed.data.email.trim().toLowerCase()),
          rateLimit(`auth:login-ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_MS),
        ]);

        if (!byEmail.success || !byIp.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        // Conta desativada (DELETE /api/account) não entra mais. A senha é
        // conferida mesmo assim para a resposta não revelar o estado da conta.
        const isPasswordValid = await verifyPassword(
          parsed.data.password,
          user.passwordHash,
        );

        if (!isPasswordValid || !user.isActive) {
          return null;
        }

        // Atualizar lastLoginAt
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatar,
          role: user.role,
        };
      },
    }),
  ],
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(config);
