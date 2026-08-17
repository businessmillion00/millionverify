import { BoldTemplate } from './bold';
import { CorporateTemplate } from './corporate';
import { MinimalTemplate } from './minimal';
import {
  isSiteTemplateKey,
  type SiteTemplateKey,
  type SiteTemplateProps,
} from './types';

/**
 * Registro dos templates institucionais. São todos server components: o
 * crawler do Meta e o cron de verificação leem o HTML entregue pelo servidor,
 * então nada aqui pode depender de JavaScript no cliente.
 *
 * Client components devem importar tipos e constantes de './types'
 * diretamente — este módulo puxa os três templates para o bundle.
 */
export const SITE_TEMPLATES: Record<
  SiteTemplateKey,
  (props: SiteTemplateProps) => JSX.Element
> = {
  minimal: MinimalTemplate,
  corporate: CorporateTemplate,
  bold: BoldTemplate,
};

export const DEFAULT_SITE_TEMPLATE: SiteTemplateKey = 'minimal';

/** Sites criados antes do seletor não têm `template` no theme: caem no padrão. */
export function resolveTemplate(key: string | undefined): SiteTemplateKey {
  return isSiteTemplateKey(key) ? key : DEFAULT_SITE_TEMPLATE;
}

export { BoldTemplate, CorporateTemplate, MinimalTemplate };
export type { SiteTemplateKey, SiteTemplateProps };

/**
 * Superfície reaproveitável pelas páginas satélites do site do tenant (política
 * de privacidade, por exemplo): cabeçalho, rodapé e o modelo de visão que
 * carrega host, razão social e canais já normalizados. Reaproveitar daqui é o
 * que mantém a página legal com a mesma cara do template escolhido.
 */
export {
  SiteFooter,
  SiteNav,
  buildSiteViewModel,
  toneSkin,
  type SiteStyle,
  type SiteTone,
  type SiteViewModel,
  type ToneSkin,
} from './sections';
