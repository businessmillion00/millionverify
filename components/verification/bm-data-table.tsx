/**
 * Tabela "Dados para o Business Manager".
 *
 * A Meta compara, campo a campo, o que o cliente digita no Business Manager com o que
 * consta no CNPJ. Um CEP com um dígito trocado ou uma razão social abreviada derruba a
 * análise. Por isso nada aqui é digitado: cada linha sai por `<CopyField>`.
 *
 * Este módulo NÃO leva 'use client' de propósito — ele é a casa do parser de
 * `Site.registryData`, e `app/api/sites/[id]/registry/route.ts` precisa importá-lo do
 * lado servidor. Num módulo 'use client' todo export vira referência de cliente e a
 * chamada quebraria em runtime.
 *
 * `registryData` nasce NULO: `createSite` consulta a Receita mas descarta o payload.
 * Então a resolução é preguiçosa — na primeira renderização buscamos na BrasilAPI e
 * persistimos o payload BRUTO na coluna; das próximas vezes é só leitura de banco.
 */

import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { CopyField } from '@/components/verification/copy-field';
import { formatCep } from '@/components/site-templates/types';
import { SITE_RATE_LIMITS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { siteUrl, type SiteDomain } from '@/lib/subdomain';
import { cn, formatCNPJ } from '@/lib/utils';
import { rateLimit } from '@/lib/utils/rate-limit';
import { brasilAPIService } from '@/services/brasil-api';

const DAY_MS = 86_400_000;


/* ════════════════════ MODELO NORMALIZADO ════════════════════ */

/**
 * Recorte útil do cadastro da Receita. Tudo opcional: o payload guardado pode ser o
 * bruto da BrasilAPI (snake_case) ou o recorte de `CNPJInfo` (camelCase, com
 * `headquarters`), e nenhum dos dois garante campo algum.
 */
export type RegistryData = {
  companyName?: string;
  tradeName?: string;
  status?: string;
  legalNature?: string;
  size?: string;
  mainActivity?: string;
  foundedAt?: string;
  capital?: number;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Aceita número porque a BrasilAPI devolve `cep` e telefones ora como texto, ora como número. */
const asText = (value: unknown): string | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

/** CEP que veio como número perdeu o zero à esquerda (01310-100 → 1310100). */
const asCep = (value: unknown): string | undefined => {
  const text = asText(value);
  if (!text) return undefined;

  const digits = text.replace(/\D/g, '');
  if (digits.length === 7) return `0${digits}`;

  return digits.length > 0 ? digits : undefined;
};

const asDigits = (value: unknown): string | undefined => {
  const text = asText(value);
  if (!text) return undefined;

  const digits = text.replace(/\D/g, '');
  return digits.length > 0 ? digits : undefined;
};

/**
 * Normaliza o Json da coluna sem um único cast. Devolve `null` quando não sobrou nada
 * aproveitável — é esse `null` que dispara a consulta à Receita.
 */
export function parseRegistryData(value: unknown): RegistryData | null {
  const raw = asRecord(value);
  // Formato de `CNPJInfo` (services/brasil-api.ts), caso alguém grave o recorte mapeado.
  const hq = asRecord(raw.headquarters);

  const data: RegistryData = {
    companyName: asText(raw.razao_social) ?? asText(raw.name),
    tradeName: asText(raw.nome_fantasia) ?? asText(raw.tradeName),
    status: asText(raw.descricao_situacao_cadastral) ?? asText(raw.status),
    legalNature: asText(raw.natureza_juridica),
    size: asText(raw.porte),
    mainActivity: asText(raw.cnae_fiscal_descricao) ?? asText(raw.mainActivity),
    foundedAt: asText(raw.data_inicio_atividade) ?? asText(raw.foundedAt),
    capital: asNumber(raw.capital_social) ?? asNumber(raw.capital),
    street: asText(raw.logradouro) ?? asText(hq.street),
    number: asText(raw.numero) ?? asText(hq.number),
    complement: asText(raw.complemento) ?? asText(hq.complement),
    neighborhood: asText(raw.bairro) ?? asText(hq.neighborhood),
    city: asText(raw.municipio) ?? asText(hq.city),
    state: asText(raw.uf) ?? asText(hq.state),
    zipCode: asCep(raw.cep) ?? asCep(hq.zipCode),
    phone: asDigits(raw.ddd_telefone_1) ?? asDigits(raw.phone),
    email: asText(raw.email)?.toLowerCase(),
  };

  const hasAnything = Object.values(data).some((field) => field !== undefined);
  return hasAnything ? data : null;
}

/* ════════════════════ BUSCA E PERSISTÊNCIA ════════════════════ */

/**
 * Só `razao_social` é exigido: é o campo que separa um cadastro real do corpo de erro
 * da BrasilAPI. `.passthrough()` preserva CNAEs secundários, natureza jurídica, QSA e
 * tudo mais — a coluna promete guardar o payload BRUTO.
 */
const ReceitaPayloadSchema = z
  .object({ razao_social: z.string().trim().min(1) })
  .passthrough();

type ReceitaFetch =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'nao-encontrado' | 'indisponivel' };

/**
 * A consulta passa por `services/brasil-api.ts`, que usa axios.
 * NÃO troque por `fetch` nativo: o undici do Node não envia User-Agent e a
 * BrasilAPI responde 403 — a tabela ficaria eternamente "indisponível".
 */
async function fetchReceitaPayload(cnpjDigits: string): Promise<ReceitaFetch> {
  try {
    const info = await brasilAPIService.checkCNPJ(cnpjDigits);
    const parsed = ReceitaPayloadSchema.safeParse(info.raw);

    return parsed.success ? { ok: true, payload: parsed.data } : { ok: false, reason: 'indisponivel' };
  } catch (error) {
    // DNS, TLS, timeout, 404, JSON malformado: para o cliente é tudo "indisponível agora".
    console.warn(`Consulta à Receita falhou para o CNPJ ${cnpjDigits}:`, error);
    return { ok: false, reason: 'indisponivel' };
  }
}

/**
 * Converte um valor arbitrário no formato que o Prisma aceita em coluna Json.
 * `InputJsonObject` admite `null` nos VALORES (só a coluna inteira exigiria `Prisma.DbNull`),
 * então os nulos do payload da Receita são preservados como vieram.
 */
function toJsonValue(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  if (Array.isArray(value)) return value.map(toJsonValue);

  if (typeof value === 'object') {
    const output: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = toJsonValue(item);
    }
    return output;
  }

  // function, symbol, bigint: não existem em JSON.
  return null;
}

