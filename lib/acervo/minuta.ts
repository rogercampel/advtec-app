/**
 * Minuta a partir do acervo — spec 0005.E1 (#33).
 *
 * Pedido → busca no acervo do escritório → texto que segue a estrutura e a
 * linguagem das peças dele. O que o código garante, e não o modelo:
 *
 *   - sem trecho no acervo, não há minuta e o modelo nem é chamado (critério 3):
 *     dizer que não há base é a resposta certa, não uma peça bem escrita e vazia;
 *   - todo bloco aponta os trechos em que se apoia (documento e página), ou sai
 *     marcado como texto novo (critério 2). Fonte que o modelo inventou não vale:
 *     o bloco vira texto novo;
 *   - citação de julgado que não está nos trechos lidos não sai, em forma
 *     nenhuma (critério 4): a frase é retirada e o lugar fica marcado
 *     (`retiraCitacoesExternas`, a mesma trava da pesquisa de tese);
 *   - a minuta declara que é rascunho (critério 7), e termina com o que faltou.
 *
 * O acervo é o da organização de quem pede: a busca recorta por `organizationId`
 * (critério 9), e o modelo só vê os trechos que ela devolveu.
 */
import { z } from "zod";

import { buscaPorProblema, type Buscador } from "./busca-por-problema";
import { jsonDoModelo, motivoDaFalha, type ChamadaDoModelo } from "./leitura-por-modelo";
import type { TrechoDaPeca } from "./busca-por-problema";
import { citacoesDe, retiraCitacoesExternas } from "./trava-da-tese";

export const AVISO_DA_MINUTA =
  "RASCUNHO escrito a partir do acervo do escritório. A revisão é do advogado: nada aqui foi protocolado, assinado ou enviado, e o texto marcado como novo não tem apoio em peça do escritório.";
export const SEM_BASE = "Não há base no acervo do escritório para esta peça. Nenhuma minuta foi escrita.";
export const MARCA_DA_CITACAO_RETIRADA = "[A COMPLETAR: citação retirada — o julgado não está no acervo do escritório]";

/** Mais trechos que a pesquisa (8): a minuta precisa de estrutura, não só do argumento. */
export const TRECHOS_DA_MINUTA = 12;

export type FonteDaMinuta = { id: string; citacao: string; processo: string | null };
export type BlocoDaMinuta = {
  texto: string;
  /** Ids das fontes (`T1`…) em que o bloco se apoia; vazio = texto novo. */
  fontes: string[];
  novo: boolean;
};
export type RemovidasDaMinuta = { fonte_inexistente: number; citacao_externa: number; bloco_vazio: number };

export type Minuta =
  | {
      situacao: "minuta";
      aviso: typeof AVISO_DA_MINUTA;
      blocos: BlocoDaMinuta[];
      faltou: string[];
      fontes: FonteDaMinuta[];
      removidas: RemovidasDaMinuta;
    }
  | { situacao: "sem_base"; mensagem: typeof SEM_BASE; faltou: string[] }
  | { situacao: "falha"; codigo: string; motivo?: string };

export const SISTEMA_DA_MINUTA = `Você redige a MINUTA de uma peça jurídica para um advogado brasileiro, usando SÓ os trechos do acervo do escritório que vêm no pedido, numerados T1, T2…

Regras:
- Siga a estrutura e a linguagem desses trechos: é o jeito de escrever deste escritório.
- Divida a minuta em blocos (um parágrafo ou um título de seção cada).
- Em "fontes", liste os trechos em que o bloco se apoia. Bloco escrito sem apoio em trecho leva "fontes": [].
- Não cite julgado, súmula, acórdão ou número de processo que não esteja escrito num trecho. Não invente fato, nome, data ou valor do caso.
- Onde a peça precisaria de algo que os trechos não têm (fato do cliente, prova, jurisprudência), escreva no texto [A COMPLETAR: o que falta] e ponha o item em "faltou".
- Se os trechos não servem para a peça pedida, responda {"blocos": [], "faltou": ["por que não servem"]}.

Responda só JSON, sem comentário: {"blocos": [{"texto": "...", "fontes": ["T1"]}], "faltou": ["..."]}`;

