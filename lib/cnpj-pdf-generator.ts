/**
 * Gerador do Cartão CNPJ (Comprovante de Inscrição e de Situação Cadastral).
 *
 * Gera o PDF localmente usando pdf-lib, replicando EXATAMENTE as coordenadas,
 * fontes e espaçamentos do documento oficial da Receita Federal.
 *
 * Coordenadas e fontes extraídas do PDF original via pymupdf (get_drawings,
 * get_text('dict'), get_fonts) — página A4 595.92 x 841.92 pts.
 *
 * Layout do original:
 *  - Caixa externa: (48.75, 48.75)-(531.0, 563.25), linha 0.75pt
 *  - Brasão: (58.5, 67.5)-(103.5, 112.5) — 45x45 pts
 *  - Grid interno: x 56.25 a 523.5
 *  - Fonte: Liberation Sans (rótulos 6pt, valores 8pt bold, comprovante 10pt bold)
 */

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Color, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import path from 'node:path';
import fs from 'node:fs';

export interface CnpjCartaoData {
    cnpj: string;
    companyName: string;
    tradeName?: string;
    legalNature?: string;
    openingDate?: string;
    situation?: string;
    situationDate?: string;
    situationReason?: string;
    cnaeCode?: string;
    cnaeDescription?: string;
    secondaryCnaes?: string[];
    address?: {
        street?: string;
        number?: string;
        complement?: string;
        neighborhood?: string;
        city?: string;
        state?: string;
        zipCode?: string;
    };
    phone?: string;
    email?: string;
    capital?: string;
    porte?: string;
    isMatrix?: boolean;
}

/* ── Página A4 ── */
const PAGE_WIDTH = 595.92;
const PAGE_HEIGHT = 841.92;

/* ── Caixa externa ── */
const OUTER_X0 = 48.75;
const OUTER_X1 = 531.0;
const OUTER_Y0 = 48.75; // topo (pdf-lib y cresce para cima; usamos y "de cima")
const OUTER_Y1 = 563.25; // base

/* ── Fontes (original: Liberation Sans — mapeamos para Helvetica que é métrica idêntica) ── */
const F_TITULO1 = 13.5;   // REPÚBLICA FEDERATIVA DO BRASIL (bold)
const F_TITULO2 = 12.0;   // CADASTRO NACIONAL DA PESSOA JURÍDICA (bold)
const F_COMPROV = 10.0;   // COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO CADASTRAL (bold)
const F_LABEL = 6.0;      // rótulos de campo
const F_VALUE = 8.0;      // valores de campo (bold)
const F_NOTE = 7.5;       // nota (*) itálico + asterisco
const F_FOOTER = 9.75;    // Aprovado... / Emitido... / Página

/* ── Y de referência (convertendo top-down → pdf-lib bottom-up) ──
 * pdf-lib drawText y = baseline. No original, os blocos são medidos em top-down.
 * Para cada texto sabemos yMin (topo) e usamos yPdf = PAGE_HEIGHT - yTopo + offset.
 *
 * Offsets calculados: baseline ≈ yMin + (0.72 * tamanho_da_fonte) para sans-serif.
 */

/**
 * Converte yMin (topo da linha de texto, medido top-down no PDF) para a
 * baseline do pdf-lib.
 *
 * No PDF original (fontes Liberation Sans), a caixa da fonte (descent..ascent)
 * cobre de yMin até yMax. Para Liberation Sans: ascent ≈ 0.828 * size,
 * descent ≈ -0.212 * size, logo baseline fica em yMin + ascent ≈ yMin + 0.83*size.
 *
 * Porém o pdftotext yMin mede a caixa de tinta (inclusive descenders) levemente
 * abaixo da baseline... Na prática, para Liberation Sans o baseline medido via
 * pymupdf (line spacing) fica ~0.83*size abaixo do yMin top-down.
 */
/**
 * Converte yMin top-down (topo da caixa da linha) para baseline do pdf-lib.
 * Medição real do original: valor 8pt com bbox yMin=141.26 tem origin y=148.5
 * (top-down), ou seja baseline fica em yMin + 7.24 ≈ 0.905*size.
 * Para rótulo 6pt: baseline ≈ yMin + 5.4 (0.9*size). Usamos 0.905 em ambos.
 */
function yBaseline(yMinTopDown: number, fontSize: number): number {
    return PAGE_HEIGHT - yMinTopDown - fontSize * 0.905;
}

/** Desenha um retângulo (borda de célula) com 0.75pt como o original. */
function drawRect(
    page: PDFPage,
    x0: number,
    y0Bottom: number,
    x1: number,
    y1Top: number,
    color: Color,
) {
    page.drawRectangle({
        x: x0,
        y: y0Bottom,
        width: x1 - x0,
        height: y1Top - y0Bottom,
        borderWidth: 0.75,
        borderColor: color,
        color: undefined,
    });
}

