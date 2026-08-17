/**
 * Conteúdo do tutorial "Como colar a tag no Facebook BM" — e o VOCABULÁRIO comum a
 * todos os tutoriais guiados da tela de verificação.
 *
 * Este módulo é dado puro: sem 'use client', sem 'use server', sem JSX. Ele pode
 * ser importado tanto por um Server Component quanto por um Client Component —
 * é por isso que as constantes compartilhadas (URLs do Business Manager, formato
 * da meta tag, normalização de domínio) moram aqui e não dentro de um componente
 * marcado com 'use client': em RSC, todo export de um módulo 'use client' vira
 * referência de cliente e o servidor recebe um objeto opaco no lugar da string.
 *
 * A apresentação (modal, animação, foco) vive em tutorial-modal.tsx. Trocar o
 * texto de um passo não deve exigir tocar em uma linha de JSX.
 *
 * Os TIPOS (TutorialStep, TutorialVars, TutorialCopySlot…) também moram aqui e são
 * importados por outros roteiros — `cnpj-tutorial-steps.ts` é o segundo. O modal não
 * conhece nenhum roteiro em particular: recebe `steps` e `vars` por prop.
 */

/** Home do Business Manager — destino do passo 1. */
export const BM_HOME_URL = 'https://business.facebook.com';

/**
 * Atalho oficial para Configurações do negócio → Segurança da marca → Domínios.
 *
 * FONTE ÚNICA da URL em todo o projeto: `status-banner.tsx` e
 * `verification-panel.tsx` importam daqui. Este módulo é dado puro (sem
 * 'use client'), então serve tanto o servidor quanto o cliente — era esse o
 * motivo de a constante ter sido duplicada, e ele não existe mais.
 */
export const BM_DOMAINS_URL = 'https://business.facebook.com/settings/owned-domains';

/** Título do modal — usado também no rótulo acessível do diálogo. */
export const TUTORIAL_TITLE = 'Como colar a tag no Facebook BM';

/** Linha de apoio abaixo do título. */
export const TUTORIAL_SUBTITLE =
  'Seis passos do login no Business Manager até o domínio verificado.';

/**
 * Valores dinâmicos que o modal injeta nos textos dos passos.
 *
 * Mapa aberto de propósito: cada roteiro declara as chaves de que precisa
 * (`{host}` no tutorial do Facebook, `{cnpj}` no do comprovante) e quem monta o
 * modal entrega o mapa correspondente. Uma chave sem valor no mapa é deixada como
 * está no texto, em vez de virar "undefined" na tela.
 */
export type TutorialVars = Readonly<Record<string, string>>;

/**
 * Campo copiável que o passo entrega pronto.
 *
 * Existe porque o dado concreto (domínio, código da tag, CNPJ) só é conhecido em
 * runtime: o passo declara QUAL chave de `vars` precisa mostrar, o modal decide
 * COMO renderizar. `source` é chave livre — nenhum roteiro depende de o modal
 * conhecer o nome dela.
 */
export type TutorialCopySlot = {
  /** Rótulo do campo, com o mesmo nome que o serviço de destino usa. */
  readonly label: string;
  /** Chave de `vars` cujo valor vai para a área de transferência. */
  readonly source: string;
  /** Texto auxiliar sob o campo. Aceita marcadores e ênfase. */
  readonly hint?: string;
  /** Bloco de várias linhas (código, snippet). */
  readonly multiline?: boolean;
  /**
   * Mensagem exibida quando `vars[source]` está vazio — o passo continua
   * fazendo sentido em vez de mostrar um campo copiável sem nada dentro.
   */
  readonly empty?: string;
};

/** Bloco destacado para a informação que, se passar batido, vira chamado de suporte. */
export type TutorialCallout = {
  readonly title: string;
  readonly body: string;
};

/** Link externo do passo (sempre abre em nova aba). Aceita marcadores no `href`. */
export type TutorialExternalLink = {
  readonly href: string;
  readonly label: string;
};

export type TutorialStep = {
  /** Identificador estável — serve de key na troca animada e no rótulo do passo. */
  readonly id: string;
  /** Rótulo curto da lista de progresso lateral. */
  readonly short: string;
  /** Título do passo, dentro do modal. */
  readonly title: string;
  /** Parágrafos do corpo. Aceitam marcadores como `{host}` e ênfase com `**`. */
  readonly body: readonly string[];
  /** Observação secundária, em fonte menor. Aceita marcadores e ênfase. */
  readonly hint?: string;
  /** Dado pronto para copiar que este passo precisa mostrar. */
  readonly copy?: TutorialCopySlot;
  /** Aviso em destaque. */
  readonly callout?: TutorialCallout;
  /** Botão externo do passo. */
  readonly external?: TutorialExternalLink;
};