const respostaDoModelo = z.object({
  blocos: z.array(z.object({ texto: z.string(), fontes: z.array(z.string()) })),
  faltou: z.array(z.string()),
});

export function pedidoDaMinuta(pedido: string, trechos: TrechoDaPeca[]): string {
  const acervo = trechos.map((t, i) => `[T${i + 1}] ${t.citacao}\n${t.texto}`).join("\n\n");
  return `PEÇA PEDIDA: ${pedido.trim()}\n\nTRECHOS DO ACERVO DO ESCRITÓRIO:\n\n${acervo}`;
}

export async function escreveMinuta(args: {
  buscar: Buscador;
  organizationId: string;
  fontesDoAcervo: string[];
  pedido: string;
  chamar: ChamadaDoModelo;
}): Promise<Minuta> {
  const busca = await buscaPorProblema(args.buscar, {
    organizationId: args.organizationId,
    fontesDoAcervo: args.fontesDoAcervo,
    problema: args.pedido,
    trechos: TRECHOS_DA_MINUTA,
  });
  if (busca.situacao === "falha") return { situacao: "falha", codigo: busca.codigo };
  if (busca.situacao === "nada_no_acervo") return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };

  const trechos = busca.trechos;
  let texto: string;
  try {
    ({ texto } = await args.chamar({ system: SISTEMA_DA_MINUTA, user: pedidoDaMinuta(args.pedido, trechos) }));
  } catch (e) {
    return { situacao: "falha", codigo: "modelo", motivo: motivoDaFalha(e) };
  }
  const lido = respostaDoModelo.safeParse(jsonDoModelo(texto));
  if (!lido.success) return { situacao: "falha", codigo: "formato" };

  const fontes: FonteDaMinuta[] = trechos.map((t, i) => ({ id: `T${i + 1}`, citacao: t.citacao, processo: t.processo }));
  const ids = new Set(fontes.map((f) => f.id));
  const textosDoAcervo = trechos.map((t) => t.texto);
  const removidas: RemovidasDaMinuta = { fonte_inexistente: 0, citacao_externa: 0, bloco_vazio: 0 };
  // A lista do que faltou também passa pela trava: medido com o Luna em 21/10/2026, a
  // citação inventada que sai do bloco volta aqui ("o conteúdo do REsp 1.999.999/SP…").
  const faltou: string[] = [];
  for (const f of lido.data.faltou) {
    const item = f.trim();
    if (item === "") continue;
    const { retiradas } = retiraCitacoesExternas(item, textosDoAcervo);
    if (retiradas.length === 0) faltou.push(item);
    else removidas.citacao_externa += retiradas.length;
  }

  const blocos: BlocoDaMinuta[] = [];
  for (const b of lido.data.blocos) {
    const validas = [...new Set(b.fontes)].filter((f) => ids.has(f));
    removidas.fonte_inexistente += new Set(b.fontes).size - validas.length;

    const { texto: limpo, retiradas } = retiraCitacoesExternas(b.texto.trim(), textosDoAcervo);
    let final = limpo;
    if (retiradas.length > 0) {
      removidas.citacao_externa += retiradas.length;
      final = [limpo, MARCA_DA_CITACAO_RETIRADA].filter(Boolean).join(" ");
      faltou.push(`Bloco ${blocos.length + 1}: jurisprudência que o acervo do escritório não tem.`);
    }
    if (final === "") {
      removidas.bloco_vazio += 1;
      continue;
    }
    blocos.push({ texto: final, fontes: validas, novo: validas.length === 0 });
  }

  if (blocos.length === 0) return { situacao: "sem_base", mensagem: SEM_BASE, faltou };
  return { situacao: "minuta", aviso: AVISO_DA_MINUTA, blocos, faltou, fontes, removidas };
}

/** Toda citação de julgado que aparece na minuta — para o teste de varredura (critério 4). */
export function citacoesNaMinuta(m: Minuta): string[] {
  return m.situacao === "minuta" ? m.blocos.flatMap((b) => citacoesDe(b.texto)) : [];
}
