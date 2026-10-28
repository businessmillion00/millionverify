import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatCNPJ } from '@/lib/utils';
import { siteHost, siteUrl } from '@/lib/subdomain';
import { PageHeader } from '@/components/dashboard/page-header';
import { parseDiagnostic } from '@/lib/verification/diagnose';
import { StatusBanner, type VerificationState } from '@/components/verification/status-banner';
import { SiteLiveCard } from '@/components/verification/site-live-card';
import { VerificationPanel } from '@/components/verification/verification-panel';
import { BMDataTable } from '@/components/verification/bm-data-table';
import { CnpjDocumentCard } from '@/components/verification/cnpj-document-card';
import { DiagnosticCard } from '@/components/verification/diagnostic-card';
import { TutorialTrigger } from '@/components/verification/tutorial-trigger';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Verificação · Million Verify',
};

type Props = {
  params: Promise<{ id: string }>;
};

/**
 * Datas viram rótulo AQUI, no servidor: mandar `Date` para o cliente e formatar
 * lá dá divergência de hidratação quando o fuso do processo difere do navegador.
 */
const label = (date: Date | null): string | null =>
  date === null ? null : date.toLocaleString('pt-BR');

/** Janela em que o certificado do subdomínio ainda pode estar sendo emitido. */
const PROPAGATION_WINDOW_MS = 20 * 60 * 1000;
const PROBE_TIMEOUT_MS = 5_000;

/**
 * O endereço público já responde?
 *
 * A Vercel emite o certificado do subdomínio de forma assíncrona, minutos depois
 * de o build terminar. Nesse intervalo a Meta não consegue abrir o site — e
 * verificar agora falha SEMPRE, queimando uma tentativa e confundindo o cliente.
 *
 * Só é sondado em site recém-criado: nos antigos o certificado existe há muito e
 * a consulta atrasaria a página à toa.
 */
async function enderecoResponde(url: string, criadoEm: Date): Promise<boolean> {
  if (Date.now() - criadoEm.getTime() > PROPAGATION_WINDOW_MS) return true;

  try {
    await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      cache: 'no-store',
    });
    return true;
  } catch {
    return false;
  }
}

const isoLabel = (iso: string | null): string | null => {
  if (iso === null) return null;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString('pt-BR');
};

