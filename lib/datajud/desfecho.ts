/**
 * Desfecho por movimento — ticket 0007.E3. "Mapear nomes de movimento para
 * desfecho." (spec 0007, etapa E3)
 *
 * ═══ A REGRA QUE REGE O MAPA ═══
 *
 * "Movimento desconhecido não vira desfecho" (spec 0007, tabela de riscos).
 * O mapa é por CÓDIGO da tabela TPU do CNJ — estável — e só entra código
 * MEDIDO na fonte real. Ampliar o mapa é medir de novo, não adivinhar por
 * semelhança de nome.
 *
 * Medido em 24/08/2026 (50 processos TJSP ao acaso) e em 18/08/2026 (25
 * processos, registrado na spec):
 *
 *   219 Procedência · 220 Improcedência · 221 Procedência em Parte
 *
 * A amostra de hoje trouxe também 237 Provimento e 235 Não Conhecimento de
 * recurso — desfechos DE RECURSO, não do mérito na instância. Ficam FORA até
 * a conferência manual do plano de teste dizer o que significam para a
 * estatística do juízo; entrar agora seria contar reforma como procedência.
 *
 * ═══ QUANDO HÁ MAIS DE UM MOVIMENTO DE MÉRITO ═══
 *
 * Vale o mais RECENTE por dataHora — embargos e retratação substituem a
 * decisão anterior. Se houver empate de ignorância (mais de um movimento de
 * mérito e algum sem data legível), o desfecho é `null` com o motivo dito:
 * escolher no escuro é como a estatística mente. Falha fechado, contada.
 *
 * Como toda extração deste produto, o desfecho vem com o FUNDAMENTO: qual
 * movimento o produziu, com código, nome e data. Número sem origem não é
 * conferível — e a spec exige que todo número mostre de onde veio.
 */

import { paraIso } from "./api";

export type Desfecho = "procedencia" | "improcedencia" | "procedencia_parcial";

/** Só código MEDIDO entra. TPU do CNJ; nome documentado ao lado. */
export const MOVIMENTO_PARA_DESFECHO: Record<number, Desfecho> = {
  219: "procedencia", // Procedência
  220: "improcedencia", // Improcedência
  221: "procedencia_parcial", // Procedência em Parte
};

export type Fundamento = {
  codigo: number;
  nome: string | null;
  /** ISO, ou `null` quando a data veio ilegível — o bruto fica no espelho. */
  dataHora: string | null;
};

export type LeituraDeDesfecho = {
  desfecho: Desfecho | null;
  /** O movimento que fundamentou o desfecho. `null` quando não há desfecho. */
  fundamento: Fundamento | null;
  motivo: "mapeado" | "sem_movimento_de_merito" | "conflito_sem_data";
  /** Itens de `movimentos` que não deu para ler. Sujeira contada, não engolida. */
  ilegiveis: number;
};

/**
 * O item como veio do espelho (`movimentos: unknown[]`). Medido: existe
 * movimento com `nome` ausente (código 15216 veio sem nome na amostra real) —
 * por isso só o código é obrigatório.
 */
function leMovimento(item: unknown): Fundamento | null {
  if (typeof item !== "object" || item === null) return null;
  const m = item as Record<string, unknown>;
  if (typeof m.codigo !== "number") return null;
  return {
    codigo: m.codigo,
    nome: typeof m.nome === "string" ? m.nome : null,
    dataHora: typeof m.dataHora === "string" ? paraIso(m.dataHora) : null,
  };
}

export function desfechoDoProcesso(movimentos: unknown[]): LeituraDeDesfecho {
  let ilegiveis = 0;
  const deMerito: Fundamento[] = [];

  for (const item of movimentos) {
    const f = leMovimento(item);
    if (!f) {
      ilegiveis += 1;
      continue;
    }
    if (f.codigo in MOVIMENTO_PARA_DESFECHO) deMerito.push(f);
  }

  if (deMerito.length === 0) {
    return { desfecho: null, fundamento: null, motivo: "sem_movimento_de_merito", ilegiveis };
  }

  let escolhido: Fundamento;
  if (deMerito.length === 1) {
    escolhido = deMerito[0]!;
  } else {
    // A ordem do array não é garantia de cronologia — quem ordena é a data.
    if (deMerito.some((f) => f.dataHora === null)) {
      return { desfecho: null, fundamento: null, motivo: "conflito_sem_data", ilegiveis };
    }
    escolhido = deMerito.reduce((a, b) => (b.dataHora! > a.dataHora! ? b : a));
  }

  return {
    desfecho: MOVIMENTO_PARA_DESFECHO[escolhido.codigo]!,
    fundamento: escolhido,
    motivo: "mapeado",
    ilegiveis,
  };
}
