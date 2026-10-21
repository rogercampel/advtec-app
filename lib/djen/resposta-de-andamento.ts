/**
 * Resposta sobre andamento — spec 0010.E3 (AdvTec).
 *
 * "O agente conta o que aconteceu; nunca o que vai acontecer nem o que
 * significa." A frase é montada aqui, a partir do que `consultaDoCaso` devolveu,
 * e não pelo modelo: data, tipo de ato e tribunal, e nada além. Toda linha cita
 * data e tipo de ato (critério 3) — andamento sem data não vira frase.
 *
 * A saída é SUGESTÃO, nunca envio. O modo assistido é o padrão da spec, e a
 * liberação de envio direto ("escolha registrada") ainda não existe — então
 * este módulo não tem caminho de envio. Quem aprova é um usuário do escritório,
 * no fluxo de rascunho da base.
 *
 * Passa para humano, sem frase nenhuma, quando:
 *   - a pessoa não mandou mensagem (critério 6: sem pergunta, sem andamento);
 *   - pede humano, ou faz pergunta de mérito — mesmo com publicação na mão
 *     (critério 4);
 *   - o caso é sigiloso (critério 5, E4);
 *   - o contato não tem caso, ou o caso não tem publicação (critério 1);
 *   - a frase montada não passa nas travas da OAB.
 */
import { decideResposta, pedeHumano, perguntaDeMerito, normalizaParaCasar, type Contexto } from "@/lib/oab/travas";

import type { Andamento, ConsultaDoCaso } from "./consulta-do-caso";

export type MotivoDeHumano =
  | "sem_mensagem"
  | "pediu_humano"
  | "pergunta_de_merito"
  | "sigilo"
  | "sem_caso"
  | "sem_publicacao"
  | "trava_da_oab";

export type DecisaoDeAndamento =
  | { acao: "sugerir"; texto: string; fundamentos: Andamento[] }
  | { acao: "passar_para_humano"; motivo: MotivoDeHumano };

const ARTIGO: Record<string, string> = {
  sentença: "uma sentença",
  acórdão: "um acórdão",
  decisão: "uma decisão",
  despacho: "um despacho",
  citação: "uma citação",
  intimação: "uma intimação",
  edital: "um edital",
  "ata de sessão": "uma ata de sessão",
};

/** `YYYY-MM-DD` → `DD/MM/AAAA`; `null` se a data não tem essa forma. */
function dataBr(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Uma linha por andamento com data e tipo; `null` quando nenhum tem os dois. */
export function montaTexto(andamentos: Andamento[]): string | null {
  const linhas = andamentos.flatMap((a) => {
    const data = dataBr(a.data);
    const ato = a.tipoDeAto ? ARTIGO[a.tipoDeAto] : undefined;
    if (!data || !ato) return [];
    const onde = a.siglaTribunal ? ` no ${a.siglaTribunal}` : "";
    return [`• ${data}: saiu ${ato}${onde} no processo ${a.numeroProcesso}.`];
  });
  if (linhas.length === 0) return null;
  return [
    "Estas são as últimas movimentações publicadas no seu processo:",
    ...linhas,
    "O escritório já acompanha. O que isso significa para o seu caso, quem explica é o advogado responsável.",
  ].join("\n");
}

export function decideAndamento(
  mensagemDoCliente: string,
  consulta: ConsultaDoCaso,
  contexto: Contexto,
): DecisaoDeAndamento {
  if (normalizaParaCasar(mensagemDoCliente) === "") return { acao: "passar_para_humano", motivo: "sem_mensagem" };
  if (pedeHumano(mensagemDoCliente)) return { acao: "passar_para_humano", motivo: "pediu_humano" };
  // Antes de qualquer frase: a resposta abaixo defere ao advogado, e a trava
  // deixaria sair. A spec quer mérito no humano mesmo assim.
  if (perguntaDeMerito(mensagemDoCliente)) return { acao: "passar_para_humano", motivo: "pergunta_de_merito" };
  if (consulta.sigiloso) return { acao: "passar_para_humano", motivo: "sigilo" };
  if (consulta.casos.length === 0) return { acao: "passar_para_humano", motivo: "sem_caso" };

  const fundamentos = consulta.andamentos.filter((a) => dataBr(a.data) && a.tipoDeAto && ARTIGO[a.tipoDeAto]);
  const texto = montaTexto(fundamentos);
  if (!texto) return { acao: "passar_para_humano", motivo: "sem_publicacao" };

  const d = decideResposta(mensagemDoCliente, texto, contexto);
  if (d.acao !== "enviar") return { acao: "passar_para_humano", motivo: "trava_da_oab" };
  return { acao: "sugerir", texto, fundamentos };
}