/** Pedaço de texto já resolvido, pronto para virar `<span>` ou `<strong>`. */
export type TutorialTextChunk = {
  readonly text: string;
  readonly strong: boolean;
};

/** Marcador de valor dinâmico: `{host}`, `{cnpj}`, `{empresa}`… */
const VAR_MARKER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/** Ênfase inline: `**Consultar**` vira o nome exato do botão, em destaque. */
const EMPHASIS_MARKER = /\*\*([^*]+)\*\*/g;

/**
 * Substitui os marcadores do texto pelos valores reais.
 *
 * A função de reposição é intencional: passar a string direta faria o `replace`
 * interpretar sequências como `$&` dentro de um host, o que ninguém espera.
 *
 * Marcador sem valor correspondente fica literal no texto — errar o nome da chave
 * aparece como `{cnpj}` na tela, que é um bug visível, e não como uma frase mutilada.
 */
export function applyTutorialVars(text: string, vars: TutorialVars): string {
  return text.replace(VAR_MARKER, (marker: string, key: string) => {
    const value = vars[key];
    return typeof value === 'string' ? value : marker;
  });
}

/**
 * Resolve marcadores e quebra o texto em pedaços com e sem ênfase.
 *
 * O roteiro precisa grifar o nome EXATO de um botão ("clique em **Consultar**")
 * sem que o dado vire JSX: quem escreve o passo não deveria abrir um arquivo .tsx
 * para deixar duas palavras em destaque.
 */
export function tutorialChunks(
  text: string,
  vars: TutorialVars,
): readonly TutorialTextChunk[] {
  const resolved = applyTutorialVars(text, vars);
  const chunks: TutorialTextChunk[] = [];
  let cursor = 0;

  // matchAll clona a regex internamente, então a constante de módulo não guarda
  // lastIndex entre chamadas — nenhum passo "pula" ênfase por causa do anterior.
  for (const match of resolved.matchAll(EMPHASIS_MARKER)) {
    const start = match.index ?? 0;

    if (start > cursor) {
      chunks.push({ text: resolved.slice(cursor, start), strong: false });
    }

    chunks.push({ text: match[1], strong: true });
    cursor = start + match[0].length;
  }

  if (cursor < resolved.length) {
    chunks.push({ text: resolved.slice(cursor), strong: false });
  }

  return chunks;
}

/**
 * Reduz qualquer endereço à forma que o Business Manager aceita no campo de
 * domínio: sem protocolo, sem `www.`, sem barra final, sem caixa alta.
 *
 * É o erro nº 1 do fluxo — colar `https://empresa.com/` cadastra um domínio que
 * nunca vai bater com o que a Meta visita. Normalizar aqui é mais barato do que
 * explicar depois.
 */
