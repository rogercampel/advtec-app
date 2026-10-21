/**
 * O que cada lado alega — ticket 0003.E4 (#35).
 *
 * "Pedido, causa de pedir, defesa, e o que já foi decidido. Em texto de gente."
 * (spec 0003, seção 3) O `texto` é do modelo, em português simples; o que
 * prova é o `trecho`, literal, na `pagina`. As regras da âncora estão em
 * `leitura-por-modelo.ts`; aqui entra uma a mais: DECISÃO só com verbo de
 * decisão no trecho ("defiro", "julgo", "nego provimento"…). Sem isso, qualquer
 * frase do juízo ou da parte vira "o juiz decidiu".
 *
 * Critério 4, a armadilha: o que não está nos autos não aparece. Três estados,
 * e o documento diz qual é cada um:
 *   - `naoConsta`: o modelo não apontou nada daquele tipo;
 *   - `descartados`: apontou, mas nenhum item passou na âncora — "confira";
 *   - `blocosNaoLidos` e `paginasSemTexto`: o que não foi lido, com o motivo.
 */
import { z } from "zod";

import type { Pagina } from "./fatiar";
import {
  autosDoBloco,
  BLOCOS_SIMULTANEOS,
  blocosDePaginas,
  emLotes,
  jsonDoModelo,
  motivoDaFalha,
  motivoParaRecusar,
  paginasParaLeitura,
  type ChamadaDoModelo,
  type MotivoDaRemocao,
} from "./leitura-por-modelo";
import { sombra } from "./metadado";

export const TIPOS_DE_ALEGACAO = ["pedido", "causa_de_pedir", "defesa", "decisao"] as const;
export type TipoDeAlegacao = (typeof TIPOS_DE_ALEGACAO)[number];
export const LADOS = ["autor", "reu", "juizo", "terceiro"] as const;

export type Alegacao = {
  tipo: TipoDeAlegacao;
  lado: (typeof LADOS)[number];
  /** Em texto de gente, do modelo. O documento mostra sempre ao lado do trecho. */
  texto: string;
  pagina: number;
  /** Literal da página: é o que prova. */
  trecho: string;
};

export type LeituraDasAlegacoes = {
  alegacoes: Alegacao[];
  /** O modelo não apontou nada deste tipo: o documento diz "não consta". */
  naoConsta: TipoDeAlegacao[];
  /** Apontou, mas nada passou na âncora: o documento diz "o modelo indicou, sem trecho que prove — confira". */
  descartados: TipoDeAlegacao[];
  removidas: Record<MotivoDaRemocao | "decisao_sem_verbo", number>;
  /** O documento avisa que estas páginas ficaram de fora, e por quê. */
  blocosNaoLidos: Array<{ primeira: number; ultima: number; motivo: string }>;
  /** Folhas sem camada de texto: nada pode dizer que foram lidas. */
  paginasSemTexto: number[];
};

/** Verbos e fórmulas de quem decide. Medido nas respostas reais: decisão de verdade traz um destes. */
const VERBO_DE_DECISAO =
  /\b(defiro|indefiro|deferi|indeferi|julgo|julgou|julgad[oa]s?|condeno|condenou|homologo|homologou|determino|determinou|concedo|concedeu|nego|negou|dou|deu|acolho|acolheu|rejeito|rejeitou|extingo|extinguiu|declaro|declarou|decreto|decretou|desprovimento|provimento|procedente|improcedente|procedentes|improcedentes)\b/;

export const SISTEMA_DA_LEITURA = `Você lê autos de processos judiciais brasileiros para um advogado. Regras inegociáveis:
1. Só afirme o que está escrito no texto. Não deduza, não complete, não corrija, não use conhecimento de fora.
2. Todo item traz "pagina" (o número em "=== PÁGINA N ===") e "trecho": uma cópia LITERAL, caractere por caractere, de 8 a 40 palavras daquela página que sustenta o item.
3. Todo número que aparece no item (valor, data, porcentagem, prazo, artigo) é escrito EXATAMENTE como no trecho.
4. O que não está escrito não entra. Lista vazia é a resposta certa quando não há nada.
Responda SÓ com um JSON válido, sem texto antes ou depois.`;

