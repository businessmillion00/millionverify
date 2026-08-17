import type { ReactNode } from 'react';
import { formatCNPJ } from '@/lib/utils';
import {
  addressLines,
  buildPalette,
  formatPhoneHref,
  formatSiteDate,
  type SiteContent,
  type SiteTheme,
} from './types';

/** Caminho da política dentro do site do tenant. */
export const PRIVACY_POLICY_PATH = '/politica-de-privacidade';

/**
 * Espelha ROOT_HOSTS de middleware.ts:4-8. Só o middleware reescreve host de
 * tenant para /sites/{subdomain}; nos hosts raiz (produção e desenvolvimento)
 * a reescrita não acontece e o site é servido literalmente em /sites/{sub}.
 * Divergir desta lista faz o link do rodapé cair em 404 em desenvolvimento.
 */
const ROOT_HOSTS: ReadonlySet<string> = new Set([
  'businessmillion.app',
  'www.businessmillion.app',
  'localhost:3000',
]);

/**
 * Prefixo de rota do site do tenant para o host que serviu a requisição.
 * No subdomínio o navegador continua na raiz ('' + '/politica-de-privacidade');
 * no host raiz é preciso repetir o segmento /sites/{subdomain}.
 */
export function tenantBasePath(
  host: string | null | undefined,
  subdomain: string
): string {
  const normalized = host?.trim().toLowerCase() ?? '';

  return ROOT_HOSTS.has(normalized) ? `/sites/${subdomain}` : '';
}

export type PrivacyPolicyProps = {
  company: {
    /** Nome curto exibido no site (rótulo do cabeçalho). */
    name: string;
    /** Razão social — é ela que identifica o controlador. */
    companyName: string;
    cnpj: string;
  };
  /** Host público já resolvido (domínio próprio quando existe). */
  host: string;
  theme: SiteTheme;
  content: SiteContent;
  /** Volta para a home do próprio site do tenant. */
  homeHref: string;
  /** Data ISO da última alteração do site — vira "última atualização". */
  updatedAt: string;
};

type PolicySection = {
  id: string;
  title: string;
  body: ReactNode;
};

/**
 * Política de privacidade do SITE DO CLIENTE: o controlador é a empresa do
 * tenant, não a plataforma. Server component puro (nenhum JS de cliente), para
 * o crawler da Meta ler o documento inteiro no HTML entregue pelo servidor.
 */
