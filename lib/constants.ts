/** 1 token = 1 site publicado. */
export const TOKENS_PER_SITE = 1;

/** Preço unitário em reais. O total é linear: não há desconto por volume. */
export const TOKEN_UNIT_PRICE = 29;

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

/** "1 token" / "3 tokens" — evita o "1 tokens" espalhado pelas telas. */
export function tokenLabel(quantity: number): string {
  return `${quantity.toLocaleString('pt-BR')} ${quantity === 1 ? 'token' : 'tokens'}`;
}

export type TokenOrder = {
  tokens: number;
  price: number;
  unitPrice: number;
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
  return {
    tokens,
    price: tokens * TOKEN_UNIT_PRICE,
    unitPrice: TOKEN_UNIT_PRICE,
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
  NAME: 'Business Million',
  DESCRIPTION: 'Verificador de Business Managers e Gerador de Sites',
  DOMAIN: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  /*
   * Domínio dos sites de cliente. Vem do ambiente para o mesmo código servir
   * produção, staging e um domínio novo sem varredura no repositório — o valor
   * estava cravado em quinze lugares.
   */
  SUBDOMAIN_SUFFIX: process.env.NEXT_PUBLIC_SUBDOMAIN_SUFFIX || '.businessmillion.app',
} as const;