export default async function SiteVerificationPage({ params }: Props) {
  const session = await auth();
  if (!session?.user?.id) notFound();

  const { id } = await params;

  // Busca amarrada ao dono: id de outro usuário responde 404, nunca 403.
  const site = await prisma.site.findFirst({
    where: { id, userId: session.user.id, isDeleted: false },
  });

  if (!site) notFound();

  const host = siteHost(site);
  const url = siteUrl(site);

  const hasCode = site.metaTag !== null || site.verificationTxt !== null;
  const verified = site.metaTagVerified || site.verificationTxtVerified;

  // A ordem é de bloqueio, não de importância: um site despublicado responde 404
  // e nenhuma outra mensagem faria sentido antes de resolver isso.
  // Publicado não significa acessível: o certificado do subdomínio pode estar
  // saindo ainda. Verificar antes disso falha sempre.
  const enderecoPronto = site.isPublished
    ? await enderecoResponde(url, site.createdAt)
    : false;

  const state: VerificationState = !site.isPublished
    ? 'unpublished'
    : !enderecoPronto
      ? 'propagating'
      : !hasCode
        ? 'missing-code'
        : verified
          ? 'verified'
          : 'awaiting';

  // O parser é o do dono do contrato: a coluna é Json e pode trazer o formato
  // gravado por uma versão anterior.
  const diagnostic = parseDiagnostic(site.lastDiagnostic);

  const lastCheckedAt = site.metaTagLastCheckedAt ?? site.verificationTxtLastCheckedAt;

  return (
    <>
      <Link
        href={`/dashboard/sites/${site.id}`}
        className="text-xs uppercase tracking-widest text-dark-500 transition-colors hover:text-amber-400"
      >
        ← Voltar para o site
      </Link>

      <div className="mt-6">
        <PageHeader
          eyebrow="Verificação de domínio"
          title={site.companyName}
          description="Cole aqui o código que o Meta Business Manager mostra em Segurança da marca → Domínios. Ele entra no site na hora e esta tela confere se a Meta consegue lê-lo."
        >
          <span className={verified ? 'badge badge-success' : 'badge badge-warning'}>
            {verified ? 'Verificado' : 'Pendente no BM'}
          </span>

          {/* Sempre secundário: a ação que resolve a tela é "Verificar agora",
              dentro do painel. O tutorial é a saída para quem travou no BM. */}
          <TutorialTrigger host={host} metaTag={site.metaTag} variant="ghost" />
        </PageHeader>
      </div>

      <p className="mt-6 text-sm text-dark-400">
        CNPJ <span className="tabular-nums text-dark-200">{formatCNPJ(site.cnpj)}</span> ·
        site <span className="text-dark-200">{site.name}</span>
      </p>

      <StatusBanner
        siteId={site.id}
        state={state}
        host={host}
        lastCheckedLabel={label(lastCheckedAt)}
      />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/*
          O painel só aparece com o endereço no ar. Deixá-lo disponível durante a
          propagação convida o cliente a colar o código e clicar em verificar —
          que falharia sempre, porque a Meta não conseguiria abrir o site.
        */}
        {state === 'propagating' ? (
          <section className="card" aria-busy="true">
            <h2 className="text-lg font-semibold text-white">Verificação de domínio</h2>
            <p className="mt-2 text-sm text-dark-400">
              Disponível assim que <span className="text-dark-200">{host}</span>{' '}
              estiver acessível. Costuma levar de dois a quatro minutos depois da
              publicação.
            </p>

            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((linha) => (
                <div key={linha} className="h-10 w-full animate-pulse rounded-lg bg-white/5" />
              ))}
            </div>

            <p className="mt-4 text-xs text-dark-500">
              Enquanto espera, vale abrir o passo a passo no botão acima e deixar o
              Business Manager pronto na outra aba.
            </p>
          </section>
        ) : (
        <VerificationPanel
          siteId={site.id}
          host={host}
          customDomain={site.customDomain}
          metaTag={site.metaTag}
          metaTagVerified={site.metaTagVerified}
          metaTagLastCheckedLabel={label(site.metaTagLastCheckedAt)}
          verificationTxt={site.verificationTxt}
          verificationTxtVerified={site.verificationTxtVerified}
          verificationTxtLastCheckedLabel={label(site.verificationTxtLastCheckedAt)}
        />
        )}

        <SiteLiveCard
          host={host}
          url={url}
          isPublished={site.isPublished}
          viewsCount={site.viewsCount}
          diagnostic={diagnostic}
          diagnosticLabel={isoLabel(diagnostic?.checkedAt ?? null)}
        />
      </div>

      {/* Largura cheia: as seis linhas do diagnóstico ficam ilegíveis espremidas
          na coluna de 360px ao lado do formulário. */}
      <DiagnosticCard
        siteId={site.id}
        siteHost={host}
        customDomain={site.customDomain}
        initialDiagnostic={diagnostic}
        className="mt-6"
      />

      {/* A tabela consulta a Receita na primeira vez que o site é aberto (depois
          lê o `registryData` persistido). Sob Suspense para que o formulário de
          verificação — o motivo da visita — pinte sem esperar rede de terceiro. */}
      <Suspense fallback={<RegistryFallback />}>
        <BMDataTable site={site} className="mt-6" />
      </Suspense>

      <CnpjDocumentCard
        siteId={site.id}
        cnpj={site.cnpj}
        companyName={site.companyName}
        documentUrl={site.cnpjDocumentUrl}
        documentAtLabel={label(site.cnpjDocumentAt)}
        className="mt-6"
      />
    </>
  );
}

function RegistryFallback() {
  return (
    <section className="card mt-6" aria-busy="true">
      <div className="h-5 w-64 animate-pulse rounded bg-white/5" />
      <div className="mt-3 h-4 w-full max-w-xl animate-pulse rounded bg-white/5" />

      <div className="mt-6 space-y-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="h-9 w-full animate-pulse rounded-lg bg-white/5" />
        ))}
      </div>

      <p className="mt-4 text-xs text-dark-500">Consultando o cadastro na Receita Federal…</p>
    </section>
  );
}
