import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { SmoothScroll } from '@/components/smooth-scroll';
import './globals.css';

const DESCRIPTION =
  'Informe o CNPJ e receba site institucional, subdomínio e a meta tag do Facebook já injetada — pronto para a verificação de domínio no Meta Business Manager.';

export const metadata: Metadata = {
  title: 'Business Million - Verificador de Business Managers',
  description: DESCRIPTION,
  keywords: ['BM', 'Meta', 'verificador', 'negócios'],
  // A logo aparece quando o link é compartilhado no WhatsApp, LinkedIn e afins.
  openGraph: {
    title: 'Business Million',
    description: DESCRIPTION,
    type: 'website',
    locale: 'pt_BR',
    images: [{ url: '/logo.png', width: 1024, height: 1024, alt: 'Business Million' }],
  },
  twitter: {
    card: 'summary',
    title: 'Business Million',
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
