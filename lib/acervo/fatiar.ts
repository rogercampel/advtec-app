/**
 * Fatiar peça do acervo em pedaços indexáveis, **sem perder a página**.
 *
 * A página não é enfeite: a spec 0002 (critério 4) exige que toda busca devolva
 * documento e página de origem, e a 0005 recusa citação sem origem. Se a página
 * se perder aqui, nenhuma etapa adiante consegue reconstruir — o pedaço vira
 * texto órfão.
 *
 * Fatiar é decisão de recall, não de estética: pedaço grande demais dilui o
 * assunto e a busca por significado erra; pequeno demais corta o argumento no
 * meio e o trecho devolvido não faz sentido para o advogado.
 */

import { createHash } from "node:crypto";

export type Pagina = { numero: number; texto: string };

export type Pedaco = {
  /** ordem dentro do documento — é o `position` de `ai_chunks`. */
  posicao: number;
  texto: string;
  /** sha256 do texto normalizado; é ele que impede reindexar o mesmo conteúdo. */
  hash: string;
  /** de onde veio. Vai em `ai_chunks.metadata`. */
  paginaInicial: number;
  paginaFinal: number;
};

export const ALVO_CARACTERES = 1800;
export const SOBREPOSICAO = 200;

/**
 * Normaliza antes de hashear. Sem isto, o mesmo PDF reprocessado com quebra de
 * linha diferente gera hash diferente, e a deduplicação do critério 2 não vale
 * nada — o arquivo entraria duas vezes com conteúdo idêntico.
 */
export function normaliza(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

export function hashDoTexto(texto: string): string {
  return createHash("sha256").update(normaliza(texto), "utf8").digest("hex");
}

/**
 * Junta as páginas em pedaços de ~`alvo` caracteres, com sobreposição, e registra
 * a faixa de páginas que cada pedaço atravessa.
 *
 * A sobreposição existe porque argumento jurídico cruza a virada de página com
 * frequência. Sem ela, a frase que sustenta a tese fica partida entre dois
 * pedaços e nenhum dos dois recupera bem.
 */
export function fatia(
  paginas: Pagina[],
  opcoes: { alvo?: number; sobreposicao?: number } = {},
): Pedaco[] {
  const alvo = opcoes.alvo ?? ALVO_CARACTERES;
  const sobre = opcoes.sobreposicao ?? SOBREPOSICAO;

  // texto contínuo, guardando em que página cada caractere começou
  let corrido = "";
  const paginaDoIndice: number[] = [];
  for (const p of paginas) {
    const t = normaliza(p.texto);
    if (!t) continue;
    const prefixo = corrido ? " " : "";
    corrido += prefixo + t;
    for (let i = 0; i < prefixo.length + t.length; i++) paginaDoIndice.push(p.numero);
  }
  if (!corrido) return [];

  const pedacos: Pedaco[] = [];
  let inicio = 0;
  let posicao = 0;

  while (inicio < corrido.length) {
    let fim = Math.min(inicio + alvo, corrido.length);

    // não corte no meio de palavra, se houver espaço perto do fim
    if (fim < corrido.length) {
      const espaco = corrido.lastIndexOf(" ", fim);
      if (espaco > inicio + alvo * 0.6) fim = espaco;
    }

    const texto = corrido.slice(inicio, fim).trim();
    if (texto) {
      pedacos.push({
        posicao: posicao++,
        texto,
        hash: hashDoTexto(texto),
        paginaInicial: paginaDoIndice[inicio] ?? paginas[0]?.numero ?? 1,
        paginaFinal: paginaDoIndice[Math.max(inicio, fim - 1)] ?? paginas[paginas.length - 1]?.numero ?? 1,
      });
    }

    if (fim >= corrido.length) break;
    inicio = Math.max(fim - sobre, inicio + 1);
  }

  return pedacos;
}