export function bareDomain(value: string): string {
  return value
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Monta a linha exata que é servida no <head> do site. */
export function metaTagSnippet(token: string): string {
  return `<meta name="facebook-domain-verification" content="${token}" />`;
}

/**
 * Mapa de substituição do tutorial do Facebook.
 *
 * Fica aqui, e não dentro do gatilho, porque é ele que amarra a chave usada nos
 * textos (`{host}`) ao dado real. Trocar o nome do marcador passa a ser uma
 * edição de um arquivo só.
 */
export function tutorialVars(host: string, metaTag: string | null): TutorialVars {
  return {
    host: bareDomain(host),
    // String vazia — e não ausência — é o que faz o passo cair no texto de
    // `empty` do campo copiável em vez de mostrar uma caixa vazia.
    metaTag: metaTag ? metaTagSnippet(metaTag) : '',
  };
}

/**
 * Os seis passos.
 *
 * O texto descreve o NOSSO produto, não o Meta genérico: o site já está no ar
 * com a tag no <head>, o método TXT não se aplica ao subdomínio da plataforma, e
 * o botão "Diagnosticar agora" do painel serve de prova quando a Meta recusa.
 */
export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'abrir-bm',
    short: 'Abrir o Business Manager',
    title: 'Abra o Meta Business Manager',
    body: [
      'Entre no Business Manager com a conta que administra a BM bloqueada. Se você administra mais de uma, confira no seletor do topo se a que está aberta é realmente a que precisa ser destravada — verificar o domínio na BM errada não destrava nada.',
      'Do nosso lado já está tudo pronto: o site institucional está publicado em {host} e a tag de verificação é servida no <head> dele. Você não precisa mexer no site em momento algum.',
    ],
    hint: 'Abra em uma nova aba, no mesmo navegador em que você já está logado no Facebook. Assim este passo a passo continua aqui do lado.',
    external: { href: BM_HOME_URL, label: 'Abrir business.facebook.com' },
  },
  {
    id: 'centro-de-protecao',
    short: 'Encontrar Domínios',
    title: 'Vá em Centro de proteção → Domínios',
    body: [
      'No menu lateral, abra as Configurações do negócio e procure a seção Centro de proteção. Dentro dela está o item Domínios.',
      'O nome desse menu muda conforme a versão da conta: em muitas Business Managers o mesmo lugar aparece como Segurança da marca → Domínios. É a mesma tela — se encontrar um dos dois, siga por ele e ignore o outro nome.',
    ],
    hint: 'Se a seção não aparecer, sua conta provavelmente não é administradora dessa Business Manager. Só administrador consegue verificar domínio.',
    external: { href: BM_DOMAINS_URL, label: 'Ir direto para Domínios' },
  },
  {
    id: 'adicionar-dominio',
    short: 'Adicionar o domínio',
    title: 'Clique em "Adicionar" e cole o domínio',
    body: [
      'Na tela de Domínios, clique em Adicionar. Vai abrir um campo pedindo o endereço do site. Cole exatamente o que está abaixo.',
      'Sem https://, sem www e sem barra no final. A Meta trata cada variação como um domínio diferente: um caractere sobrando cadastra um domínio que ela nunca vai conseguir visitar, e a verificação fica pendente para sempre.',
    ],
    copy: {
      label: 'Domínio',
      source: 'host',
      hint: 'Cole exatamente assim no campo do Business Manager.',
    },
    hint: 'Use o botão de copiar em vez de digitar. Erro de digitação nesse campo é a causa mais comum de verificação que não conclui.',
  },
  {
    id: 'metodo-meta-tag',
    short: 'Escolher "Meta tag"',
    title: 'Escolha "Meta tag" como método',
    body: [
      'Depois de adicionar o domínio, a Meta oferece três formas de provar que ele é seu: meta tag no HTML, upload de arquivo HTML e registro TXT no DNS. Escolha a opção de meta tag.',
      'A tela vai mostrar uma linha começando com <meta name="facebook-domain-verification" …>. É essa linha que você leva para o próximo passo. Deixe a aba aberta.',
    ],
    callout: {
      title: 'Por que não o registro TXT',
      body: 'O TXT não vai no HTML: ele é uma entrada na zona DNS do domínio. A zona de {host} é nossa, então você não tem onde criar esse registro — a instrução seria impossível de executar. O caminho por meta tag, além de ser o que funciona aqui, vale na hora, enquanto o DNS levaria de 5 a 15 minutos para propagar.',
    },
  },
  {
    id: 'colar-no-painel',
    short: 'Colar a tag no painel',
    title: 'Cole a meta tag aqui no painel',
    body: [
      'Copie a linha que a Meta mostrou e cole no campo Código da meta tag, nesta mesma tela de verificação, logo abaixo. Pode colar a linha inteira: guardamos apenas o valor de content.',
      'Ao salvar, a tag entra no <head> de {host} na mesma hora. Não é preciso republicar o site, refazer o build nem esperar propagação de DNS.',
    ],
    copy: {
      label: 'Tag salva hoje',
      source: 'metaTag',
      hint: 'É esta linha que está sendo servida no <head> de {host}.',
      multiline: true,
      empty:
        'Nenhum código salvo ainda. Feche este tutorial, cole a tag no campo **Código da meta tag** e clique em **Salvar e verificar**. Quando voltar aqui, ela aparece neste espaço pronta para conferência.',
    },
    hint: 'Trocar o código zera a confirmação anterior de propósito: a checagem roda de novo contra o HTML que está no ar, para você nunca ver "verificado" por causa de um código antigo.',
  },
  {
    id: 'verificar-no-bm',
    short: 'Verificar no Facebook',
    title: 'Volte ao Facebook e clique em "Verificar"',
    body: [
      'De volta à tela de Domínios do Business Manager, selecione o domínio e clique em Verificar domínio. É esse clique que destrava a Business Manager: nós servimos a tag, mas quem confirma é a Meta.',
      'Se ela recusar, não abra chamado ainda. Use o botão Diagnosticar agora aqui no painel: ele abre o seu endereço neste instante e mostra se a tag está sendo servida. Estando servida, o problema é do lado da Meta e costuma resolver tentando de novo em alguns minutos.',
    ],
    callout: {
      title: 'Isso verificou o DOMÍNIO — e é o suficiente para anunciar',
      body: 'A Verificação da Empresa, aquela que pede contrato social, comprovante de endereço e outros documentos, é OUTRA coisa: fica em outro menu, roda em outro processo e não é obrigatória para a maioria das contas. Se o seu bloqueio era falta de verificação de domínio, ele termina aqui. Não abra o processo de verificação de empresa achando que faltou alguma etapa.',
    },
    external: { href: BM_DOMAINS_URL, label: 'Voltar para Domínios' },
  },
] as const;

/** Quantidade de passos — evita repetir `TUTORIAL_STEPS.length` na apresentação. */
export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;