const PEDIDO = `Liste o que cada lado alega e o que foi decidido nestas páginas:
{"itens": [{
  "tipo": "pedido" | "causa_de_pedir" | "defesa" | "decisao",
  "lado": "autor" | "reu" | "juizo" | "terceiro",
  "texto": "o item em português simples, uma frase",
  "pagina": número,
  "trecho": "cópia literal da página"
}]}
- pedido: o que se pede ao juízo. causa_de_pedir: os fatos e fundamentos do pedido.
- defesa: o que a parte contrária responde. decisao: o que o juízo já decidiu (liminar, despacho com conteúdo, sentença, acórdão) — o trecho tem de conter a decisão.
- Uma petição inicial sozinha não tem defesa nem decisão: não invente.

AUTOS:
`;

const itemDoModelo = z.object({
  tipo: z.enum(TIPOS_DE_ALEGACAO),
  lado: z.enum(LADOS),
  texto: z.string().trim().min(3).max(600),
  pagina: z.number().int(),
  trecho: z.string().trim().min(1),
});

export async function leAlegacoes(paginas: Pagina[], chamar: ChamadaDoModelo): Promise<LeituraDasAlegacoes> {
  const { comTexto, semTexto } = paginasParaLeitura(paginas);
  const removidas: LeituraDasAlegacoes["removidas"] = {
    sem_pagina: 0,
    trecho_nao_literal: 0,
    tamanho_do_trecho: 0,
    numero_sem_apoio: 0,
    formato: 0,
    repetido: 0,
    decisao_sem_verbo: 0,
  };
  const blocosNaoLidos: LeituraDasAlegacoes["blocosNaoLidos"] = [];
  const blocos = blocosDePaginas(comTexto);
  const apontados = new Set<TipoDeAlegacao>();

  type Resposta = { itens: unknown[] } | { falha: string };
  const respostas = await emLotes(blocos, BLOCOS_SIMULTANEOS, async (bloco): Promise<Resposta> => {
    try {
      const { texto } = await chamar({ system: SISTEMA_DA_LEITURA, user: PEDIDO + autosDoBloco(bloco) });
      const json = jsonDoModelo(texto) as { itens?: unknown } | null;
      return Array.isArray(json?.itens) ? { itens: json.itens as unknown[] } : { falha: "resposta do modelo fora do formato" };
    } catch (e) {
      return { falha: motivoDaFalha(e) }; // falha do provedor = bloco não lido, dito no documento — nunca "nada alegado"
    }
  });

  const vistos = new Set<string>();
  const alegacoes: Alegacao[] = [];
  respostas.forEach((r, i) => {
    const bloco = blocos[i]!;
    if ("falha" in r) {
      blocosNaoLidos.push({ primeira: bloco[0]!.numero, ultima: bloco[bloco.length - 1]!.numero, motivo: r.falha });
      return;
    }
    for (const bruto of r.itens) {
      const tipo = (bruto as { tipo?: unknown })?.tipo;
      if (TIPOS_DE_ALEGACAO.includes(tipo as TipoDeAlegacao)) apontados.add(tipo as TipoDeAlegacao);
      const lido = itemDoModelo.safeParse(bruto);
      if (!lido.success) {
        removidas[typeof (bruto as { pagina?: unknown })?.pagina !== "number" ? "sem_pagina" : "formato"] += 1;
        continue;
      }
      // Só vale a página DESTE bloco: o modelo não viu as outras.
      const recusa = motivoParaRecusar(lido.data, bloco);
      if (recusa) {
        removidas[recusa] += 1;
        continue;
      }
      if (lido.data.tipo === "decisao" && !VERBO_DE_DECISAO.test(sombra(lido.data.trecho))) {
        removidas.decisao_sem_verbo += 1;
        continue;
      }
      const chave = `${lido.data.tipo}|${lido.data.pagina}|${lido.data.trecho.replace(/\s+/g, " ").toLowerCase()}`;
      if (vistos.has(chave)) {
        removidas.repetido += 1;
        continue;
      }
      vistos.add(chave);
      alegacoes.push(lido.data);
    }
  });

  alegacoes.sort((a, b) => a.pagina - b.pagina);
  const temItem = (t: TipoDeAlegacao) => alegacoes.some((a) => a.tipo === t);
  return {
    alegacoes,
    naoConsta: TIPOS_DE_ALEGACAO.filter((t) => !temItem(t) && !apontados.has(t)),
    descartados: TIPOS_DE_ALEGACAO.filter((t) => !temItem(t) && apontados.has(t)),
    removidas,
    blocosNaoLidos,
    paginasSemTexto: semTexto,
  };
}
