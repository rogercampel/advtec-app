/**
 * A minuta como ARQUIVO de texto — spec 0005: "A minuta sai como arquivo, e ele
 * edita onde já edita." É o que o advogado do piloto lê na conferência (0005.E2,
 * #37): cada bloco com a origem (critério 2), o aviso de rascunho no topo
 * (critério 7) e a lista do que faltou no fim (critério 5). Função pura: não
 * grava, não envia, não sai do escritório — quem baixa é o próprio advogado.
 */
import type { Minuta } from "./minuta";

export const SEM_ORIGEM = "TEXTO NOVO — sem apoio em peça do escritório. Confira com atenção.";

export function minutaEmTexto(m: Extract<Minuta, { situacao: "minuta" }>, pedido: string): string {
  const citacaoDe = new Map(m.fontes.map((f) => [f.id, f.citacao]));
  const blocos = m.blocos.map((b) => {
    const origem = b.novo ? SEM_ORIGEM : `Origem: ${b.fontes.map((id) => citacaoDe.get(id) ?? id).join("; ")}`;
    return `${b.texto}\n\n> ${origem}`;
  });
  const faltou = m.faltou.length > 0 ? m.faltou.map((f) => `- ${f}`).join("\n") : "- Nada: todo bloco tem origem no acervo.";
  return [`# MINUTA — RASCUNHO`, `> ${m.aviso}`, `Pedido: ${pedido.trim()}`, `---`, ...blocos, `---`, `## O que faltou`, faltou, ""].join("\n\n");
}
