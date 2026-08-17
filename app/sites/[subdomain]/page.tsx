import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { siteHost } from '@/lib/subdomain';
import { formatCNPJ } from '@/lib/utils';
import { SITE_TEMPLATES, resolveTemplate } from '@/components/site-templates';
import {
  buildPalette,
  parseContent,
  parseTheme,
  type SiteContent,
  type SiteTemplateProps,
  type SiteTheme,
} from '@/components/site-templates/types';
import {
  PRIVACY_POLICY_PATH,
  tenantBasePath,
} from '@/components/site-templates/privacy-policy';

export const dynamic = 'force-dynamic';

/**
 * Esta página NÃO exporta generateMetadata de propósito.
 *
 * O <head> do tenant — inclusive a meta tag `facebook-domain-verification` —
 * é resolvido inteiramente em app/sites/[subdomain]/layout.tsx. Metadata de
 * página sobrescreve o campo homônimo do layout: bastava devolver `other: {}`
 * aqui para a tag de verificação sumir da home e a BM do cliente travar de
 * novo. Título e descrição desta rota são exatamente os do layout.
 */

type Props = { params: Promise<{ subdomain: string }> };

/**
 * Site.phone/Site.email são as colunas editáveis no painel; content.phone e
 * content.email vêm do cadastro público da Receita. O que o dono do site
 * digitou prevalece — sem isso as duas fontes coexistem e a coluna nunca
 * aparece no site.
 */
function withContactColumns(
  content: SiteContent,
  columns: { phone: string | null; email: string | null }
): SiteContent {
  return {
    ...content,
    phone: columns.phone?.trim() || content.phone,
    email: columns.email?.trim() || content.email,
  };
}

/**
 * Enquanto o provisionamento não termina, o site ainda não existe para ser
 * mostrado. A página provisória continua herdando o <head> do layout, então a
 * verificação da Meta funciona mesmo neste estado.
 */
function BuildingNotice({
  companyName,
  cnpj,
  theme,
  host,
  legalHref,
}: {
  companyName: string;
  cnpj: string;
  theme: SiteTheme;
  host: string;
  legalHref: string;
}) {
  const palette = buildPalette(theme);
  const label = 'text-[0.7rem] uppercase tracking-[0.3em]';

  return (
    <main
      style={{ backgroundColor: palette.bg, color: palette.ink }}
      className="flex min-h-screen flex-col"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-20 sm:px-8">
        <div className="flex items-center gap-3">
          {/* animate-pulse do Tailwind: globals.css já zera animações sob
              prefers-reduced-motion, então nada pisca para quem pediu calma. */}
          <span
            style={{ backgroundColor: palette.accent }}
            className="h-2 w-2 animate-pulse rounded-full"
            aria-hidden="true"
          />
          <p style={{ color: palette.accent }} className={label}>
            Publicação em andamento
          </p>
        </div>

        <h1 className="mt-8 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
          {companyName}
        </h1>
        <p
          style={{ color: palette.inkMuted }}
          className="mt-6 text-base leading-relaxed"
        >
          Estamos montando o site institucional desta empresa. Esta página é
          provisória e será substituída pelo site assim que a publicação
          terminar — o endereço {host} continua o mesmo.
        </p>

        <dl
          style={{ borderColor: palette.hairline }}
          className="mt-10 grid gap-6 border-t pt-8 sm:grid-cols-2"
        >
          <div>
            <dt
              style={{ color: palette.inkSubtle }}
              className="text-xs uppercase tracking-[0.2em]"
            >
              Razão social
            </dt>
            <dd className="mt-2 break-words text-sm">{companyName}</dd>
          </div>
          <div>
            <dt
              style={{ color: palette.inkSubtle }}
              className="text-xs uppercase tracking-[0.2em]"
            >
              CNPJ
            </dt>
            <dd className="mt-2 text-sm tabular-nums">{formatCNPJ(cnpj)}</dd>
          </div>
        </dl>
      </div>

      <footer
        style={{ borderColor: palette.hairline, color: palette.inkSubtle }}
        className="border-t"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs sm:px-8">
          <span>
            © {new Date().getFullYear()} {companyName}
          </span>
          <a href={legalHref} className="underline-offset-4 hover:underline">
            Política de Privacidade
          </a>
        </div>
      </footer>
    </main>
  );
}

export default async function TenantSitePage({ params }: Props) {
  const { subdomain } = await params;

  const site = await prisma.site.findFirst({
    where: { subdomain, isPublished: true, isDeleted: false },
  });

  if (!site) notFound();

  await prisma.site.update({
    where: { id: site.id },
    data: { viewsCount: { increment: 1 }, lastViewedAt: new Date() },
  });

  const theme = parseTheme(site.theme);
  const content = withContactColumns(parseContent(site.content), site);
  const host = siteHost(site);

  // O prefixo depende do host que atendeu a requisição: no subdomínio o
  // middleware reescreve e o link legal é /politica-de-privacidade; no host
  // raiz (e em localhost, onde não há reescrita) precisa do /sites/{sub}.
  const legalHref = `${tenantBasePath(headers().get('host'), site.subdomain)}${PRIVACY_POLICY_PATH}`;

  if (site.buildStatus === 'QUEUED' || site.buildStatus === 'BUILDING') {
    return (
      <BuildingNotice
        companyName={site.companyName}
        cnpj={site.cnpj}
        theme={theme}
        host={host}
        legalHref={legalHref}
      />
    );
  }

  // FAILED cai no site normal de propósito: o conteúdo cadastral já está no
  // banco e tirar o site do ar por causa de uma etapa que falhou derrubaria a
  // verificação de domínio junto.
  const Template = SITE_TEMPLATES[resolveTemplate(theme.template)];

  // `host` e `legalHref` vão prontos: os templates não conseguem descobrir nem
  // o domínio próprio nem o prefixo de rota — só a página vê o cabeçalho Host.
  const templateProps: SiteTemplateProps = {
    site: {
      name: site.name,
      companyName: site.companyName,
      cnpj: site.cnpj,
      description: site.description,
      subdomain: site.subdomain,
      customDomain: site.customDomain,
    },
    theme,
    content,
    host,
    legalHref,
  };

  return <Template {...templateProps} />;
}