function toJsonObject(value: unknown): Prisma.InputJsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const output: Record<string, Prisma.InputJsonValue | null> = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = toJsonValue(item);
  }

  return output;
}

export type RegistrySource = 'armazenado' | 'receita' | 'indisponivel';

export type RegistryResolution = {
  data: RegistryData | null;
  source: RegistrySource;
  /** Mensagem pronta em pt-BR quando o cadastro não pôde ser obtido. */
  warning: string | null;
};

export type LoadRegistryInput = {
  siteId: string;
  userId: string;
  cnpj: string;
  /** `Site.registryData` como veio do Prisma (`Prisma.JsonValue | null`). */
  stored: unknown;
};

/**
 * Resolve o cadastro do CNPJ: usa o que já está na coluna, e só quando não há nada
 * consulta a Receita (via BrasilAPI) e persiste o payload bruto.
 *
 * Nunca lança: degradar com `data: null` mantém a tela em pé mostrando os campos que
 * vêm das colunas do próprio site.
 */
export async function loadRegistryData(input: LoadRegistryInput): Promise<RegistryResolution> {
  const stored = parseRegistryData(input.stored);
  if (stored) {
    return { data: stored, source: 'armazenado', warning: null };
  }

  const digits = input.cnpj.replace(/\D/g, '');
  if (digits.length !== 14) {
    return {
      data: null,
      source: 'indisponivel',
      warning:
        'O CNPJ cadastrado neste site não tem 14 dígitos, então não foi possível consultar a Receita Federal.',
    };
  }

  // Chave pelo usuário: o limite protege a BrasilAPI de um painel recarregado sem parar.
  const limit = await rateLimit(
    `registry-lookup:${input.userId}`,
    SITE_RATE_LIMITS.CHECK_CNPJ,
    DAY_MS,
  );

  if (!limit.success) {
    return {
      data: null,
      source: 'indisponivel',
      warning:
        'Você atingiu o limite de consultas à Receita Federal por hoje. Os dados abaixo vêm do cadastro do seu site.',
    };
  }

  const result = await fetchReceitaPayload(digits);

  if (!result.ok) {
    return {
      data: null,
      source: 'indisponivel',
      warning:
        result.reason === 'nao-encontrado'
          ? 'A Receita Federal não retornou cadastro para este CNPJ. Confira o número informado no site.'
          : 'Não foi possível consultar a Receita Federal agora. Os dados abaixo vêm do cadastro do seu site.',
    };
  }

  const parsed = parseRegistryData(result.payload);
  if (!parsed) {
    return {
      data: null,
      source: 'indisponivel',
      warning:
        'A Receita Federal respondeu, mas sem os dados cadastrais esperados. Tente novamente em alguns minutos.',
    };
  }

  const json = toJsonObject(result.payload);
  if (json) {
    // Escrita amarrada ao dono; `count === 0` só acontece se o site foi apagado no meio
    // do caminho — os dados já buscados continuam válidos para esta renderização.
    await prisma.site.updateMany({
      where: { id: input.siteId, userId: input.userId, isDeleted: false },
      data: { registryData: json },
    });
  }

  return { data: parsed, source: 'receita', warning: null };
}

