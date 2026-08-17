/**
 * Promove uma conta existente a ADMIN.
 *
 *   npm run admin:promote -- seu@email.com
 *
 * Por que assim, e não um admin no seed: o seed cria uma conta com senha fixa
 * escrita no repositório, que é público. Aqui você se cadastra pela tela normal,
 * com a sua senha, e só o papel muda — nenhuma credencial passa pelo código.
 *
 * Para apontar ao banco de produção, carregue as variáveis antes:
 *   set -a; . ./.env.neon.local; set +a; npm run admin:promote -- seu@email.com
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['error'] });

async function main(): Promise<number> {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error('Uso: npm run admin:promote -- seu@email.com');
    return 1;
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true },
  });

  if (!user) {
    console.error(`Nenhuma conta com o e-mail ${email}.`);
    console.error('Cadastre-se primeiro em /register e rode este comando depois.');
    return 1;
  }

  if (user.role === 'ADMIN') {
    console.log(`${user.email} já é ADMIN. Nada a fazer.`);
    return 0;
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } }),
    // Mudança de papel é evento sensível: fica registrada como qualquer outra.
    prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'ADMIN_SET_ROLE',
        resource: 'user',
        resourceId: user.id,
        changes: { de: user.role, para: 'ADMIN', via: 'prisma/promote-admin.ts' },
        status: 'success',
      },
    }),
  ]);

  console.log(`${user.email} agora é ADMIN. Acesse /admin.`);
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error) => {
    console.error('Falha ao promover:', error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exit(1);
  });
