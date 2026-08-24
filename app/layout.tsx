import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { SmoothScroll } from '@/components/smooth-scroll';
import './globals.css';

const DESCRIPTION =
  'Informe o CNPJ e receba site institucional, subdomínio e a meta tag do Facebook já injetada — pronto para a verificação de domínio no Meta Business Manager.';

export const metadata: Metadata = {
  title: 'Million Verify - Verificador de Business Managers',
  description: DESCRIPTION,
  keywords: ['BM', 'Meta', 'verificador', 'negócios'],
  // A logo aparece quando o link é compartilhado no WhatsApp, LinkedIn e afins.
  openGraph: {
    title: 'Million Verify',
    description: DESCRIPTION,
    type: 'website',
    locale: 'pt_BR',
    images: [{ url: '/logo.png', width: 1024, height: 1024, alt: 'Million Verify' }],
  },
  twitter: {
    card: 'summary',
    title: 'Million Verify',
    description: DESCRIPTION,
    images: ['/logo.png'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <SmoothScroll />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
