import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Prisma } from '@prisma/client';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { formatCNPJ } from '@/lib/utils';
import { TOKENS_PER_SITE } from '@/lib/constants';
import { siteHost, siteUrl } from '@/lib/subdomain';
import {
  deleteSiteForm,
  setSitePublishedForm,
  setSiteTemplateForm,
  updateSiteDetailsForm,
} from '@/app/actions/site-manage';

export const dynamic = 'force-dynamic';

/** Mesma lista aceita por setSiteTemplate — a canônica vive em components/site-templates/types. */
const TEMPLATES = [
  {
    key: 'minimal',
    label: 'Minimal',
    description: 'Uma dobra só, tipografia grande. O caminho mais curto até a verificação.',
  },
  {
    key: 'corporate',
    label: 'Corporate',
    description: 'Hero, serviços, endereço e contato — a cara de uma empresa tradicional.',
  },
  {
    key: 'bold',
    label: 'Bold',
    description: 'Gradiente derivado da cor de destaque e tipografia display.',
  },
] as const;

type TemplateKey = (typeof TEMPLATES)[number]['key'];

type SearchParam = string | string[] | undefined;

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: SearchParam; erro?: SearchParam }>;
};

/** A querystring pode repetir a mesma chave; vale a primeira ocorrência. */
const first = (value: SearchParam): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '');

const readTemplateKey = (theme: Prisma.JsonValue): TemplateKey => {
  if (theme !== null && typeof theme === 'object' && !Array.isArray(theme)) {
    const stored = theme.template;

    const match = TEMPLATES.find((template) => template.key === stored);
    if (match) return match.key;
  }

  // Todo site criado antes da escolha de template cai no padrão.
  return 'minimal';
};

