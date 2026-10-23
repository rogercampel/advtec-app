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
 *   - "incerta": não bate, mas a sugestão AVISAVA um motivo que EXPLICA a
 *     direção e o tamanho da diferença (ver `julga`) — é o "incerto — confira"
 *     que a decisão admite;
 *   - "errou": não bate e nenhum aviso a explica — data errada com cara de
 *     certa. É o que reprova.
 *
 * Ter um aviso NÃO basta: feriado nacional não é descontado pela sugestão, então
 * só explica uma data confirmada DEPOIS dela e por poucos dias. Medido em
 * 23/10/2026 (revisão): com a regra "qualquer aviso → incerta", +14, −9 e −12
 * dias contra uma sugestão com Finados no caminho saíam todos "incerta".
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

/**
 * Prazos COMPARADOS (acertos + divergências) antes de se conversar sobre confiar.
 * É o tamanho do gabarito pedido ao advogado do piloto: trinta dias com um prazo
 * só não mede nada. "Sem contagem possível" não conta — não foi comparado.
 */
export const MINIMO_DE_COMPARADAS = 20;

/** Dias a mais que um feriado nacional não descontado explica, por feriado no caminho. */
export const DIAS_POR_FERIADO = 3;
/** O recesso (20/12 a 20/01) suspende o prazo: explica uma data confirmada até ~35 dias depois. */
export const DIAS_DO_RECESSO = 35;

export type Julgamento = "acertou" | "incerta" | "errou";

/**
 * "Incerta" só quando o aviso EXPLICA a direção e o tamanho da diferença
 * (`diferenca` = confirmada − sugerida, em dias corridos):
 *   - feriado nacional no caminho (não descontado): confirmada DEPOIS, até 3 dias por feriado;
 *   - recesso (a sugestão não o suspende): confirmada DEPOIS, até 35 dias;
 *   - texto que não declarou útil/corrido (a sugestão assume úteis): confirmada ANTES —
 *     o escritório contou corrido.
 * Fora disso é "errou": data diferente com cara de certa.
 */
export function julga(sugerida: Extract<ContagemSugerida, { situacao: "sugerida" }>, correta: string): Julgamento {
  if (sugerida.vence === correta) return "acertou";
  const diferenca = diasEntre(sugerida.vence, correta);
  const feriado = sugerida.feriados.length > 0 && diferenca > 0 && diferenca <= DIAS_POR_FERIADO * sugerida.feriados.length;
  const recesso = sugerida.recesso && diferenca > 0 && diferenca <= DIAS_DO_RECESSO;
  const contouCorrido = !sugerida.declarada && diferenca < 0;
  return feriado || recesso || contouCorrido ? "incerta" : "errou";
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
  /** A leitura bateu no teto de linhas: faltam as confirmações mais antigas, e `desde` é do recorte, não da primeira. */
  cortada: boolean;
};

/** Comparadas: acertos + divergências. "Sem contagem possível" ficou fora da comparação. */
export const comparadas = (c: Conferencia) => c.acertos + c.divergencias.length;

/**
 * Só aqui a tela fala em começar a conversa sobre confiar: 30 dias em paralelo,
 * ao menos 20 prazos COMPARADOS, nenhuma divergência (nem a avisada) e a leitura inteira.
 */
export function podeConversarSobreConfiar(c: Conferencia): boolean {
  return !c.cortada && c.diasEmParalelo >= DIAS_EM_PARALELO && comparadas(c) >= MINIMO_DE_COMPARADAS && c.divergencias.length === 0;
}

export function confereContagem(publicacoes: PublicacaoDaCaixa[], hoje: string, opcoes: { cortada?: boolean } = {}): Conferencia {
  const c: Conferencia = {
    confirmadas: 0,
    acertos: 0,
    divergencias: [],
    semSugestao: 0,
    desde: null,
    diasEmParalelo: 0,
    cortada: opcoes.cortada === true,
  };
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
