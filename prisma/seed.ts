import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Admin@123', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@businessmillion.app' },
    update: { role: 'ADMIN' },
    create: {
      email: 'admin@businessmillion.app',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
      tokenBalance: 5000,
      isVerified: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: 'user@businessmillion.app' },
    update: {},
    create: {
      email: 'user@businessmillion.app',
      name: 'Usuário Demo',
      passwordHash,
      role: 'USER',
      tokenBalance: 100,
    },
  });

  await prisma.site.upsert({
    where: { subdomain: 'petrobras-demo' },
    update: {},
    create: {
      userId: user.id,
      name: 'Petrobras Demo',
      companyName: 'PETROLEO BRASILEIRO S A PETROBRAS',
      cnpj: '33000167000101',
      subdomain: 'petrobras-demo',
      description: 'Site institucional gerado automaticamente.',
      metaTag: 'demo1234verificacao',
      content: { city: 'RIO DE JANEIRO', state: 'RJ' },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: 'SEED_EXECUTED',
      resource: 'system',
      resourceId: 'seed',
      status: 'success',
    },
  });

  console.log('Seed concluído.');
  console.log('  ADMIN  admin@businessmillion.app / Admin@123');
  console.log('  USER   user@businessmillion.app  / Admin@123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
