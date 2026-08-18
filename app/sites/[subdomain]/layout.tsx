/**
 * Moldura de TODO site de cliente (home e páginas legais).
 *
 * Não renderiza <html> nem <body>: app/layout.tsx já é o dono dos dois e o
 * idioma dele (pt-BR) vale para o tenant, que é sempre uma empresa brasileira.
 * O que este layout faz é o que só existe no nível do segmento — o <head> do
 * tenant e a neutralização do tema da plataforma no <body> herdado.
 */
import { cache } from 'react';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { prisma } from '@/lib/prisma';
import { siteUrl } from '@/lib/subdomain';
import {
  buildPalette,
  isLightColor,
  parseContent,
  parseTheme,
  resolveDescription,
  withAlpha,
} from '@/components/site-templates/types';

export const dynamic = 'force-dynamic';

type Props = {
  children: ReactNode;
  params: Promise<{ subdomain: string }>;
};

/**
 * `cache` deduplica a consulta dentro da mesma requisição: generateMetadata e o
 * componente do layout chamam esta função e o banco é consultado uma vez só.
 *
 * O filtro isPublished/isDeleted é intencional e vale também para o <head>:
 * despublicar um site precisa derrubar a verificação da Meta junto.
 */
const getSiteChrome = cache(async (subdomain: string) =>
  prisma.site.findFirst({
    where: { subdomain, isPublished: true, isDeleted: false },
    select: {
      name: true,
      companyName: true,
      cnpj: true,
      description: true,
      subdomain: true,
      customDomain: true,
      metaTag: true,
      theme: true,
      content: true,
    },
  })
);

/**
 * ÚNICO dono da chave `other` em toda a árvore do tenant.
 *
 * O Next resolve metadata segmento a segmento e o filho SOBRESCREVE o campo
 * inteiro do pai — uma página que devolvesse `other: {}` apagaria a tag de
 * verificação do Facebook e quebraria o produto. Por isso a tag mora aqui, no
 * layout: vale para a home e para a política de privacidade, e nenhuma página
 * do segmento pode declarar `other`.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { subdomain } = await params;
  const site = await getSiteChrome(subdomain);

  if (!site) {
    return {
      title: 'Site não encontrado',
      robots: { index: false, follow: false },
    };
  }

  const content = parseContent(site.content);
  const description = resolveDescription(
    {
      name: site.name,
      companyName: site.companyName,
      cnpj: site.cnpj,
      description: site.description,
      subdomain: site.subdomain,
    },
    content
  );

  // Sem sobrescrever, o site do cliente herdaria title, description e keywords
  // da plataforma (app/layout.tsx) — a marca Business Million apareceria no
  // <head> de um site institucional de terceiro.
  const keywords = [
    site.companyName,
    site.name,
    content.city,
    content.state,
    content.mainActivity,
  ].filter((term): term is string => Boolean(term && term.trim()));

  // customDomain vem do banco e ninguém garante que seja um host válido; um
  // `new URL` estourando aqui derrubaria o generateMetadata inteiro e, com ele,
  // a meta tag de verificação. Sem base válida, o Next resolve o canônico
  // relativo sozinho.
  const publicUrl = ((): URL | undefined => {
    try {
      return new URL(siteUrl(site));
    } catch {
      return undefined;
    }
  })();

  return {
    // Canônico sempre no host público, mesmo quando a página é servida em
    // million-verify.com/sites/{sub} — evita conteúdo duplicado.
    ...(publicUrl ? { metadataBase: publicUrl } : {}),
    title: { default: site.companyName, template: `%s · ${site.companyName}` },
    description,
    keywords,
    applicationName: site.companyName,
    alternates: { canonical: '/' },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: site.companyName,
      title: site.companyName,
      description,
      url: '/',
    },
    ...(site.metaTag
      ? { other: { 'facebook-domain-verification': site.metaTag } }
      : {}),
  };
}

/**
 * Barra do navegador no celular pintada com a cor do tenant. Sem isto o
 * aparelho usa o padrão do sistema e um site de fundo claro fica com o topo
 * escuro, o que denuncia que a página não é "da empresa".
 */
export async function generateViewport({ params }: Props): Promise<Viewport> {
  const { subdomain } = await params;
  const site = await getSiteChrome(subdomain);
  const theme = parseTheme(site?.theme);

  return {
    themeColor: theme.bgColor,
    colorScheme: isLightColor(theme.bgColor) ? 'light' : 'dark',
  };
}

export default async function TenantSiteLayout({ children, params }: Props) {
  const { subdomain } = await params;
  const site = await getSiteChrome(subdomain);

  // Site inexistente ainda passa por aqui (o notFound() é da página): o tema
  // padrão mantém a moldura coerente com a mensagem de erro.
  const theme = parseTheme(site?.theme);
  const palette = buildPalette(theme);

  /**
   * app/globals.css é o CSS da plataforma e pinta o <body> de todo mundo:
   * texto branco, degradê escuro e barra de rolagem âmbar da Business Million.
   * Num site de cliente com fundo claro isso aparece na área de overscroll e na
   * barra de rolagem — marca nossa dentro do site dele.
   *
   * Os seletores usam `html body` / `html::` de propósito: especificidade maior
   * que a de globals.css, então a ordem em que o CSS entra no documento deixa de
   * importar. Todo valor interpolado sai de parseTheme (só hexadecimal) ou de
   * withAlpha (rgba) — não há string livre do usuário aqui.
   */
  const chromeCss = `
html { color-scheme: ${isLightColor(theme.bgColor) ? 'light' : 'dark'}; scrollbar-color: ${palette.accent} ${palette.surfaceStrong}; }
html body { background-color: ${palette.bg}; background-image: none; color: ${palette.ink}; }
html::-webkit-scrollbar-track, html body::-webkit-scrollbar-track { background: ${palette.surfaceStrong}; }
html::-webkit-scrollbar-thumb, html body::-webkit-scrollbar-thumb { background: ${palette.accent}; border-radius: 5px; }
html::-webkit-scrollbar-thumb:hover, html body::-webkit-scrollbar-thumb:hover { background: ${withAlpha(palette.accent, 0.85)}; }
html body::selection, html body ::selection { background: ${withAlpha(palette.accent, 0.28)}; color: ${palette.ink}; }
`.trim();

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: chromeCss }} />
      {children}
    </>
  );
}
