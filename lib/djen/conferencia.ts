/**
 * Conferência da contagem — 0006.E5 (#27) e 0009.E4 (#66).
 *
 * A data que alguém do escritório confirma é a que ele contou no PRÓPRIO
 * controle. Compará-la com a contagem sugerida (0006.E4) é a medição que a spec
 * pede antes de qualquer confiança: "30 dias rodando em paralelo ao controle
 * atual, sem divergência" (spec 0006, plano de teste). O mesmo julgamento corre
 * sobre o gabarito do advogado (`tests/fixtures/gabarito-contagem.json`).
 *
 *   - "acertou": a sugestão bate com a data correta;
 *   - "incerta": não bate, mas a sugestão AVISAVA o motivo provável (feriado
 *     nacional no caminho, recesso, ou texto que não declarou útil/corrido) —
 *     é o "incerto — confira" que a decisão admite;
 *   - "errou": não bate e não avisou — data errada com cara de certa. É o que
 *     reprova.
 *
 * O aviso geral ("feriados locais e móveis… não entram na conta") NÃO conta como
 * aviso aqui: ele aparece sempre, e contá-lo faria todo erro virar "incerta".
 */
import type { PublicacaoDaCaixa } from "./caixa";
import { diaNoForo } from "./coletar";
import { contaPrazo, type ContagemSugerida } from "./contagem";
import { lePrazos } from "./ler";
import { diasEntre } from "./pauta";

/** Dias em paralelo, sem divergência, antes de se conversar sobre confiar (spec 0006). */
export const DIAS_EM_PARALELO = 30;

export type Julgamento = "acertou" | "incerta" | "errou";

export function julga(sugerida: Extract<ContagemSugerida, { situacao: "sugerida" }>, correta: string): Julgamento {
  if (sugerida.vence === correta) return "acertou";
  return sugerida.feriados.length > 0 || sugerida.recesso || !sugerida.declarada ? "incerta" : "errou";
}

export type Divergencia = {
  publicacao: PublicacaoDaCaixa;
  sugerida: string;
  confirmada: string;
  /** Confirmada menos sugerida, em dias corridos (positivo = o escritório contou mais). */
  diferenca: number;
  julgamento: Exclude<Julgamento, "acertou">;
};

export type Conferencia = {
  confirmadas: number;
  acertos: number;
  divergencias: Divergencia[];
  /** Confirmadas cujo texto não deu contagem (sem número no texto): fora da medição. */
  semSugestao: number;
  /** Dia da primeira confirmação (o começo do paralelo), ou `null`. */
  desde: string | null;
  diasEmParalelo: number;
};

export function confereContagem(publicacoes: PublicacaoDaCaixa[], hoje: string): Conferencia {
  const c: Conferencia = { confirmadas: 0, acertos: 0, divergencias: [], semSugestao: 0, desde: null, diasEmParalelo: 0 };
  const vistas = new Set<string>();
  for (const p of publicacoes) {
    const confirmado = p.prazoConfirmado;
    if (!confirmado || vistas.has(p.id)) continue;
    vistas.add(p.id);
    c.confirmadas++;
    // O dia do FORO: 22h30 em Brasília ainda é o mesmo dia, mesmo que em UTC já seja o seguinte.
    const dia = diaNoForo(new Date(confirmado.confirmadoEm));
    if (c.desde === null || dia < c.desde) c.desde = dia;

    const sugeridas = lePrazos(p.texto)
      .map((prazo) => contaPrazo(p.dataDisponibilizacao, prazo))
      .filter((s): s is Extract<ContagemSugerida, { situacao: "sugerida" }> => s.situacao === "sugerida");
    if (sugeridas.length === 0) {
      c.semSugestao++;
      continue;
    }
    // Publicação com mais de um prazo: o escritório confirma UM; acerto é bater com algum.
    if (sugeridas.some((s) => s.vence === confirmado.venceEm)) {
      c.acertos++;
      continue;
    }
    const s = sugeridas[0]!;
    c.divergencias.push({
      publicacao: p,
      sugerida: s.vence,
      confirmada: confirmado.venceEm,
      diferenca: diasEntre(s.vence, confirmado.venceEm),
      julgamento: julga(s, confirmado.venceEm) as Exclude<Julgamento, "acertou">,
    });
  }
  c.diasEmParalelo = c.desde === null ? 0 : Math.max(0, diasEntre(c.desde, hoje));
  return c;
}
