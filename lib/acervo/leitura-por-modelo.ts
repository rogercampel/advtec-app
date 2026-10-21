/**
 * Leitura de processo por modelo — a base das etapas 0003.E4 e 0003.E5.
 *
 * "Nenhuma afirmação sai sem página. Frase sem origem é removida, não estimada."
 * (spec 0003) Este módulo é onde essa regra vira código. Cada item do modelo
 * tem um `texto` (a frase que o advogado lê, do modelo) e um `trecho` (cópia dos
 * autos). Só sobra o item em que, conferido em código, sem outro modelo:
 *   1. o `trecho` está LITERAL na página que o item cita;
 *   2. o `trecho` tem tamanho de citação (6 a 60 palavras) — página inteira não
 *      prova frase nenhuma;
 *   3. todo NÚMERO do `texto` (valor, data, porcentagem, quantidade) está no
 *      `trecho`. É o que pega "pede R$ 50 milhões" apoiado num trecho de R$ 19,5.
 * O que a âncora NÃO prova: que o sentido do `texto` é o do `trecho`. Por isso o
 * documento mostra sempre os dois lado a lado — o advogado lê a frase e o trecho.
 *
 * Medido em 21/10/2026 com o gpt-6-luna nas duas iniciais públicas (TJMG 34
 * págs., MPRJ 12 págs.): pela assinatura do ChatGPT, 48 de 51 trechos literais na
 * página citada, nenhum inventado; depois a assinatura passou a recusar (403) e
 * as etapas E4/E5 foram medidas pela chave de API (ver `.context/MEDIDO.md`).
 *
 * O modelo entra pela `ChamadaDoModelo`, trocável: nos testes, um falso; em
 * produção, `chamadaPelaAssinatura`.
 */
import type pg from "pg";

import type { Pagina } from "./fatiar";

export type ChamadaDoModelo = (p: { system: string; user: string }) => Promise<{ texto: string }>;

/** Medido: 3,39 caracteres por token em português (corpus da busca, 21/10/2026). */
const CARACTERES_POR_TOKEN = 3.39;
/** Cabe folgado no modelo e deixa o bloco legível em ~1 minuto (medido: 16,7 mil tokens em 79 s). */
export const TOKENS_POR_BLOCO = 40_000;
/** Blocos ao mesmo tempo: a assinatura tem limite por janela, e 3 já põe 400 páginas abaixo de 10 minutos. */
export const BLOCOS_SIMULTANEOS = 3;
/** Medido: ~80 s por bloco de 34 páginas. Arredondado para cima. */
const SEGUNDOS_POR_BLOCO = 120;
/** Tamanho de citação: menos que isso não prova origem; mais é colar a página. */
export const PALAVRAS_DO_TRECHO = { minimo: 6, maximo: 60 } as const;

export const tokensDe = (texto: string) => Math.ceil(texto.length / CARACTERES_POR_TOKEN);

/**
 * As páginas como a leitura precisa: em ordem, sem número repetido, e as sem
 * texto (folha escaneada) separadas — nada pode dizer que elas foram lidas.
 * Número repetido é erro de quem chamou, e falha alto: `pagina: 5` ambíguo
 * mandaria o advogado à folha errada.
 */
export function paginasParaLeitura(paginas: Pagina[]): { comTexto: Pagina[]; semTexto: number[] } {
  const ordenadas = [...paginas].sort((a, b) => a.numero - b.numero);
  for (let i = 1; i < ordenadas.length; i++) {
    if (ordenadas[i]!.numero === ordenadas[i - 1]!.numero) throw new Error(`página ${ordenadas[i]!.numero} repetida na entrada da leitura`);
  }
  return {
    comTexto: ordenadas.filter((p) => p.texto.trim().length > 0),
    semTexto: ordenadas.filter((p) => p.texto.trim().length === 0).map((p) => p.numero),
  };
}

/** Páginas em blocos contíguos que cabem no modelo; toda página em exatamente um bloco. */
export function blocosDePaginas(paginas: Pagina[], teto = TOKENS_POR_BLOCO): Pagina[][] {
  const blocos: Pagina[][] = [];
  let atual: Pagina[] = [];
  let tokens = 0;
  for (const p of paginas) {
    const t = tokensDe(p.texto);
    if (atual.length > 0 && tokens + t > teto) {
      blocos.push(atual);
      atual = [];
      tokens = 0;
    }
    atual.push(p);
    tokens += t;
  }
  if (atual.length > 0) blocos.push(atual);
  return blocos;
}

/** O aviso ANTES de processar (spec 0003, critério 7): quanto e quanto tempo, sem chamar nada. */
export function estimaLeitura(paginas: Pagina[]): { tokens: number; blocos: number; minutos: number } {
  const blocos = blocosDePaginas(paginas).length;
  return {
    tokens: paginas.reduce((s, p) => s + tokensDe(p.texto), 0),
    blocos,
    minutos: Math.ceil((Math.ceil(blocos / BLOCOS_SIMULTANEOS) * SEGUNDOS_POR_BLOCO) / 60),
  };
}

export function autosDoBloco(bloco: Pagina[]): string {
  return bloco.map((p) => `=== PÁGINA ${p.numero} ===\n${p.texto}`).join("\n\n");
}