/** Desenha linha horizontal. */
function drawHLine(page: PDFPage, y: number, x0: number, x1: number, color: Color, thickness = 0.75) {
    page.drawLine({
        start: { x: x0, y },
        end: { x: x1, y },
        thickness,
        color,
    });
}

/** Desenha linha vertical. */
function drawVLine(page: PDFPage, x: number, y0: number, y1: number, color: Color, thickness = 0.75) {
    page.drawLine({
        start: { x, y: y0 },
        end: { x, y: y1 },
        thickness,
        color,
    });
}

export async function generateCnpjCartao(data: CnpjCartaoData): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();

    // Liberation Sans: mesma fonte do PDF oficial da Receita Federal
    let fontBold: PDFFont;
    let font: PDFFont;
    let fontItalic: PDFFont;
    try {
        const libDir = path.dirname(new URL(import.meta.url).pathname);
        fontBold = await pdfDoc.embedFont(fs.readFileSync(path.join(libDir, 'LiberationSans-Bold.ttf')));
        font = await pdfDoc.embedFont(fs.readFileSync(path.join(libDir, 'LiberationSans.ttf')));
        fontItalic = await pdfDoc.embedFont(fs.readFileSync(path.join(libDir, 'LiberationSans-Italic.ttf')));
    } catch {
        // Fallback para Helvetica (ambiente sem as TTFs)
        fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        fontItalic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
    }

    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    const BLACK = rgb(0, 0, 0);

    // ══════════════════════════════════════════════════════════════════
    // CÁLCULO ANTECIPADO DO OFFSET DA CÉLULA DE CNAES SECUNDÁRIOS
    //
    // Quando há muitas atividades, a célula estica para baixo (cnaeOffset > 0)
    // e todas as células seguintes + bordas + rodapé se deslocam.
    // O cálculo acontece aqui pois precisa de fontBold (buildLines/wrapText),
    // mas é usado pelo grid e pelas posições de texto mais abaixo.
    // ══════════════════════════════════════════════════════════════════
    const TX_PRE = 60.14; // x de início dos textos
    const maxWpre = 523.5 - TX_PRE;
    const startVyPre = 271.76;

    function buildLinesPre(size: number): string[][] {
        const all: string[][] = [];
        if (!data.secondaryCnaes || data.secondaryCnaes.length === 0) return all;
        for (const cnae of data.secondaryCnaes) {
            const formatted = formatCnaeValue(cnae);
            const mainText = formatted.endsWith('(Dispensada *)')
                ? formatted
                : `${formatted} (Dispensada *)`;
            if (fontBold.widthOfTextAtSize(mainText, size) <= maxWpre) {
                all.push([mainText]);
            } else {
                const lines = wrapText(fontBold, mainText, size, maxWpre);
                all.push(lines);
            }
        }
        return all;
    }

    const SIZES_PRE: [number, number][] = [
        [8, 9.0], [7, 8.0], [6.5, 7.4], [6, 6.8], [5.5, 6.4], [5, 6.0],
        [4.5, 5.6], [4, 5.2],
    ];
    const MAX_EXTEND_PRE = 160;
    let chosenSizePre = 8;
    let chosenGapPre = 9.0;
    let cnaeOffset = 0;

    for (const [s, g] of SIZES_PRE) {
        const lines = buildLinesPre(s);
        const count = lines.reduce((acc, l) => acc + l.length, 0);
        if (count === 0) break;
        const needed = (count - 1) * g + 1.117 * s; // altura total do texto
        const space = 303.0 - startVyPre; // 31.24 — altura original da célula
        const extend = Math.max(0, Math.ceil((needed - space + 2) / 4.5) * 4.5);
        if (extend <= MAX_EXTEND_PRE) {
            chosenSizePre = s;
            chosenGapPre = g;
            cnaeOffset = extend;
            break;
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // BRASÃO (posição exata do original: x 58.5..103.5, y topo 67.5..112.5)
    // ══════════════════════════════════════════════════════════════════
    let brasaoImage: PDFImage | null = null;
    try {
        // Import.meta.url funciona no Next.js bundler (lib dir). Fallback para cwd.
        let brasaoPath = '';
        try {
            const libDir = path.dirname(new URL(import.meta.url).pathname);
            brasaoPath = path.join(libDir, 'brasao.png');
        } catch {
            brasaoPath = path.join(process.cwd(), 'lib', 'brasao.png');
        }
        if (!fs.existsSync(brasaoPath)) {
            brasaoPath = path.join(process.cwd(), 'lib', 'brasao.png');
        }
        if (fs.existsSync(brasaoPath)) {
            const brasaoBytes = fs.readFileSync(brasaoPath);
            brasaoImage = await pdfDoc.embedPng(brasaoBytes);
        }
    } catch {
        // Sem brasão — documento ainda funcional
    }

    if (brasaoImage) {
        // Original: rect(58.5, 67.5, 103.5, 112.5) em top-down → pdf-lib:
        // Fundo branco atrás do brasão (garante que não haja fundo escuro):
        page.drawRectangle({
            x: 58.5,
            y: PAGE_HEIGHT - 112.5,
            width: 45,
            height: 45,
            color: rgb(1, 1, 1),
        });
        page.drawImage(brasaoImage, {
            x: 58.5,
            y: PAGE_HEIGHT - 112.5,
            width: 45,
            height: 45,
        });
    }

    // ══════════════════════════════════════════════════════════════════
    // TÍTULOS CENTRALIZADOS
    // Original: REPÚBLICA yMin=64.28 (13.5pt bold) · CADASTRO yMin=100.89 (12pt bold)
    // ══════════════════════════════════════════════════════════════════
    const titleText = 'REPÚBLICA FEDERATIVA DO BRASIL';
    const subtitleText = 'CADASTRO NACIONAL DA PESSOA JURÍDICA';
    page.drawText(titleText, {
        x: (PAGE_WIDTH - fontBold.widthOfTextAtSize(titleText, F_TITULO1)) / 2,
        y: yBaseline(64.28, F_TITULO1),
        size: F_TITULO1,
        font: fontBold,
        color: BLACK,
    });
    page.drawText(subtitleText, {
        x: (PAGE_WIDTH - fontBold.widthOfTextAtSize(subtitleText, F_TITULO2)) / 2,
        y: yBaseline(100.89, F_TITULO2),
        size: F_TITULO2,
        font: fontBold,
        color: BLACK,
    });

    // ══════════════════════════════════════════════════════════════════
    // GRID — coordenadas exatas do original (top-down), convertidas abaixo
    // ══════════════════════════════════════════════════════════════════
    //
    // cnaeOffset será calculado mais adiante; aplicamos o deslocamento às
    // linhas de grid que ficam abaixo da célula de CNAEs secundários (y >= 312).
    function applyCnaeOffset(yTopDown: number): number {
        // Quando a célula de CNAEs secundários estica, a borda inferior dela
        // (y=302.62) e todas as linhas abaixo (y >= 302.0) descem com o offset.
        return yTopDown >= 302.0 ? yTopDown + cnaeOffset : yTopDown;
    }

    // Linhas horizontais (y top-down) e seus trechos x:
    const H = [
        { y: 133.12, segs: [[56.25, 168.75], [168.75, 411.75], [411.75, 523.5]] },
        { y: 162.38, segs: [[56.25, 168.75], [168.75, 411.75], [411.75, 523.5]] },
        { y: 172.12, segs: [[56.25, 523.5]] },
        { y: 193.12, segs: [[56.25, 523.5]] },
        { y: 202.88, segs: [[56.25, 467.25], [477.0, 523.5]] },
        { y: 223.88, segs: [[56.25, 467.25], [477.0, 523.5]] },
        { y: 233.62, segs: [[56.25, 523.5]] },
        { y: 253.88, segs: [[56.25, 523.5]] },
        { y: 263.62, segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(302.62), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(312.38), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(332.62), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(342.38), segs: [[56.25, 290.25], [299.25, 345.75], [355.5, 523.5]] },
        { y: applyCnaeOffset(363.38), segs: [[56.25, 290.25], [299.25, 345.75], [355.5, 523.5]] },
        { y: applyCnaeOffset(373.12), segs: [[56.25, 141.0], [150.0, 290.25], [299.25, 477.0], [486.0, 523.5]] },
        { y: applyCnaeOffset(394.12), segs: [[56.25, 141.0], [150.0, 290.25], [299.25, 477.0], [486.0, 523.5]] },
        { y: applyCnaeOffset(403.88), segs: [[56.25, 290.25], [299.25, 523.5]] },
        { y: applyCnaeOffset(428.62), segs: [[56.25, 290.25], [299.25, 523.5]] },
        { y: applyCnaeOffset(438.38), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(459.38), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(469.12), segs: [[56.25, 388.5], [399.0, 523.5]] },
        { y: applyCnaeOffset(490.12), segs: [[56.25, 388.5], [399.0, 523.5]] },
        { y: applyCnaeOffset(499.88), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(524.62), segs: [[56.25, 523.5]] },
        { y: applyCnaeOffset(534.38), segs: [[56.25, 388.5], [399.0, 523.5]] },
        { y: applyCnaeOffset(555.38), segs: [[56.25, 388.5], [399.0, 523.5]] },
    ];
    for (const line of H) {
        for (const [x0, x1] of line.segs) {
            drawHLine(page, PAGE_HEIGHT - line.y, x0, x1, BLACK);
        }
    }

    // Linhas verticais (x top-down, y de topo a base)
    const V = [
        { x: 56.62, segs: [[132.75, 162.75], [171.75, 193.5], [202.5, 224.25], [233.25, 254.25], [263.25, 303.0 + cnaeOffset], [312.0, 333.0], [342.0, 363.75], [372.75, 394.5], [403.5, 429.0], [438.0, 459.75], [468.75, 490.5], [499.5, 525.0], [534.0, 555.75]] },
        { x: 140.62, segs: [[372.75, 394.5]] },
        { x: 149.62, segs: [[372.75, 394.5]] },
        { x: 168.38, segs: [[132.75, 162.75]] },
        { x: 289.88, segs: [[342.0, 363.75], [372.75, 394.5], [403.5, 429.0]] },
        { x: 298.88, segs: [[342.0, 363.75], [372.75, 394.5], [403.5, 429.0]] },
        { x: 345.38, segs: [[342.0, 363.75]] },
        { x: 355.12, segs: [[342.0, 363.75]] },
        { x: 388.12, segs: [[468.75, 490.5], [534.0, 555.75]] },
        { x: 398.62, segs: [[468.75, 490.5], [534.0, 555.75]] },
        { x: 411.38, segs: [[132.75, 162.75]] },
        { x: 466.88, segs: [[202.5, 224.25]] },
        { x: 476.62, segs: [[202.5, 224.25], [372.75, 394.5]] },
        { x: 485.62, segs: [[372.75, 394.5]] },
        { x: 523.12, segs: [[132.75, 162.75], [171.75, 193.5], [202.5, 224.25], [233.25, 254.25], [263.25, 303.0 + cnaeOffset], [312.0, 333.0], [342.0, 363.75], [372.75, 394.5], [403.5, 429.0], [438.0, 459.75], [468.75, 490.5], [499.5, 525.0], [534.0, 555.75]] },
    ];
    // Grid V deslocado pelo cnaeOffset: todo segmento cujo topo está abaixo
    // da célula de CNAEs secundários (y0 >= 302) desce junto com ela.
    for (const line of V) {
        for (const [y0, y1] of line.segs) {
            // Desloca junto com a célula esticada de CNAEs secundários
            const d = y0 >= 302.0 ? cnaeOffset : 0;
            drawVLine(page, line.x, PAGE_HEIGHT - (y1 + d), PAGE_HEIGHT - (y0 + d), BLACK);
        }
    }

    // ══════════════════════════════════════════════════════════════════
    // CONTEÚDO DOS CAMPOS — posições top-down exatas do original
    // Margem interna dos textos: x=60.14 (≈3.9 da borda 56.25)
    // Rótulos: yMin do topo da célula + 0.9
    // ══════════════════════════════════════════════════════════════════
    const TX = 60.14; // x de início dos textos

    function label(yMinTop: number, text: string) {
        page.drawText(text, { x: TX, y: yBaseline(yMinTop, F_LABEL), size: F_LABEL, font: fontBold, color: BLACK });
    }

    function value(yMinTop: number, text: string) {
        page.drawText(text, { x: TX, y: yBaseline(yMinTop, F_VALUE), size: F_VALUE, font: fontBold, color: BLACK });
    }

    function valueAt(yMinTop: number, x: number, text: string) {
        page.drawText(text, { x, y: yBaseline(yMinTop, F_VALUE), size: F_VALUE, font: fontBold, color: BLACK });
    }

    function labelAt(yMinTop: number, x: number, text: string) {
        page.drawText(text, { x, y: yBaseline(yMinTop, F_LABEL), size: F_LABEL, font: fontBold, color: BLACK });
    }

    // ── 1ª linha: NÚMERO DE INSCRIÇÃO | COMPROVANTE | DATA DE ABERTURA ──
    // Rótulos yMin=134.07
    label(134.07, 'NÚMERO DE INSCRIÇÃO');
    // COMPROVANTE — 2 linhas, centralizado na coluna 168.75..411.75, yMin=134.95 e 146.20, 10pt bold
    const colMid0 = 168.75;
    const colMid1 = 411.75;
    const comp1 = 'COMPROVANTE DE INSCRIÇÃO E DE SITUAÇÃO';
    const comp2 = 'CADASTRAL';
    page.drawText(comp1, {
        x: colMid0 + (colMid1 - colMid0 - fontBold.widthOfTextAtSize(comp1, F_COMPROV)) / 2,
        y: yBaseline(134.95, F_COMPROV),
        size: F_COMPROV,
        font: fontBold,
        color: BLACK,
    });
    page.drawText(comp2, {
        x: colMid0 + (colMid1 - colMid0 - fontBold.widthOfTextAtSize(comp2, F_COMPROV)) / 2,
        y: yBaseline(146.20, F_COMPROV),
        size: F_COMPROV,
        font: fontBold,
        color: BLACK,
    });
    labelAt(134.07, 414.94, 'DATA DE ABERTURA');

    // Valores yMin=141.26
    value(141.26, formatCnpjString(data.cnpj));
    if (data.openingDate) {
        valueAt(141.26, 414.94, formatDateBr(data.openingDate));
    }
    // MATRIZ yMin=150.26
    page.drawText(data.isMatrix !== false ? 'MATRIZ' : 'FILIAL', {
        x: TX, y: yBaseline(150.26, 8), size: 8, font: fontBold, color: BLACK,
    });

    // ── NOME EMPRESARIAL (célula 171.75..193.5) ──
    label(173.07, 'NOME EMPRESARIAL');
    value(180.26, data.companyName.toUpperCase());

    // ── TÍTULO DO ESTABELECIMENTO + PORTE (célula 202.5..224.25) ──
    label(203.82, 'TÍTULO DO ESTABELECIMENTO (NOME DE FANTASIA)');
    labelAt(203.82, 480.29, 'PORTE');
    const tradeName = (data.tradeName || data.companyName).toUpperCase();
    value(211.01, tradeName);
    if (data.porte) {
        valueAt(211.01, 480.29, formatPorte(data.porte));
    }

    // ── CNAE PRINCIPAL (célula 233.25..254.25) ──
    label(234.57, 'CÓDIGO E DESCRIÇÃO DA ATIVIDADE ECONÔMICA PRINCIPAL');
    const cnaeValue = (() => {
        const code = formatCnaeCode(data.cnaeCode);
        // Sufixo oficial "(Dispensada *)" — tolerância se já vier no registro
        const desc = data.cnaeDescription
            ? data.cnaeDescription.endsWith('(Dispensada *)')
                ? data.cnaeDescription
                : `${data.cnaeDescription} (Dispensada *)`
            : '';

        // Junta só o que existe: com um dos dois ausente, "código - descrição"
        // deixaria um traço solto na célula.
        return [code, desc].filter(Boolean).join(' - ');
    })();
    if (cnaeValue) value(241.76, cnaeValue);

    // ── CNAES SECUNDÁRIOS (célula 263.25..303.0) ──
    label(264.57, 'CÓDIGO E DESCRIÇÃO DAS ATIVIDADES ECONÔMICAS SECUNDÁRIAS');

    // ══════════════════════════════════════════════════════════════════
    // LAYOUT DINÂMICO DA CÉLULA DE CNAES SECUNDÁRIOS
    //
    // Em vez de encolher a fonte, ESTENDEMOS a célula para caber todas as
    // linhas em fonte legível de 8pt (padrão do documento). O offset extra
    // empurra todas as células seguintes + a caixa externa + o rodapé para
    // baixo, mantendo a integridade visual do documento.
    // ══════════════════════════════════════════════════════════════════
    const maxW = 523.5 - TX;
    const startVy = 271.76;

    // Monta todas as linhas completas (com wrap) para um tamanho de fonte
    function buildLines(size: number): string[][] {
        const all: string[][] = [];
        if (!data.secondaryCnaes || data.secondaryCnaes.length === 0) return all;
        for (const cnae of data.secondaryCnaes) {
            const formatted = formatCnaeValue(cnae);
            const mainText = formatted.endsWith('(Dispensada *)')
                ? formatted
                : `${formatted} (Dispensada *)`;
            if (fontBold.widthOfTextAtSize(mainText, size) <= maxW) {
                all.push([mainText]);
            } else {
                // quebra do texto em linhas que cabem na largura da célula
                const lines = wrapText(fontBold, mainText, size, maxW);
                all.push(lines);
            }
        }
        return all;
    }

    // O cnaeOffset, chosenSize e chosenGap já foram calculados antecipadamente
    // no início desta função (bloco "CÁLCULO ANTECIPADO").
    // Monta as linhas com a fonte/gap escolhidos para desenhar.
    let allLines: string[][] = [];
    if (data.secondaryCnaes && data.secondaryCnaes.length > 0) {
        allLines = buildLines(chosenSizePre);
    }

    // ── CNAES SECUNDÁRIOS: desenha com a fonte/gap escolhidos ──
    if (allLines.length > 0) {
        let vy = startVy;
        for (const lines of allLines) {
            for (const line of lines) {
                page.drawText(line, { x: TX, y: yBaseline(vy, chosenSizePre), size: chosenSizePre, font: fontBold, color: BLACK });
                vy += chosenGapPre;
            }
        }
    }

    // cnaeOffset: deslocamento aplicado às células abaixo dos CNAEs
    // secundários quando a altura da célula é esticada para caber todas as
    // linhas em fonte legível.

    // ── NATUREZA JURÍDICA (célula 312.0..333.0) ──
    label(313.32 + cnaeOffset, 'CÓDIGO E DESCRIÇÃO DA NATUREZA JURÍDICA');
    if (data.legalNature) value(320.51 + cnaeOffset, data.legalNature);

    // ── LOGRADOURO | NÚMERO | COMPLEMENTO (342.0..363.75) ──
    label(343.32 + cnaeOffset, 'LOGRADOURO');
    labelAt(343.32 + cnaeOffset, 302.89, 'NÚMERO');
    labelAt(343.32 + cnaeOffset, 358.9, 'COMPLEMENTO');
    if (data.address) {
        if (data.address.street) value(350.51 + cnaeOffset, data.address.street.toUpperCase());
        if (data.address.number) valueAt(350.51 + cnaeOffset, 302.89, data.address.number);
        // COMPLEMENTO: no documento oficial fica VAZIO quando não há valor —
        // nunca exibir '********' aqui (esse preenchimento só vale para EFR e
        // situação especial, que a Receita realmente usa)
        if (data.address.complement && !/^\*+$/.test(data.address.complement)) {
            valueAt(350.51 + cnaeOffset, 358.9, data.address.complement.toUpperCase());
        }
    }

    // ── CEP | BAIRRO/DISTRITO | MUNICÍPIO | UF (372.75..394.5) ──
    label(374.07 + cnaeOffset, 'CEP');
    labelAt(374.07 + cnaeOffset, 153.49, 'BAIRRO/DISTRITO');
    labelAt(374.07 + cnaeOffset, 302.88, 'MUNICÍPIO');
    labelAt(374.07 + cnaeOffset, 489.62, 'UF');
    if (data.address) {
        if (data.address.zipCode) value(381.26 + cnaeOffset, formatCep(data.address.zipCode));
        if (data.address.neighborhood) valueAt(381.26 + cnaeOffset, 153.49, data.address.neighborhood.toUpperCase());
        if (data.address.city) valueAt(381.26 + cnaeOffset, 302.88, data.address.city.toUpperCase());
        if (data.address.state) valueAt(381.26 + cnaeOffset, 489.62, data.address.state.toUpperCase());
    }

    // ── ENDEREÇO ELETRÔNICO | TELEFONE (403.5..429.0) ──
    label(404.82 + cnaeOffset, 'ENDEREÇO ELETRÔNICO');
    labelAt(404.82 + cnaeOffset, 302.89, 'TELEFONE');
    if (data.email) value(412.01 + cnaeOffset, data.email.toUpperCase());
    if (data.phone) valueAt(412.01 + cnaeOffset, 302.89, formatPhone(data.phone));

    // ── ENTE FEDERATIVO RESPONSÁVEL (EFR) (438.0..459.75) ──
    label(439.32 + cnaeOffset, 'ENTE FEDERATIVO RESPONSÁVEL (EFR)');
    page.drawText('*****', { x: TX, y: yBaseline(446.51 + cnaeOffset, 8), size: 8, font: fontBold, color: BLACK });

    // ── SITUAÇÃO CADASTRAL | DATA DA SITUAÇÃO (468.75..490.5) ──
    label(470.07 + cnaeOffset, 'SITUAÇÃO CADASTRAL');
    labelAt(470.07 + cnaeOffset, 402.48, 'DATA DA SITUAÇÃO CADASTRAL');
    if (data.situation) value(477.26 + cnaeOffset, data.situation.toUpperCase());
    if (data.situationDate) valueAt(477.26 + cnaeOffset, 402.48, formatDateBr(data.situationDate));

    // ── MOTIVO DE SITUAÇÃO CADASTRAL (499.5..525.0) ──
    label(500.82 + cnaeOffset, 'MOTIVO DE SITUAÇÃO CADASTRAL');

    // ── SITUAÇÃO ESPECIAL | DATA DA SITUAÇÃO ESPECIAL (534.0..555.75) ──
    label(535.32 + cnaeOffset, 'SITUAÇÃO ESPECIAL');
    labelAt(535.32 + cnaeOffset, 402.48, 'DATA DA SITUAÇÃO ESPECIAL');
    page.drawText('********', { x: TX, y: yBaseline(542.51 + cnaeOffset, 8), size: 8, font: fontBold, color: BLACK });
    page.drawText('********', { x: 402.48, y: yBaseline(542.51 + cnaeOffset, 8), size: 8, font: fontBold, color: BLACK });

    // ══════════════════════════════════════════════════════════════════
    // CAIXA EXTERNA (desenhada POR ÚLTIMO para ficar por cima das linhas do grid)
    // ══════════════════════════════════════════════════════════════════
    // Caixa externa: estendida para baixo se a célula de CNAEs cresceu
    drawRect(page, OUTER_X0, PAGE_HEIGHT - (OUTER_Y1 + cnaeOffset), OUTER_X1, PAGE_HEIGHT - OUTER_Y0, BLACK);

    // ══════════════════════════════════════════════════════════════════
    // RODAPÉ — fora da caixa, fontes do original (também deslocado pelo
    // cnaeOffset para manter a folga com a caixa externa)
    // ══════════════════════════════════════════════════════════════════
    // (*) 7.5pt bold; nota 7.5pt itálico — na mesma linha (original)
    page.drawText('(*)', { x: 49.5, y: yBaseline(577.46 + cnaeOffset, F_NOTE), size: F_NOTE, font: fontBold, color: BLACK });
    const note1 = 'A dispensa de alvarás e licenças é direito do empreendedor que atende aos requisitos constantes na Resolução CGSIM nº 51, de 11 de';
    const note2 = 'junho de 2019, ou da legislação própria encaminhada ao CGSIM pelos entes federativos, não tendo a Receita Federal qualquer';
    const note3 = 'responsabilidade quanto às atividades dispensadas.';
    page.drawText(note1, { x: 60.28, y: yBaseline(577.46 + cnaeOffset, F_NOTE), size: F_NOTE, font: fontItalic, color: BLACK });
    page.drawText(note2, { x: 49.5, y: yBaseline(585.71 + cnaeOffset, F_NOTE), size: F_NOTE, font: fontItalic, color: BLACK });
    page.drawText(note3, { x: 49.5, y: yBaseline(593.96 + cnaeOffset, F_NOTE), size: F_NOTE, font: fontItalic, color: BLACK });

    // "Aprovado pela Instrução Normativa RFB nº 2.119, de 06 de dezembro de 2022." — 9.75pt normal
    const now = new Date();
    const aprovadoText = 'Aprovado pela Instrução Normativa RFB nº 2.119, de 06 de dezembro de 2022.';
    page.drawText(aprovadoText, {
        x: 48.75, y: yBaseline(628.67 + cnaeOffset, F_FOOTER), size: F_FOOTER, font: font, color: BLACK,
    });

    // "Emitido no dia XX/XX/XXXX às HH:MM:SS (data e hora de Brasília)." — 9.75pt, datas em bold
    const dateStr = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Sao_Paulo' });
    const emitidoText = `Emitido no dia ${dateStr} às ${timeStr} (data e hora de Brasília).`;
    page.drawText(emitidoText, {
        x: 49.5, y: yBaseline(649.67 + cnaeOffset, F_FOOTER), size: F_FOOTER, font: font, color: BLACK,
    });
    // datas em negrito sobrepostas
    const dayW = font.widthOfTextAtSize(`Emitido no dia `, F_FOOTER);
    page.drawText(dateStr, {
        x: 49.5 + dayW,
        y: yBaseline(649.67 + cnaeOffset, F_FOOTER),
        size: F_FOOTER,
        font: fontBold,
        color: BLACK,
    });
    const timeIdx = emitidoText.indexOf(timeStr);
    const timeW = font.widthOfTextAtSize(emitidoText.slice(0, timeIdx), F_FOOTER);
    page.drawText(timeStr, {
        x: 49.5 + timeW,
        y: yBaseline(649.67 + cnaeOffset, F_FOOTER),
        size: F_FOOTER,
        font: fontBold,
        color: BLACK,
    });

    // "Página: 1/1" à direita
    const paginaText = 'Página: 1/1';
    const paginaW = font.widthOfTextAtSize(paginaText.slice(0, 8), F_FOOTER) + fontBold.widthOfTextAtSize(paginaText.slice(8), F_FOOTER);
    page.drawText('Página:', {
        x: PAGE_WIDTH - 49.5 - paginaW, y: yBaseline(649.67 + cnaeOffset, F_FOOTER), size: F_FOOTER, font: font, color: BLACK,
    });
    page.drawText('1/1', {
        x: PAGE_WIDTH - 49.5 - fontBold.widthOfTextAtSize('1/1', F_FOOTER),
        y: yBaseline(649.67 + cnaeOffset, F_FOOTER),
        size: F_FOOTER,
        font: fontBold,
        color: BLACK,
    });

    const bytes = await pdfDoc.save();
    return new Uint8Array(bytes);
}

/**
 * Converte registryData (JSON da BrasilAPI) em CnpjCartaoData.
 * Preserva códigos e descrições separados para o formato oficial.
 */
/**
 * Payload cru da BrasilAPI. Os valores chegam como string, número, objeto ou
 * simplesmente ausentes conforme a empresa — daí `unknown` em vez de `any`:
 * força a leitura a passar pelos conversores abaixo.
 */
type RegistryPayload = Record<string, unknown>;

/** Valor escalar do payload → string; qualquer outra coisa vira ''. */
function txt(value: unknown): string {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return '';
}

/** Campos que a Receita ora manda como texto, ora como { codigo, descricao }. */
function field(value: unknown, key: 'codigo' | 'descricao'): string {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return txt((value as Record<string, unknown>)[key]);
    }
    return key === 'codigo' ? txt(value) : '';
}

