import { cache } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { siteHost } from '@/lib/subdomain';
import { formatCNPJ } from '@/lib/utils';
import {
  parseContent,
  parseTheme,
} from '@/components/site-templates/types';
import {
  PrivacyPolicy,
  PRIVACY_POLICY_PATH,
  tenantBasePath,
} from '@/components/site-templates/privacy-policy';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ subdomain: string }> };

/** Deduplica a consulta entre generateMetadata e o componente da página. */
const getSite = cache(async (subdomain: string) =>
  prisma.site.findFirst({
    where: { subdomain, isPublished: true, isDeleted: false },
    select: {
      name: true,
      companyName: true,
      cnpj: true,
      subdomain: true,
      customDomain: true,
      phone: true,
      email: true,
      theme: true,
      content: true,
      updatedAt: true,
    },
  })
);

/**
 * Sem `other` aqui — a meta tag `facebook-domain-verification` é definida uma
 * única vez, no layout do segmento, e metadata de página sobrescreveria o
 * campo inteiro.
 *
 * A página é indexável de propósito: o link para a política no rodapé, com
 * conteúdo real e acessível, é justamente o sinal de legitimidade que a Meta
 * (e o humano que revisa o domínio) procura.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const site = await getSite(subdomain);

  if (!site) {
    return {
      title: 'Site não encontrado',
      robots: { index: false, follow: false },
    };
  }

  return {
    // O layout aplica o template `%s · {razão social}`.
    title: 'Política de Privacidade',
    description: `Como ${site.companyName}, CNPJ ${formatCNPJ(site.cnpj)}, coleta, usa, compartilha e protege dados pessoais, conforme a Lei nº 13.709/2018 (LGPD).`,
    alternates: { canonical: PRIVACY_POLICY_PATH },
    robots: { index: true, follow: true },
  };
}

export default async function TenantPrivacyPolicyPage({ params }: Props) {
  const { subdomain } = await params;
  const site = await getSite(subdomain);

  if (!site) notFound();

  // viewsCount NÃO é incrementado aqui: o contador mede acessos ao site do
  // cliente, e uma leitura da política inflaria a métrica do painel.
  const theme = parseTheme(site.theme);
  const content = parseContent(site.content);

  const basePath = tenantBasePath(headers().get('host'), site.subdomain);

  return (
    <PrivacyPolicy
      company={{
        name: site.name,
        companyName: site.companyName,
        cnpj: site.cnpj,
      }}
      host={siteHost(site)}
      theme={theme}
      content={{
        ...content,
        // Mesma precedência da home: o contato digitado no painel ganha do
        // que veio do cadastro público.
        phone: site.phone?.trim() || content.phone,
        email: site.email?.trim() || content.email,
      }}
      homeHref={basePath || '/'}
      updatedAt={site.updatedAt.toISOString()}
    />
  );
}
