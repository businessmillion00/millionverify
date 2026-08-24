/**
 * Conteúdo do tutorial "Como emitir o comprovante do CNPJ".
 *
 * Módulo de dado puro, igual a `tutorial-steps.ts` — de onde vêm os tipos e o
 * motor de substituição. Sem 'use client' e sem JSX: serve tanto o servidor
 * quanto o cliente.
 *
 * LIMITE DE PRODUTO, deliberado e inegociável: este roteiro ENSINA a emitir o
 * documento no site da Receita Federal. Ele não gera, não desenha e não reproduz o
 * Comprovante de Inscrição e de Situação Cadastral — nada de brasão, título oficial,
 * grade de campos da RFB ou rodapé de autenticidade. Imitar documento de órgão
 * público é falsificação, e quem responderia por ela é o cliente, ao entregar o
 * arquivo à Meta. Tudo o que fazemos é encurtar o caminho até a fonte oficial.
 */

import { formatCNPJ } from '@/lib/utils';
import type { TutorialStep, TutorialVars } from '@/components/verification/tutorial-steps';

/**
 * Emissor oficial do comprovante.
 *
 * A rota aceita o CNPJ como último segmento do caminho (14 dígitos, sem máscara) e
 * responde 200 sem redirecionar — conferido contra o serviço real. O desafio de
 * segurança continua sendo resolvido pelo usuário, no site da Receita.
 *
 * FONTE ÚNICA da URL: `cnpj-document-card.tsx` importa daqui.
 */
export const RECEITA_CNPJREVA_URL =
  'https://solucoes.receita.fazenda.gov.br/servicos/cnpjreva';

/** Título do modal — usado também no rótulo acessível do diálogo. */
export const CNPJ_TUTORIAL_TITLE = 'Como emitir o comprovante do CNPJ';

/** Linha de apoio abaixo do título. */
export const CNPJ_TUTORIAL_SUBTITLE =
  'Seis passos até o PDF oficial da Receita Federal — emitido por ela, baixado por você.';

/**
 * Deep link do emissor com o CNPJ já no caminho.
 *
 * Devolve `null` quando o número não tem 14 dígitos: mandar o cliente para uma URL
 * que a Receita rejeita é pior do que não mostrar o botão.
 */
export function receitaCnpjUrl(cnpj: string): string | null {
  const digits = cnpj.replace(/\D/g, '');

  return digits.length === 14 ? `${RECEITA_CNPJREVA_URL}/${digits}` : null;
}

/**
 * Mapa de substituição do tutorial do comprovante.
 *
 * `cnpj` é o que a Receita aceita no campo (só dígitos) e o que entra na URL;
 * `cnpjFormatado` é o que o olho compara na tela. Os dois existem porque os dois
 * usos existem.
 */
export function cnpjTutorialVars(cnpj: string, companyName: string): TutorialVars {
  const digits = cnpj.replace(/\D/g, '');

  return {
    cnpj: digits,
    cnpjFormatado: formatCNPJ(digits),
    empresa: companyName,
  };
}

/**
 * Os seis passos.
 *
 * Cada um descreve UM clique real na tela da Receita. O passo 3 é o único que não
 * podemos encurtar — e o texto diz isso na cara, porque cliente que acha que o
 * captcha é nosso abre chamado achando que o produto está quebrado.
 */