export function PrivacyPolicy({
  company,
  host,
  theme,
  content,
  homeHref,
  updatedAt,
}: PrivacyPolicyProps) {
  const palette = buildPalette(theme);
  const cnpj = formatCNPJ(company.cnpj);
  const address = addressLines(content);
  const updated = formatSiteDate(updatedAt);

  const label = 'text-[0.7rem] uppercase tracking-[0.3em]';
  const paragraph = 'text-sm leading-relaxed sm:text-base';

  const channels: { label: string; value: string; href: string }[] = [];
  if (content.email) {
    channels.push({
      label: 'E-mail',
      value: content.email,
      href: `mailto:${content.email}`,
    });
  }
  if (content.phone) {
    channels.push({
      label: 'Telefone',
      value: content.phone,
      href: formatPhoneHref(content.phone),
    });
  }

  // Sem e-mail nem telefone cadastrados, o pedido do titular precisa de um
  // destino real: a sede. Nunca prometemos um canal que não existe.
  const requestChannelText =
    channels.length > 0
      ? 'pelos canais de contato indicados no início deste documento'
      : address.length > 0
        ? 'por correspondência endereçada à sede da empresa indicada no início deste documento'
        : 'pelos canais de atendimento divulgados pela empresa';

  const controller: { term: string; value: ReactNode }[] = [
    { term: 'Razão social', value: company.companyName },
    { term: 'CNPJ', value: cnpj },
  ];
  if (address.length > 0) {
    controller.push({
      term: 'Endereço da sede',
      value: (
        <span className="block">
          {address.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </span>
      ),
    });
  }
  for (const channel of channels) {
    controller.push({
      term: channel.label,
      value: (
        <a
          href={channel.href}
          style={{ color: palette.accent }}
          className="underline-offset-4 hover:underline"
        >
          {channel.value}
        </a>
      ),
    });
  }
  controller.push({ term: 'Site', value: host });

  const legalBases: { purpose: string; basis: string }[] = [
    {
      purpose:
        'Publicar as informações institucionais e cadastrais da empresa nesta página.',
      basis:
        'Dados tornados manifestamente públicos pelo titular e pelo poder público (art. 7º, §4º) e legítimo interesse (art. 7º, IX).',
    },
    {
      purpose:
        'Responder a mensagens, orçamentos e demais contatos recebidos pelos canais divulgados aqui.',
      basis:
        'Procedimentos preliminares e execução de contrato a pedido do titular (art. 7º, V).',
    },
    {
      purpose:
        'Manter os registros de acesso a esta página, gerados automaticamente pela hospedagem.',
      basis:
        'Cumprimento de obrigação legal (art. 7º, II), combinado com o art. 15 da Lei nº 12.965/2014 (Marco Civil da Internet).',
    },
    {
      purpose:
        'Prevenir fraudes, abusos e ataques, e apurar incidentes de segurança.',
      basis: 'Legítimo interesse do controlador (art. 7º, IX).',
    },
  ];

  const holderRights: string[] = [
    'Confirmação da existência de tratamento dos seus dados.',
    'Acesso aos dados que tratamos a seu respeito.',
    'Correção de dados incompletos, inexatos ou desatualizados.',
    'Anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a LGPD.',
    'Portabilidade dos dados a outro fornecedor de serviço ou produto, mediante requisição expressa e observados os segredos comercial e industrial.',
    'Eliminação dos dados pessoais tratados com o seu consentimento, ressalvadas as hipóteses de guarda obrigatória do art. 16.',
    'Informação sobre as entidades públicas e privadas com as quais compartilhamos os seus dados.',
    'Informação sobre a possibilidade de não fornecer consentimento e sobre as consequências da negativa.',
    'Revogação do consentimento, a qualquer momento, por manifestação expressa e gratuita.',
  ];

  const sections: PolicySection[] = [
    {
      id: 'controlador',
      title: 'Quem é o controlador dos seus dados',
      body: (
        <>
          <p className={paragraph}>
            O controlador dos dados pessoais tratados em razão deste site é{' '}
            <strong className="font-semibold">{company.companyName}</strong>,
            inscrita no CNPJ sob o nº {cnpj}. Controlador é a pessoa a quem
            competem as decisões sobre o tratamento de dados pessoais, conforme
            o art. 5º, VI, da Lei nº 13.709/2018 — Lei Geral de Proteção de
            Dados Pessoais (LGPD).
          </p>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            {controller.map((item) => (
              <div key={item.term}>
                <dt
                  style={{ color: palette.inkSubtle }}
                  className="text-xs uppercase tracking-[0.2em]"
                >
                  {item.term}
                </dt>
                <dd className="mt-2 break-words text-sm leading-relaxed">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
          <p style={{ color: palette.inkSubtle }} className="mt-6 text-sm leading-relaxed">
            Enquanto não houver encarregado (DPO) formalmente designado e
            divulgado, os pedidos relativos a dados pessoais devem ser dirigidos
            aos canais acima, que cumprem o papel previsto no art. 41, §2º, da
            LGPD.
          </p>
        </>
      ),
    },
    {
      id: 'abrangencia',
      title: 'A que esta política se aplica',
      body: (
        <>
          <p className={paragraph}>
            Esta Política descreve como {company.companyName} trata dados
            pessoais no site {host} e nos canais de contato divulgados nele. Ela
            se aplica a qualquer pessoa que acesse esta página ou entre em
            contato conosco a partir dela.
          </p>
          <p className={`${paragraph} mt-4`}>
            Sites de terceiros eventualmente acessados a partir de links
            publicados aqui possuem políticas próprias, pelas quais não
            respondemos. Recomendamos a leitura de cada uma delas.
          </p>
        </>
      ),
    },
    {
      id: 'origem-dos-dados',
      title: 'Origem das informações cadastrais publicadas',
      body: (
        <>
          <p className={paragraph}>
            As informações cadastrais da empresa exibidas neste site — razão
            social, CNPJ, data de início das atividades, atividade econômica,
            natureza jurídica e endereço da sede — são informações públicas do
            Cadastro Nacional da Pessoa Jurídica (CNPJ), mantido pela Receita
            Federal do Brasil, obtidas por meio da API pública BrasilAPI.
          </p>
          <p className={`${paragraph} mt-4`}>
            Esses dados são de acesso público e sua divulgação está amparada
            pelo art. 7º, §4º, da LGPD. Qualquer pessoa pode conferi-los
            gratuitamente, de forma independente, na consulta pública de CNPJ
            disponibilizada pela Receita Federal.
          </p>
          <p className={`${paragraph} mt-4`}>
            Esta é uma página institucional mantida pela própria empresa. Não é
            documento oficial, não foi emitida por órgão público e não substitui
            a consulta ao cadastro oficial.
          </p>
        </>
      ),
    },
    {
      id: 'dados-tratados',
      title: 'Quais dados pessoais tratamos',
      body: (
        <>
          <ul className="space-y-4">
            <li>
              <p className="text-sm font-semibold">
                Dados que você nos envia espontaneamente
              </p>
              <p
                style={{ color: palette.inkMuted }}
                className="mt-1 text-sm leading-relaxed"
              >
                Nome, e-mail, telefone e o conteúdo da mensagem, quando você nos
                escreve ou liga pelos canais divulgados nesta página.
              </p>
            </li>
            <li>
              <p className="text-sm font-semibold">Registros de acesso</p>
              <p
                style={{ color: palette.inkMuted }}
                className="mt-1 text-sm leading-relaxed"
              >
                Endereço IP, data e hora do acesso, página solicitada e agente
                de usuário (navegador e sistema operacional), registrados
                automaticamente pelos servidores que hospedam este site.
              </p>
            </li>
            <li>
              <p className="text-sm font-semibold">Contagem de visitas</p>
              <p
                style={{ color: palette.inkMuted }}
                className="mt-1 text-sm leading-relaxed"
              >
                Um contador agregado do número de acessos à página inicial, sem
                qualquer identificação individual do visitante e sem
                cruzamento com outros dados.
              </p>
            </li>
          </ul>
          <p className={`${paragraph} mt-6`}>
            Este site não possui formulário de cadastro, área de login, carrinho
            de compras ou qualquer recurso que colete dados pessoais diretamente
            do visitante. Não tratamos dados pessoais sensíveis (art. 5º, II, da
            LGPD).
          </p>
        </>
      ),
    },
    {
      id: 'cookies',
      title: 'Cookies e tecnologias semelhantes',
      body: (
        <p className={paragraph}>
          Este site não utiliza cookies de publicidade, de perfilamento
          comportamental nem ferramentas de análise de audiência de terceiros.
          Podem ser utilizados apenas cookies estritamente necessários ao
          funcionamento e à segurança da página, que não identificam o visitante
          e não são compartilhados para fins de marketing. Você pode bloquear ou
          apagar cookies nas configurações do seu navegador a qualquer momento.
        </p>
      ),
    },
    {
      id: 'finalidades',
      title: 'Para que usamos os dados e com que base legal',
      body: (
        <>
          <p className={paragraph}>
            Todo tratamento realizado por nós tem finalidade determinada e base
            legal correspondente, nos termos do art. 7º da LGPD:
          </p>
          <dl className="mt-6 space-y-5">
            {legalBases.map((item) => (
              <div
                key={item.purpose}
                style={{ borderColor: palette.hairline }}
                className="border-t pt-4"
              >
                <dt className="text-sm font-medium leading-relaxed">
                  {item.purpose}
                </dt>
                <dd
                  style={{ color: palette.inkSubtle }}
                  className="mt-2 text-sm leading-relaxed"
                >
                  {item.basis}
                </dd>
              </div>
            ))}
          </dl>
          <p className={`${paragraph} mt-6`}>
            Não utilizamos os seus dados para finalidades incompatíveis com as
            declaradas acima. Se isso vier a ser necessário, informaremos você
            previamente e, quando exigido, solicitaremos o seu consentimento.
          </p>
        </>
      ),
    },
    {
      id: 'compartilhamento',
      title: 'Com quem compartilhamos os dados',
      body: (
        <>
          <p className={paragraph}>
            Não vendemos, alugamos nem cedemos dados pessoais. O compartilhamento
            ocorre apenas nas seguintes hipóteses:
          </p>
          <ul
            style={{ color: palette.inkMuted }}
            className="mt-4 space-y-3 text-sm leading-relaxed"
          >
            <li>
              Operadores contratados para hospedagem do site, envio e recepção de
              e-mails e demais serviços de infraestrutura, que tratam dados em
              nosso nome e conforme as nossas instruções (art. 5º, VII, da LGPD);
            </li>
            <li>
              Assessores contábeis e jurídicos, quando indispensável ao
              cumprimento de obrigações legais ou regulatórias;
            </li>
            <li>
              Autoridades administrativas e judiciais, mediante requisição legal
              ou ordem judicial.
            </li>
          </ul>
        </>
      ),
    },
    {
      id: 'transferencia-internacional',
      title: 'Transferência internacional de dados',
      body: (
        <p className={paragraph}>
          Os provedores de infraestrutura que utilizamos podem manter servidores
          fora do território nacional. Nessa hipótese, a transferência
          internacional observa os arts. 33 a 36 da LGPD, mediante instrumentos
          contratuais que assegurem grau de proteção de dados compatível com o
          previsto na legislação brasileira.
        </p>
      ),
    },
    {
      id: 'retencao',
      title: 'Por quanto tempo guardamos os dados',
      body: (
        <>
          <ul
            style={{ color: palette.inkMuted }}
            className="space-y-3 text-sm leading-relaxed"
          >
            <li>
              <span style={{ color: palette.ink }} className="font-medium">
                Registros de acesso:
              </span>{' '}
              pelo prazo mínimo de 6 (seis) meses previsto no art. 15 do Marco
              Civil da Internet.
            </li>
            <li>
              <span style={{ color: palette.ink }} className="font-medium">
                Mensagens de contato:
              </span>{' '}
              enquanto durar a tratativa e, depois dela, pelo prazo necessário ao
              exercício regular de direitos em processo judicial, administrativo
              ou arbitral.
            </li>
            <li>
              <span style={{ color: palette.ink }} className="font-medium">
                Informações cadastrais públicas da empresa:
              </span>{' '}
              enquanto este site estiver no ar.
            </li>
          </ul>
          <p className={`${paragraph} mt-6`}>
            Encerrado o tratamento, os dados são eliminados, ressalvadas as
            hipóteses de conservação previstas no art. 16 da LGPD.
          </p>
        </>
      ),
    },
    {
      id: 'direitos',
      title: 'Seus direitos como titular',
      body: (
        <>
          <p className={paragraph}>
            O art. 18 da LGPD garante a você, a qualquer momento e mediante
            requisição, os seguintes direitos:
          </p>
          <ol className="mt-6 space-y-3">
            {holderRights.map((right, index) => (
              <li key={right} className="flex gap-4">
                <span
                  style={{ color: palette.accent }}
                  className="shrink-0 text-xs font-semibold tabular-nums"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span
                  style={{ color: palette.inkMuted }}
                  className="text-sm leading-relaxed"
                >
                  {right}
                </span>
              </li>
            ))}
          </ol>
          <p className={`${paragraph} mt-6`}>
            O art. 20 da LGPD assegura ainda a revisão de decisões tomadas
            exclusivamente com base em tratamento automatizado de dados. Este
            site não realiza decisões automatizadas, não faz perfilamento e não
            gera pontuação sobre visitantes.
          </p>
        </>
      ),
    },
    {
      id: 'exercicio-de-direitos',
      title: 'Como exercer os seus direitos',
      body: (
        <>
          <p className={paragraph}>
            Encaminhe o seu pedido {requestChannelText}, informando o direito que
            deseja exercer e os elementos que permitam a sua identificação como
            titular. Podemos solicitar informações adicionais para confirmar a
            identidade e evitar a entrega de dados à pessoa errada.
          </p>
          {channels.length > 0 && (
            <ul className="mt-6 grid gap-4 sm:grid-cols-2">
              {channels.map((channel) => (
                <li
                  key={channel.label}
                  style={{ borderColor: palette.hairline }}
                  className="border-t pt-4"
                >
                  <p
                    style={{ color: palette.inkSubtle }}
                    className="text-xs uppercase tracking-[0.2em]"
                  >
                    {channel.label}
                  </p>
                  <a
                    href={channel.href}
                    style={{ color: palette.accent }}
                    className="mt-2 block break-words text-sm underline-offset-4 hover:underline"
                  >
                    {channel.value}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className={`${paragraph} mt-6`}>
            Responderemos em formato simplificado de imediato ou, quando a
            declaração for completa, em até 15 (quinze) dias contados da
            requisição, conforme o art. 19, I e II, da LGPD. Você também pode
            apresentar reclamação à Autoridade Nacional de Proteção de Dados
            (ANPD), nos termos do art. 18, §1º.
          </p>
        </>
      ),
    },
    {
      id: 'seguranca',
      title: 'Segurança da informação',
      body: (
        <p className={paragraph}>
          Adotamos medidas técnicas e administrativas aptas a proteger os dados
          pessoais de acessos não autorizados e de situações acidentais ou
          ilícitas de destruição, perda, alteração, comunicação ou difusão (art.
          46 da LGPD), entre elas o tráfego cifrado por HTTPS, o controle de
          acesso aos sistemas e o princípio da coleta mínima. Nenhum sistema é
          totalmente imune a incidentes; ocorrendo incidente de segurança com
          risco relevante, comunicaremos os titulares afetados e a ANPD, na forma
          do art. 48.
        </p>
      ),
    },
    {
      id: 'criancas-e-adolescentes',
      title: 'Crianças e adolescentes',
      body: (
        <p className={paragraph}>
          Este site destina-se ao público adulto e não coleta intencionalmente
          dados pessoais de crianças e adolescentes. Constatado tratamento dessa
          natureza sem o amparo do art. 14 da LGPD, os dados serão eliminados
          assim que identificados.
        </p>
      ),
    },
    {
      id: 'alteracoes',
      title: 'Alterações desta política',
      body: (
        <p className={paragraph}>
          Esta Política pode ser atualizada para refletir mudanças na legislação,
          nos serviços prestados ou nas nossas práticas. A versão vigente é
          sempre a publicada nesta página, com a data de atualização indicada no
          topo. Recomendamos a consulta periódica.
        </p>
      ),
    },
  ];

  return (
    <div
      style={{ backgroundColor: palette.bg, color: palette.ink }}
      className="flex min-h-screen flex-col"
    >
      <header
        style={{ borderColor: palette.hairline }}
        className="border-b"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-5 sm:px-8">
          <a
            href={homeHref}
            className="truncate text-sm font-semibold tracking-tight underline-offset-4 hover:underline"
          >
            {company.name}
          </a>
          <a
            href={homeHref}
            style={{ color: palette.accent }}
            className={`${label} underline-offset-4 hover:underline`}
          >
            Voltar ao site
          </a>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-14 sm:px-8 sm:py-20">
          <p style={{ color: palette.accent }} className={label}>
            Documento legal
          </p>
          <h1 className="mt-6 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Política de Privacidade
          </h1>
          <p
            style={{ color: palette.inkMuted }}
            className="mt-5 text-base leading-relaxed"
          >
            Este documento explica como {company.companyName} coleta, usa,
            compartilha e protege dados pessoais no site {host}, em conformidade
            com a Lei nº 13.709/2018 (LGPD).
          </p>
          {updated && (
            <p
              style={{ color: palette.inkSubtle }}
              className="mt-4 text-xs uppercase tracking-[0.2em]"
            >
              Última atualização: {updated}
            </p>
          )}

          <nav
            aria-label="Sumário"
            style={{
              backgroundColor: palette.surface,
              borderColor: palette.hairline,
            }}
            className="mt-12 rounded-xl border p-6"
          >
            <p style={{ color: palette.inkSubtle }} className={label}>
              Sumário
            </p>
            <ol className="mt-5 space-y-2">
              {sections.map((section, index) => (
                <li key={section.id} className="flex gap-3 text-sm">
                  <span
                    style={{ color: palette.inkSubtle }}
                    className="shrink-0 tabular-nums"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <a
                    href={`#${section.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          {sections.map((section, index) => (
            <section
              key={section.id}
              id={section.id}
              className="scroll-mt-24 pt-14 sm:pt-16"
            >
              <p style={{ color: palette.accent }} className={label}>
                {String(index + 1).padStart(2, '0')}
              </p>
              <h2 className="mt-4 text-xl font-semibold tracking-tight sm:text-2xl">
                {section.title}
              </h2>
              <div style={{ color: palette.inkMuted }} className="mt-5">
                {section.body}
              </div>
            </section>
          ))}
        </div>
      </main>

      <footer
        style={{ borderColor: palette.hairline, color: palette.inkSubtle }}
        className="border-t"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs sm:px-8">
          <span>
            © {new Date().getFullYear()} {company.companyName}
          </span>
          <span className="tabular-nums">CNPJ {cnpj}</span>
        </div>
      </footer>
    </div>
  );
}
