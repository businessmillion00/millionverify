/** 1 token = 1 site publicado. */
export const TOKENS_PER_SITE = 1;

/** Preço cheio do token, sem desconto. É a régua contra a qual a economia é medida. */
export const TOKEN_BASE_PRICE = 25;

/**
 * Desconto por volume. Ordem DECRESCENTE de `minimo`: a busca devolve a primeira
 * faixa que a quantidade alcança, então inverter a ordem daria sempre o preço
 * cheio.
 */
const PRICE_TIERS: ReadonlyArray<{ minimo: number; unitario: number }> = [
  { minimo: 10, unitario: 20 },
  { minimo: 1, unitario: TOKEN_BASE_PRICE },
];

/** Preço unitário aplicável à quantidade. */
export function tokenUnitPrice(tokens: number): number {
  return PRICE_TIERS.find((faixa) => tokens >= faixa.minimo)?.unitario ?? TOKEN_BASE_PRICE;
}

/** Menor quantidade que ativa desconto — a tela usa para convidar ao próximo degrau. */
export const TOKEN_DISCOUNT_THRESHOLD = 10;

/** Quantidades oferecidas como atalho na tela de compra. */
export const TOKEN_PRESETS = [1, 5, 10, 15] as const;

/**
 * Tokens creditados no cadastro. Zero: a conta nasce sem saldo e o usuário
 * compra o primeiro token para publicar. Trocar para um número positivo volta a
 * dar cortesia, sem mexer em mais nada.
 */
export const SIGNUP_BONUS_TOKENS = 0;

/** Faixa aceita na compra personalizada. */
export const TOKEN_MIN_PURCHASE = 1;
export const TOKEN_MAX_PURCHASE = 100;

/**
 * Quantidade maior que sai pelo mesmo preço ou mais barato — null quando não há.
 *
 * O desconto por degrau cria uma faixa perversa: 9 tokens custam R$ 225 e 10
 * custam R$ 200. Sem avisar, o cliente paga mais por levar menos e descobre
 * depois. A tela usa isto para oferecer o upgrade em vez de esconder.
 */
export function betterDeal(tokens: number): { tokens: number; price: number } | null {
  const atual = tokens * tokenUnitPrice(tokens);

  for (let candidato = tokens + 1; candidato <= TOKEN_MAX_PURCHASE; candidato++) {
    const preco = candidato * tokenUnitPrice(candidato);
    if (preco <= atual) return { tokens: candidato, price: preco };
    // Passou do degrau sem ficar mais barato: adiante só encarece.
    if (tokenUnitPrice(candidato) === tokenUnitPrice(TOKEN_MAX_PURCHASE)) break;
  }

  return null;
}

/** "1 token" / "3 tokens" — evita o "1 tokens" espalhado pelas telas. */
export function tokenLabel(quantity: number): string {
  return `${quantity.toLocaleString('pt-BR')} ${quantity === 1 ? 'token' : 'tokens'}`;
}

export type TokenOrder = {
  tokens: number;
  price: number;
  unitPrice: number;
  /** Quanto custaria sem desconto — só para exibir o valor riscado. */
  listPrice: number;
  savings: number;
  /** Fração entre 0 e 1. Zero quando a quantidade não alcança nenhuma faixa. */
  discount: number;
  /** Quantos sites o pedido publica. Com 1 token por site, é o próprio total. */
  sites: number;
};

/**
 * Normaliza uma quantidade vinda de fora (formulário, querystring, API).
 * Devolve null em vez de corrigir silenciosamente: quantidade inválida é erro
 * de quem chamou, e arredondar por conta própria esconderia o defeito.
 */
export function parseTokenQuantity(value: unknown): number | null {
  const quantity = typeof value === 'string' ? Number(value.trim()) : value;

  if (typeof quantity !== 'number' || !Number.isInteger(quantity)) return null;
  if (quantity < TOKEN_MIN_PURCHASE || quantity > TOKEN_MAX_PURCHASE) return null;

  return quantity;
}

/**
 * Preço de um pedido. É a ÚNICA fonte do valor cobrado — o cliente manda a
 * quantidade, nunca o preço, senão bastaria alterar o formulário para pagar
 * menos do que deve.
 */
export function tokenOrder(tokens: number): TokenOrder {
  const unitPrice = tokenUnitPrice(tokens);
  const price = tokens * unitPrice;
  const listPrice = tokens * TOKEN_BASE_PRICE;

  return {
    tokens,
    price,
    unitPrice,
    listPrice,
    savings: listPrice - price,
    // Derivado do preço real, nunca guardado à parte: valor fixo divergiria em
    // silêncio na primeira vez que uma faixa mudasse.
    discount: listPrice > 0 ? 1 - price / listPrice : 0,
    sites: Math.floor(tokens / TOKENS_PER_SITE),
  };
}

export const SITE_RATE_LIMITS = {
  CREATE: 5, // máximo de sites por dia
  CHECK_CNPJ: 50, // máximo de verificações de CNPJ por dia
  CHECK_META_TAG: 100, // máximo de checks de meta tag por dia
} as const;

export const TIMEOUTS = {
  CNPJ_LOOKUP: 10000, // 10s para consulta de CNPJ
  META_TAG_CHECK: 15000, // 15s para verificar meta tag
  ASAAS_PAYMENT: 30000, // 30s para criar pagamento
} as const;

export const ASAAS_CONFIG = {
  WEBHOOK_TIMEOUT: 30000,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000,
} as const;

export const APP_CONFIG = {
  NAME: 'Million Verify',
  DESCRIPTION: 'Verificador de Business Managers e Gerador de Sites',
  DOMAIN: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  /*
   * Domínio dos sites de cliente. Vem do ambiente para o mesmo código servir
   * produção, staging e um domínio novo sem varredura no repositório — o valor
   * estava cravado em quinze lugares.
   */
  SUBDOMAIN_SUFFIX: process.env.NEXT_PUBLIC_SUBDOMAIN_SUFFIX || '.million-verify.com',
} as const;