/** A resposta do modelo como JSON; cerca de código tolerada, qualquer outra coisa é `null`. */
export function jsonDoModelo(texto: string): unknown {
  try {
    return JSON.parse(texto.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
}

const normal = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
const palavras = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** Os números de uma frase, sem pontuação de milhar e decimal: "R$ 19.500.000,00" → "1950000000". */
export function numerosDe(s: string): string[] {
  return (s.match(/\d[\d.,]*\d|\d/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

/**
 * Todo número do `texto` aparece em alguma das `fontes`? Sem número, nada a
 * conferir. Vale o número inteiro e também cada PEDAÇO dele entre ponto, barra e
 * hífen: "23.05.2023" apoia "23 de maio de 2023" (medido: o modelo reescreve
 * datas assim). "R$ 50 milhões" num trecho de "R$19.500.000,00" continua sem
 * apoio — 50 não é nenhum dos pedaços.
 */
export function numerosApoiados(texto: string, ...fontes: string[]): boolean {
  const disponiveis = new Set<string>();
  for (const bruto of fontes.flatMap((f) => f.match(/\d[\d.,/-]*\d|\d/g) ?? [])) {
    disponiveis.add(bruto.replace(/[.,/-]/g, ""));
    for (const pedaco of bruto.split(/[.,/-]/)) if (pedaco) disponiveis.add(pedaco.replace(/^0+(?=\d)/, ""));
  }
  return numerosDe(texto).every((n) => disponiveis.has(n) || disponiveis.has(n.replace(/^0+(?=\d)/, "")));
}

export type MotivoDaRemocao = "sem_pagina" | "trecho_nao_literal" | "tamanho_do_trecho" | "numero_sem_apoio" | "formato" | "repetido";

/**
 * Por que o item não pode ir ao advogado — ou `null` se pode. Página errada é
 * falha mesmo que o trecho exista em outra: o advogado abre a página que o
 * documento disser. Só espaço e caixa são ignorados (o PDF quebra linha no meio
 * da frase).
 */
export function motivoParaRecusar(
  item: { pagina: unknown; trecho: unknown; texto?: unknown },
  paginas: Pagina[],
): Exclude<MotivoDaRemocao, "formato" | "repetido"> | null {
  if (typeof item.pagina !== "number") return "sem_pagina";
  if (typeof item.trecho !== "string") return "trecho_nao_literal";
  const n = palavras(item.trecho);
  if (n < PALAVRAS_DO_TRECHO.minimo || n > PALAVRAS_DO_TRECHO.maximo) return "tamanho_do_trecho";
  const pagina = paginas.find((p) => p.numero === item.pagina);
  if (!pagina || !normal(pagina.texto).includes(normal(item.trecho))) return "trecho_nao_literal";
  if (typeof item.texto === "string" && !numerosApoiados(item.texto, item.trecho)) return "numero_sem_apoio";
  return null;
}

/** Atalho booleano de `motivoParaRecusar`. */
export const ancorado = (item: { pagina: unknown; trecho: unknown; texto?: unknown }, paginas: Pagina[]) =>
  motivoParaRecusar(item, paginas) === null;

/** O motivo de uma falha, curto e sem segredo — vai para o documento como "não lido porque…". */
export function motivoDaFalha(e: unknown): string {
  const bruto = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  return bruto.replace(/eyJ[\w.-]+|sk-[\w-]+/g, "<oculto>").slice(0, 160);
}

/** Roda `fn` sobre os blocos com no máximo `limite` ao mesmo tempo, mantendo a ordem. */
export async function emLotes<T, R>(itens: T[], limite: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const saida = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      saida[i] = await fn(itens[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return saida;
}

/** O modelo de produção: medido e escolhido em 21/10/2026 (ver o topo). */
export const MODELO_DA_LEITURA = "gpt-6-luna";

/**
 * A chamada de produção: o motor do app (`runModelCall`), pela ASSINATURA do
 * ChatGPT da organização — custo registrado em `llm_calls`, teto de gasto da
 * organização aplicado pelo próprio motor.
 *
 * ponytail: se a assinatura falhar e a organização tiver chave de API da OpenAI,
 * o motor cai nela (política da plataforma, #1639). Desligar isso por chamada
 * exige mexer no motor, que é do original.
 */
export function chamadaPelaAssinatura(
  db: pg.Pool,
  tenantId: string,
  opcoes: { modelo?: string; purpose?: string } = {},
): ChamadaDoModelo {
  return async ({ system, user }) => {
    const { llmEdgeConfigFromEnv } = await import("@/lib/agent-engine/edge/llm/credentials");
    const { runModelCall } = await import("@/lib/agent-engine/edge/llm/run-model-call");
    const { PROVEDOR_POR_ASSINATURA } = await import("@/lib/ai/pontos/provedores");
    const { env } = await import("@/lib/env");
    const r = await runModelCall(db, llmEdgeConfigFromEnv(env), {
      tenantId,
      purpose: opcoes.purpose ?? "leitura_de_processo",
      model: opcoes.modelo ?? MODELO_DA_LEITURA,
      llmOverride: { provider: PROVEDOR_POR_ASSINATURA },
      system,
      messages: [{ role: "user", content: user }],
    });
    return { texto: r.result.text };
  };
}