export function registryDataToCartao(registryData: RegistryPayload): CnpjCartaoData {
    const natureCode = field(registryData.natureza_juridica, 'codigo');
    const natureDesc = field(registryData.natureza_juridica, 'descricao');
    const legalNature = natureCode && natureDesc ? `${natureCode} - ${natureDesc}` : '';

    const secundarios = Array.isArray(registryData.cnaes_secundarios)
        ? registryData.cnaes_secundarios
        : [];

    const capital = Number(txt(registryData.capital_social));

    return {
        cnpj: txt(registryData.cnpj),
        companyName: txt(registryData.razao_social),
        tradeName: txt(registryData.nome_fantasia),
        legalNature,
        openingDate: txt(registryData.data_inicio_atividade),
        situation: txt(registryData.descricao_situacao_cadastral),
        situationDate: txt(registryData.data_situacao_cadastral),
        situationReason:
            field(registryData.motivo_situacao_cadastral, 'descricao') ||
            txt(registryData.motivo_situacao_cadastral),
        cnaeCode: txt(registryData.cnae_fiscal),
        cnaeDescription: txt(registryData.cnae_fiscal_descricao),
        secondaryCnaes: secundarios.map((item) => {
            const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
            return `${txt(entry.codigo)} - ${txt(entry.descricao)}`;
        }),
        address: {
            street: txt(registryData.logradouro),
            number: txt(registryData.numero),
            complement: txt(registryData.complemento),
            neighborhood: txt(registryData.bairro),
            city: txt(registryData.municipio),
            state: txt(registryData.uf),
            zipCode: txt(registryData.cep),
        },
        phone: txt(registryData.ddd_telefone_1) || txt(registryData.ddd_telefone_2),
        email: txt(registryData.email),
        capital: Number.isFinite(capital) && capital > 0
            ? `R$ ${capital.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
            : '',
        porte: txt(registryData.porte),
        isMatrix: registryData.identificador_matriz_filial === 1,
    };
}

/** Formata CNPJ xx.xxx.xxx/xxxx-xx */
function formatCnpjString(digits: string): string {
    const d = digits.replace(/\D/g, '');
    if (d.length !== 14) return digits;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

/** Converte AAAA-MM-DD em DD/MM/AAAA */
function formatDateBr(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Formata um item de CNAE completo ("7020400 - Atividades de consultoria...")
 * no formato oficial: "70.20-4-00 - Atividades de consultoria..."
 */
function formatCnaeValue(cnae: string): string {
    if (!cnae) return '';
    const idx = cnae.indexOf(' - ');
    if (idx > 0) {
        return `${formatCnaeCode(cnae.slice(0, idx))} - ${cnae.slice(idx + 3)}`;
    }
    return formatCnaeCode(cnae);
}

/**
 * Formato oficial do CNAE: xx.xx-x-xx
 * Ex: "8211300" → "82.11-3-00" ; "7020400" → "70.20-4-00"
 */
function formatCnaeCode(code: string | undefined): string {
    if (!code) return '';
    const d = String(code).replace(/\D/g, '');
    if (d.length === 7) {
        return `${d.slice(0, 2)}.${d.slice(2, 4)}-${d.slice(4, 5)}-${d.slice(5, 7)}`;
    }
    if (d.length === 5) {
        return `${d.slice(0, 3)}-${d.slice(3, 4)}-${d.slice(4, 5)}`;
    }
    return code;
}

/**
 * Quebra um texto em linhas que cabem dentro da largura máxima (wrap),
 * sempre em fronteiras de palavra.
 */
function wrapText(font: PDFFont, text: string, size: number, maxW: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
        const trial = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) <= maxW) {
            current = trial;
        } else {
            if (current) lines.push(current);
            current = word;
        }
    }
    if (current) lines.push(current);
    return lines.length > 0 ? lines : [''];
}

/** CEP: xx.xxx-xxx */
function formatCep(cep: string): string {
    const d = String(cep).replace(/\D/g, '');
    if (d.length === 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}-${d.slice(5, 8)}`;
    if (d.length === 5) return `${d.slice(0, 2)}-${d.slice(2, 5)}`;
    return cep;
}

/** Telefone: (xx) xxxx-xxxx */
function formatPhone(phone: string): string {
    const d = String(phone).replace(/\D/g, '');
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6, 10)}`;
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`;
    return phone;
}

/** Porte: abrevia para ME / EPP / DEMAIS conforme o documento oficial */
function formatPorte(porte: string): string {
    const upper = (porte || '').toUpperCase();
    if (upper.includes('MICRO EMPRESA') || upper === 'ME' || upper.includes('MICROEMPRESA')) return 'ME';
    if (upper.includes('PEQUENO PORTE') || upper === 'EPP') return 'EPP';
    if (upper.includes('NÃO INFORMADO') || upper.includes('NAO INFORMADO')) return 'NÃO INFORMADO';
    return upper || 'DEMAIS';
}
