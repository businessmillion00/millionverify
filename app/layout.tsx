import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { SmoothScroll } from '@/components/smooth-scroll';
import './globals.css';

export const metadata: Metadata = {
  title: 'Business Million - Verificador de Business Managers',
  description: 'SaaS Elite para automação de verificação de BMs do Meta',
  keywords: ['BM', 'Meta', 'verificador', 'negócios'],
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
