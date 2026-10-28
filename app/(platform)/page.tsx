import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { ScrollJourney } from '@/components/landing/scroll-journey';
import { Stats } from '@/components/landing/stats';
import { Features } from '@/components/landing/features';
import { TokenSlider } from '@/components/landing/token-slider';
import { Faq } from '@/components/landing/faq';
import { CtaFooter } from '@/components/landing/cta-footer';

export default function HomePage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <section id="percurso">
          <ScrollJourney />
        </section>
        <Stats />
        <section id="recursos">
          <Features />
        </section>
        <section id="precos">
          <TokenSlider />
        </section>
        <section id="duvidas">
          <Faq />
        </section>
        <CtaFooter />
      </main>
    </>
  );
}