/* ════════════════════ CAMPOS DO BUSINESS MANAGER ════════════════════ */

export type BmFieldKey =
  | 'razaoSocial'
  | 'nomeFantasia'
  | 'cnpj'
  | 'pais'
  | 'endereco'
  | 'bairro'
  | 'cidade'
  | 'estado'
  | 'cep'
  | 'telefone'
  | 'email'
  | 'website';

export type BmField = {
  key: BmFieldKey;
  /** Rótulo como o Business Manager chama o campo. */
  label: string;
  value: string | null;
  hint?: string;
  /** Campo que a Meta não exige: sem valor, não vira linha vazia na tela. */
  optional?: boolean;
};

export type BmSiteInput = SiteDomain & {
  companyName: string;
  cnpj: string;
  phone?: string | null;
  email?: string | null;
};

const UF_NAMES: Readonly<Record<string, string>> = {
  AC: 'Acre',
  AL: 'Alagoas',
  AP: 'Amapá',
  AM: 'Amazonas',
  BA: 'Bahia',
  CE: 'Ceará',
  DF: 'Distrito Federal',
  ES: 'Espírito Santo',
  GO: 'Goiás',
  MA: 'Maranhão',
  MT: 'Mato Grosso',
  MS: 'Mato Grosso do Sul',
  MG: 'Minas Gerais',
  PA: 'Pará',
  PB: 'Paraíba',
  PR: 'Paraná',
  PE: 'Pernambuco',
  PI: 'Piauí',
  RJ: 'Rio de Janeiro',
  RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul',
  RO: 'Rondônia',
  RR: 'Roraima',
  SC: 'Santa Catarina',
  SP: 'São Paulo',
  SE: 'Sergipe',
  TO: 'Tocantins',
};

/** A Meta guarda telefone em formato internacional; entregamos já pronto para colar. */
function formatInternationalPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const digits = raw.replace(/\D/g, '');

  if (digits.length === 11) {
    return `+55 ${digits.slice(0, 2)} ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `+55 ${digits.slice(0, 2)} ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  const fallback = raw.trim();
  return fallback.length > 0 ? fallback : null;
}

const firstFilled = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

/**
 * Fonte única dos campos: a tabela renderiza esta lista e a rota
 * `GET /api/sites/[id]/registry` serializa exatamente a mesma — assim tela e API nunca
 * discordam sobre o que mandar para a Meta.
 */
export function buildBmFields(input: {
  site: BmSiteInput;
  registry: RegistryData | null;
}): BmField[] {
  const { site, registry } = input;

  const street = registry?.street;
  const number = registry?.number;
  const complement = registry?.complement;

  const streetLine = firstFilled([street, number].filter(Boolean).join(', '));
  const address = firstFilled(
    [streetLine, complement].filter(Boolean).join(' - '),
  );

  const uf = registry?.state?.toUpperCase();
  const ufName = uf ? UF_NAMES[uf] : undefined;

  return [
    {
      key: 'razaoSocial',
      label: 'Razão social',
      value: firstFilled(registry?.companyName, site.companyName),
      hint: 'Nome legal da empresa. Escreva exatamente como está no cartão CNPJ, sem abreviar.',
    },
    {
      key: 'nomeFantasia',
      label: 'Nome fantasia',
      value: firstFilled(registry?.tradeName),
      hint: 'Opcional na Meta. Use no campo "Nome de exibição" quando ele existir.',
      optional: true,
    },
    {
      key: 'cnpj',
      label: 'CNPJ',
      value: firstFilled(formatCNPJ(site.cnpj)),
      hint: 'Número de identificação fiscal da empresa (Tax ID).',
    },
    {
      key: 'pais',
      label: 'País',
      value: 'Brasil',
      hint: 'No seletor em inglês da Meta, escolha "Brazil".',
    },
    {
      key: 'endereco',
      label: 'Endereço',
      value: address,
      hint: address
        ? 'Logradouro, número e complemento da sede, como constam na Receita.'
        : 'A Receita não retornou o endereço da sede. Use o endereço do cartão CNPJ.',
    },
    {
      key: 'bairro',
      label: 'Bairro',
      value: firstFilled(registry?.neighborhood),
      hint: 'Alguns formulários da Meta pedem o bairro na segunda linha do endereço.',
      optional: true,
    },
    {
      key: 'cidade',
      label: 'Cidade',
      value: firstFilled(registry?.city),
      hint: registry?.city
        ? undefined
        : 'A Receita não retornou a cidade. Use a que consta no cartão CNPJ.',
    },
    {
      key: 'estado',
      label: 'Estado',
      value: uf ?? null,
      hint: ufName
        ? `No seletor da Meta o estado aparece por extenso: ${ufName}.`
        : 'Sigla da unidade federativa da sede (por exemplo, SP).',
    },
    {
      key: 'cep',
      label: 'CEP',
      value: formatCep(registry?.zipCode),
      hint: 'Código postal. A Meta aceita com ou sem hífen.',
    },
    {
      key: 'telefone',
      label: 'Telefone',
      value: formatInternationalPhone(site.phone ?? registry?.phone),
      hint: site.phone || registry?.phone
        ? 'Formato internacional, como a Meta pede.'
        : 'Nem o cadastro do site nem a Receita têm telefone. Informe um número de contato válido da empresa.',
    },
    {
      key: 'email',
      label: 'E-mail',
      value: firstFilled(site.email, registry?.email),
      hint: 'E-mail de contato da empresa, usado quando a Meta pede um canal oficial.',
      optional: true,
    },
    {
      key: 'website',
      label: 'Site da empresa',
      value: siteUrl(site),
      hint: 'Este é o site que a Meta vai visitar. Em "Domínios", cadastre só o host, sem https:// e sem barra no final.',
    },
  ];
}

