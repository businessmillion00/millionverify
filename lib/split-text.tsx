'use client';

/**
 * Substituto livre do SplitText (plugin pago do GSAP Club).
 * Quebra o texto em palavras > caracteres, cada caractere dentro de um
 * `overflow-hidden` para permitir revelação por máscara.
 * A frase inteira fica no aria-label, então o leitor de tela lê normalmente.
 */
export function SplitChars({
  text,
  className,
  charClassName,
  charAttr = 'data-char',
}: {
  text: string;
  className?: string;
  /**
   * Aplicado em CADA caractere, não no conjunto.
   * Necessário para gradiente: `background-clip:text` pinta o fundo do
   * próprio elemento que contém o glifo. Posto no pai, os spans aninhados
   * herdam o `text-fill-color: transparent` sem herdar o fundo — e o texto
   * some. Por caractere, cada glifo carrega o próprio gradiente.
   */
  charClassName?: string;
  charAttr?: string;
}) {
  const words = text.split(' ');

  return (
    <span className={className} aria-label={text}>
      {words.map((word, w) => (
        <span key={w} className="inline-block whitespace-nowrap">
          {word.split('').map((ch, c) => (
            <span key={c} className="inline-block overflow-hidden align-bottom">
              <span
                {...{ [charAttr]: '' }}
                className={`inline-block ${charClassName ?? ''}`}
                aria-hidden
              >
                {ch}
              </span>
            </span>
          ))}
          {w < words.length - 1 && <span className="inline-block">&nbsp;</span>}
        </span>
      ))}
    </span>
  );
}