export default async function SiteManagePage({ params, searchParams }: Props) {
  const session = await auth();
  const { id } = await params;
  const feedback = await searchParams;
  const okMessage = first(feedback.ok);
  const errorMessage = first(feedback.erro);

  // A busca é sempre amarrada ao dono: um id de outro usuário responde 404.
  const site = await prisma.site.findFirst({
    where: { id, userId: session!.user.id, isDeleted: false },
  });

  if (!site) notFound();

  const currentTemplate = readTemplateKey(site.theme);

  return (
    <>
      <Link
        href="/dashboard/sites"
        className="text-xs uppercase tracking-widest text-dark-500 transition-colors hover:text-amber-400"
      >
        ← Voltar para os sites
      </Link>

      <header className="mt-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{site.name}</h1>
          <p className="mt-2 text-sm text-dark-400">
            {site.companyName} ·{' '}
            <span className="tabular-nums">{formatCNPJ(site.cnpj)}</span>
          </p>
          <p className="mt-1 text-xs text-dark-500">
            Criado em {site.createdAt.toLocaleDateString('pt-BR')} ·{' '}
            <span className="tabular-nums">
              {site.viewsCount.toLocaleString('pt-BR')}
            </span>{' '}
            visualizações
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className={site.isPublished ? 'badge badge-success' : 'badge badge-warning'}>
            {site.isPublished ? 'No ar' : 'Rascunho'}
          </span>

          <span
            className={
              site.metaTagVerified || site.verificationTxtVerified
                ? 'badge badge-success'
                : 'badge badge-amber'
            }
          >
            {site.metaTagVerified || site.verificationTxtVerified
              ? 'Domínio verificado'
              : 'Verificação pendente'}
          </span>

          {/* Único caminho para /verificacao no painel — é a tela que resolve o
              problema que trouxe o cliente até aqui (destravar a BM). */}
          <Link href={`/dashboard/sites/${site.id}/verificacao`} className="btn-primary">
            Verificação da Meta
          </Link>
        </div>
      </header>

      {okMessage && <p className="badge badge-success mt-6">{okMessage}</p>}
      {errorMessage && <p className="badge badge-error mt-6">{errorMessage}</p>}

      <div className="mt-10 grid gap-6 lg:grid-cols-3">
        <form action={updateSiteDetailsForm} className="card lg:col-span-2">
          <input type="hidden" name="siteId" value={site.id} />

          <h2 className="text-xl font-semibold">Identidade</h2>
          <p className="mt-1 text-sm text-dark-400">
            Razão social e CNPJ vêm da Receita Federal e não são editáveis.
          </p>

          <div className="mt-6 space-y-5">
            <div>
              <label htmlFor="name" className="mb-2 block text-sm font-medium">
                Nome do site
              </label>
              <input
                id="name"
                name="name"
                defaultValue={site.name}
                minLength={3}
                maxLength={100}
                required
                className="w-full"
              />
            </div>

            <div>
              <label htmlFor="description" className="mb-2 block text-sm font-medium">
                Descrição
              </label>
              <textarea
                id="description"
                name="description"
                rows={4}
                maxLength={500}
                defaultValue={site.description ?? ''}
                placeholder="O que a empresa faz, em uma ou duas frases."
                className="w-full"
              />
              <p className="mt-1 text-xs text-dark-500">
                Até 500 caracteres. Aparece na página e na prévia dos links.
              </p>
            </div>

            <div>
              <label htmlFor="metaTag" className="mb-2 block text-sm font-medium">
                Código de verificação da Meta
              </label>
              <input
                id="metaTag"
                name="metaTag"
                defaultValue={site.metaTag ?? ''}
                maxLength={500}
                autoComplete="off"
                spellCheck={false}
                placeholder="ex.: a1b2c3d4e5f6"
                className="w-full font-mono"
              />
              <p className="mt-1 text-xs text-dark-500">
                Pode colar a tag inteira: guardamos só o valor de{' '}
                <span className="font-mono">content=&quot;...&quot;</span>, porque a
                verificação compara essa string crua dentro do HTML publicado. Trocar o
                código zera a checagem até o próximo ciclo.
              </p>
            </div>
          </div>

          <button type="submit" className="btn-primary mt-6">
            Salvar alterações
          </button>
        </form>

        <div className="space-y-6">
          <section className="card">
            <h2 className="text-xl font-semibold">Domínio</h2>

            <a
              href={siteUrl(site)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 block break-all text-sm text-amber-400 hover:underline"
            >
              {siteHost(site)}
            </a>
            <p className="mt-2 text-xs text-dark-500">
              O subdomínio é definido na criação e não pode ser alterado.
            </p>

            <div className="divider my-5" />

            <p className="text-xs uppercase tracking-widest text-dark-500">
              Verificação da Meta
            </p>

            <p className="mt-3">
              <span
                className={
                  site.metaTagVerified
                    ? 'badge badge-success'
                    : site.metaTag
                      ? 'badge badge-warning'
                      : 'badge badge-error'
                }
              >
                {site.metaTagVerified
                  ? 'Tag ativa'
                  : site.metaTag
                    ? 'Aguardando verificação'
                    : 'Sem código'}
              </span>
            </p>

            <p className="mt-3 text-xs text-dark-500">
              {site.metaTagLastCheckedAt
                ? `Última checagem em ${site.metaTagLastCheckedAt.toLocaleString('pt-BR')}`
                : 'Este site ainda não passou por uma checagem.'}
            </p>
          </section>

          <form action={setSitePublishedForm} className="card">
            <input type="hidden" name="siteId" value={site.id} />
            <input
              type="hidden"
              name="published"
              value={site.isPublished ? 'false' : 'true'}
            />

            <h2 className="text-xl font-semibold">Publicação</h2>
            <p className="mt-3 text-sm text-dark-400">
              {site.isPublished
                ? 'O site está no ar e contabiliza visualizações.'
                : 'Fora do ar: visitantes recebem página não encontrada e a verificação da Meta falha enquanto estiver assim.'}
            </p>

            <button type="submit" className="btn-secondary mt-5">
              {site.isPublished ? 'Despublicar' : 'Publicar'}
            </button>
          </form>
        </div>
      </div>

      <form action={setSiteTemplateForm} className="card mt-6">
        <input type="hidden" name="siteId" value={site.id} />

        <h2 className="text-xl font-semibold">Template</h2>
        <p className="mt-1 text-sm text-dark-400">
          Muda apenas a aparência da página pública — conteúdo, cores e código de
          verificação continuam iguais.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {TEMPLATES.map((template) => {
            const selected = template.key === currentTemplate;

            return (
              <button
                key={template.key}
                type="submit"
                name="template"
                value={template.key}
                aria-pressed={selected}
                className={
                  selected
                    ? 'rounded-xl border border-amber-500/50 bg-white/5 p-4 text-left shadow-amber-glow'
                    : 'rounded-xl border border-dark-700 bg-white/5 p-4 text-left transition-colors hover:border-amber-500/40'
                }
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{template.label}</span>
                  {selected && (
                    <span className="text-xs uppercase tracking-widest text-amber-400">
                      Atual
                    </span>
                  )}
                </span>
                <span className="mt-2 block text-xs text-dark-400">
                  {template.description}
                </span>
              </button>
            );
          })}
        </div>
      </form>

      <form
        action={deleteSiteForm}
        className="mt-6 rounded-xl border border-red-500/30 bg-red-500/5 p-6"
      >
        <input type="hidden" name="siteId" value={site.id} />

        <h2 className="text-xl font-semibold text-red-400">Excluir site</h2>
        <p className="mt-2 max-w-3xl text-sm text-dark-400">
          O site sai do ar na hora e some do painel. Os {TOKENS_PER_SITE} tokens da
          criação não são devolvidos e o subdomínio{' '}
          <span className="text-white">{site.subdomain}</span> continua reservado — não
          poderá ser reutilizado, nem por você.
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="confirmation" className="mb-2 block text-sm font-medium">
              Digite <span className="text-white">{site.subdomain}</span> para confirmar
            </label>
            <input
              id="confirmation"
              name="confirmation"
              autoComplete="off"
              spellCheck={false}
              placeholder={site.subdomain}
              required
              className="w-72"
            />
          </div>

          <button type="submit" className="btn-secondary">
            Excluir definitivamente
          </button>
        </div>
      </form>
    </>
  );
}
