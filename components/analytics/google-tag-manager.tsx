import Script from 'next/script';

/**
 * Container do Google Tag Manager da PLATAFORMA.
 *
 * Montado uma vez, no layout do grupo de rotas `app/(platform)`: landing,
 * login, cadastro, painel e admin. Os sites de cliente (app/sites/[subdomain],
 * servidos nos subdomínios) ficam de fora de propósito — rastrear o visitante
 * do cliente com o container da Million Verify seria indevido, e o <head> do
 * tenant pertence a ele (meta tag de verificação, canônico, tema).
 *
 * `afterInteractive` é a estratégia que o próprio pacote oficial do Next para
 * o GTM usa: o script entra assim que a página hidrata, sem atrasar o LCP.
 * Fora de produção não renderiza nada, para o desenvolvimento local não poluir
 * os relatórios.
 */
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || 'GTM-NPSMD295';

export function GoogleTagManager() {
  if (process.env.NODE_ENV !== 'production') return null;

  return (
    <>
      <Script
        id="gtm-loader"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{
          __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`,
        }}
      />
      <noscript>
        <iframe
          src={`https://www.googletagmanager.com/ns.html?id=${GTM_ID}`}
          height="0"
          width="0"
          style={{ display: 'none', visibility: 'hidden' }}
          title="Google Tag Manager"
        />
      </noscript>
    </>
  );
}
