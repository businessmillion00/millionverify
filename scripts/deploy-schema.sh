#!/bin/sh
# Aplica prisma/schema.prisma no banco de PRODUÇÃO durante o build da Vercel.
#
# Por que existe: o build rodava só `prisma generate`, então toda mudança de
# schema dependia de um `prisma db push` manual contra o Neon. Em 13/09/2026 a
# coluna Site.expiresAt subiu no código sem o push e toda consulta a Site
# passou a falhar em produção ("Application error") até alguém perceber.
#
# Só roda em produção (VERCEL_ENV=production). Preview de branch não pode
# alterar o banco que a produção usa, e o build local não deve tocar em nada.
#
# O Prisma usa a conexão DIRETA (DATABASE_URL_UNPOOLED, o `directUrl` do
# schema): o pooler do Neon roda em transaction mode e não serve para DDL.
# As duas variáveis precisam existir no ambiente de build da Vercel.
#
# Mudança destrutiva (apagar coluna ou tabela) faz o `db push` recusar e o
# build falhar. É proposital: nada some do banco sem alguém passar
# --accept-data-loss de caso pensado, e o deploy anterior continua no ar.
set -eu

if [ "${VERCEL_ENV:-}" != "production" ]; then
  echo "deploy-schema: fora de produção (VERCEL_ENV=${VERCEL_ENV:-vazio}); schema não aplicado."
  exit 0
fi

echo "deploy-schema: aplicando prisma/schema.prisma no banco de produção..."
npx prisma db push --skip-generate
echo "deploy-schema: schema aplicado."