/** Bloco rotulado para colar num bloco de notas — só o que tem valor. */
export function buildCopyAllText(fields: readonly BmField[]): string {
  return fields
    .filter((field): field is BmField & { value: string } => field.value !== null)
    .map((field) => `${field.label}: ${field.value}`)
    .join('\n');
}

/* ════════════════════ COMPONENTE ════════════════════ */

type BmDataTableProps = {
  site: BmSiteInput & {
    id: string;
    userId: string;
    /** `Site.registryData` cru, do Prisma. */
    registryData?: unknown;
  };
  className?: string;
};

export async function BMDataTable({ site, className }: BmDataTableProps) {
  const resolution = await loadRegistryData({
    siteId: site.id,
    userId: site.userId,
    cnpj: site.cnpj,
    stored: site.registryData,
  });

  const fields = buildBmFields({ site, registry: resolution.data });
  const visible = fields.filter((field) => field.value !== null || !field.optional);
  const copyAll = buildCopyAllText(fields);
  const missing = visible.filter((field) => field.value === null).length;

  return (
    <section className={cn('card', className)} aria-labelledby="dados-business-manager">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dados-business-manager" className="text-lg font-semibold text-white">
            Dados para o Business Manager
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-dark-400">
            A Meta compara o que você digita com o cadastro do CNPJ. Copie cada campo daqui
            em vez de digitar: um caractere diferente já derruba a análise.
          </p>
        </div>

        <span
          className={`badge shrink-0 text-xs ${
            resolution.source === 'indisponivel' ? 'badge-warning' : 'badge-amber'
          }`}
          title={
            resolution.source === 'receita'
              ? 'Cadastro consultado agora na Receita Federal.'
              : resolution.source === 'armazenado'
                ? 'Cadastro consultado na Receita Federal e guardado neste site.'
                : 'Consulta indisponível no momento.'
          }
        >
          {resolution.source === 'indisponivel' ? 'Cadastro indisponível' : 'Receita Federal'}
        </span>
      </header>

      {resolution.warning && (
        <p className="mt-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-300">
          {resolution.warning}
        </p>
      )}

      <div className="mt-6 divide-y divide-dark-700/70">
        {visible.map((field) => (
          <div key={field.key} className="py-4 first:pt-0 last:pb-0">
            <CopyField label={field.label} value={field.value ?? ''} hint={field.hint} />
          </div>
        ))}
      </div>

      {missing > 0 && (
        <p className="mt-4 text-xs text-dark-500">
          {missing === 1
            ? '1 campo ficou sem valor: preencha-o à mão no Business Manager, conforme o cartão CNPJ.'
            : `${missing} campos ficaram sem valor: preencha-os à mão no Business Manager, conforme o cartão CNPJ.`}
        </p>
      )}

      <div className="divider my-6" />

      <CopyField
        label="Tudo de uma vez"
        value={copyAll}
        multiline
        hint="Bloco com todos os campos rotulados, para deixar aberto ao lado do Business Manager."
      />
    </section>
  );
}
