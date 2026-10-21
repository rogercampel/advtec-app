/**
 * A leitura de um processo, de ponta a ponta — ticket 0003.E6 (#41).
 *
 * Junta as etapas na ordem: quem é quem e linha do tempo (código, sem modelo),
 * alegações (modelo, em blocos), contradições (modelo, sobre os itens já
 * ancorados) e o documento de saída. O modelo entra pela `ChamadaDoModelo`.
 *
 * Critério 7 da spec 0003: "documento grande demais avisa o custo ANTES de
 * processar". `estimaCusto` responde sem chamar o modelo: tokens, minutos e o
 * custo em dólar se a leitura for pela chave de API (pela assinatura do
 * ChatGPT não há cobrança por token; conta no limite de uso da conta).
 */
import { leAlegacoes } from "./alegacoes";
import { itensDosAutos, leContradicoes } from "./contradicoes";
import { montaDocumento, type DocumentoDeLeitura } from "./documento-de-leitura";
import type { Pagina } from "./fatiar";
import { estimaLeitura, MODELO_DA_LEITURA, paginasParaLeitura, type ChamadaDoModelo } from "./leitura-por-modelo";
import { linhaDoTempo } from "./linha-do-tempo";
import { quemEQuem } from "./quem-e-quem";

/** Medido nas leituras reais de 21/10/2026: saída de 12% a 32% da entrada. Fica o pior. */
const SAIDA_POR_ENTRADA = 0.32;
/** Instruções e pedido de cada chamada, mais a chamada das contradições. */
const TOKENS_FIXOS_POR_BLOCO = 700;
const TOKENS_DAS_CONTRADICOES = 6_000;

export type EstimativaDaLeitura = {
  paginas: number;
  tokens: number;
  blocos: number;
  minutos: number;
  /** Custo pela chave de API, em dólar; `null` se o modelo não tem preço conhecido. */
  dolaresPelaChave: number | null;
};

export async function estimaCusto(paginas: Pagina[]): Promise<EstimativaDaLeitura> {
  const { tokens, blocos, minutos } = estimaLeitura(paginas);
  const entrada = tokens + blocos * TOKENS_FIXOS_POR_BLOCO + TOKENS_DAS_CONTRADICOES;
  const { precoDoModelo } = await import("@/lib/agent-engine/edge/llm/pricing");
  const preco = precoDoModelo(MODELO_DA_LEITURA);
  const dolaresPelaChave = preco ? (entrada * preco.input + entrada * SAIDA_POR_ENTRADA * preco.output) / 1_000_000 : null;
  // ponytail: contradições estimadas num valor fixo; o pedido real cresce com os itens achados — por isso a tela diz "cerca de", não "até".
  return { paginas: paginas.length, tokens, blocos, minutos, dolaresPelaChave };
}

export async function executaLeitura(paginas: Pagina[], chamar: ChamadaDoModelo): Promise<DocumentoDeLeitura> {
  const linha = linhaDoTempo(paginas);
  const alegacoes = await leAlegacoes(paginas, chamar);
  // Os leitores guardam a falha de cada bloco no documento. Se NENHUM bloco foi
  // lido (assinatura recusada, chave sem saldo), não há documento: é falha, não
  // um "pronta" vazio.
  const naoLidas = new Set(alegacoes.blocosNaoLidos.flatMap((b) => Array.from({ length: b.ultima - b.primeira + 1 }, (_, i) => b.primeira + i)));
  const { comTexto } = paginasParaLeitura(paginas);
  if (comTexto.length > 0 && comTexto.every((p) => naoLidas.has(p.numero))) {
    throw new Error(`nenhum bloco foi lido pelo modelo: ${alegacoes.blocosNaoLidos[0]?.motivo ?? "sem motivo"}`);
  }
  const contradicoes = await leContradicoes(itensDosAutos(alegacoes.alegacoes, linha.eventos), chamar);
  return montaDocumento({ quemEQuem: quemEQuem(paginas), linhaDoTempo: linha, alegacoes, contradicoes });
}