export const CNPJ_TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'abrir-emissor',
    short: 'Abrir a Receita Federal',
    title: 'Abra o emissor da Receita Federal',
    body: [
      'O botão abaixo abre, em uma nova aba, a consulta oficial do CNPJ no site da Receita Federal. O seu número já vai dentro do endereço: a página abre com **{cnpjFormatado}** preenchido, sem você digitar nada.',
      'Deixe esta aba aberta ao lado. Os próximos cinco passos acontecem lá, e no último você volta para cá com o arquivo na mão.',
    ],
    callout: {
      title: 'Quem emite o documento é a Receita Federal',
      body: 'A Million Verify não emite, não reproduz e não assina comprovantes — nós só encurtamos o caminho até o emissor oficial, com o seu CNPJ já preenchido. O PDF sai do site da Receita, com os dados e a autenticação dela. É exatamente esse arquivo que a Meta aceita.',
    },
    external: {
      href: `${RECEITA_CNPJREVA_URL}/{cnpj}`,
      label: 'Abrir o emissor da Receita Federal',
    },
    hint: 'Se a Receita abrir a tela inicial pedindo o número em vez da consulta preenchida, é a sessão dela que expirou: use o CNPJ do próximo passo, que está pronto para copiar, e siga daí.',
  },
  {
    id: 'conferir-cnpj',
    short: 'Conferir o CNPJ',
    title: 'Confira o CNPJ que apareceu na tela',
    body: [
      'Antes de qualquer clique, compare o número que a Receita mostra com o número abaixo. Eles têm que ser idênticos.',
      'É a conferência mais barata do processo: emitir o comprovante do CNPJ errado só se descobre depois, quando a Meta recusa o documento e o prazo da análise já foi embora.',
    ],
    copy: {
      label: 'CNPJ',
      source: 'cnpjFormatado',
      hint: 'Empresa: {empresa}. Se precisar digitar de novo, o campo da Receita aceita só números: {cnpj}.',
    },
    hint: 'O nome que a Receita mostrar é a RAZÃO SOCIAL, que pode ser diferente do nome fantasia da sua empresa. Divergência aí é normal; divergência no número, não.',
  },
  {
    id: 'captcha',
    short: 'Resolver o captcha',
    title: 'Resolva o "Não sou um robô"',
    body: [
      'A Receita exibe um desafio de segurança antes de liberar a consulta. Marque **Não sou um robô** e, se ela pedir, selecione as imagens que ela indicar.',
      'Esse desafio é da Receita Federal, não nosso, e é justamente o que impede que a consulta seja feita por um programa. Por isso nós não podemos resolvê-lo por você nem automatizar esta etapa: qualquer tentativa de contornar o captcha seria burlar um controle de um órgão público.',
    ],
    callout: {
      title: 'É aqui que o processo depende de você',
      body: 'Tudo o que dava para adiantar já foi adiantado: o endereço certo e o CNPJ preenchido. Do captcha em diante são três cliques seus, e é o desenho do serviço da Receita que exige isso — nenhuma plataforma faz diferente.',
    },
    hint: 'Se o desafio não carregar, recarregue a página da Receita. Bloqueador de anúncios e VPN costumam derrubar o captcha.',
  },
  {
    id: 'consultar',
    short: 'Clicar em Consultar',
    title: 'Clique em "Consultar"',
    body: [
      'Com o captcha resolvido, clique em **Consultar**. O Comprovante de Inscrição e de Situação Cadastral abre na tela, com a razão social, o endereço, a atividade principal e a situação cadastral do CNPJ.',
      'Confira a situação: ela precisa estar como **ATIVA**. Se aparecer baixada, suspensa ou inapta, resolva a pendência na Receita antes de mandar o documento para a Meta — comprovante de CNPJ irregular é recusa certa na análise.',
    ],
    hint: 'A sessão da Receita expira rápido. Se a tela voltar para o começo, refaça o captcha e clique em Consultar de novo.',
  },
  {
    id: 'salvar-pdf',
    short: 'Salvar como PDF',
    title: 'Salve a página como PDF',
    body: [
      'Com o comprovante na tela, pressione **Ctrl + P** (no Windows) ou **Cmd + P** (no Mac) para abrir a impressão. No campo de destino, escolha **Salvar como PDF** e confirme.',
      'Guarde o arquivo em um lugar que você ache de novo — a pasta de Downloads serve. É esse PDF, gerado direto da página da Receita, que a Meta aceita.',
    ],
    hint: 'Nada de print de tela nem foto: a Meta recusa imagem. Tem que ser o PDF salvo pela impressão da própria página.',
  },
  {
    id: 'enviar',
    short: 'Enviar o arquivo',
    title: 'Volte aqui e envie o arquivo',
    body: [
      'Feche este tutorial e use o campo **Anexar o PDF que você baixou**, logo abaixo neste card. Escolha o arquivo que você acabou de salvar e clique em **Anexar comprovante**.',
      'O comprovante fica guardado no painel, ligado ao site de {empresa}. Quando a Meta pedir o documento na análise, ele já está aqui, sem precisar refazer o captcha e a consulta de novo.',
    ],
    hint: 'Se a Receita pedir uma emissão nova daqui a alguns meses, é só repetir estes seis passos: o arquivo antigo é substituído pelo mais recente.',
  },
] as const;

/** Quantidade de passos — evita repetir `CNPJ_TUTORIAL_STEPS.length` na apresentação. */
export const CNPJ_TUTORIAL_STEP_COUNT = CNPJ_TUTORIAL_STEPS.length;
