/**
 * Contagem SUGERIDA — ticket 0006.E4 (#21). "Início pela data de
 * disponibilização, com a regra aplicada à mostra. Feriado e suspensão de
 * expediente entram como incerteza declarada, não como certeza calculada."
 * (spec 0006, mudança 4)
 *
 * ═══ A REGRA É PROPOSTA, NÃO DECISÃO ═══
 *
 * Contar prazo é interpretar norma. Cada escolha abaixo é a proposta que está em
 * `docs/advtec/decisao-contagem-de-prazo.md`, esperando o advogado do piloto. Quando
 * ele responder, muda AQUI, e o teste (`tests/unit/djen-contagem.test.ts`) junto:
 *
 *   §1.1 publicada no 1º dia útil depois da disponibilização; o prazo começa no
 *        1º dia útil depois da publicação (Lei 11.419/2006, art. 4º, §§3º-4º;
 *        CPC, art. 224) — `diaUtilDepois`, duas vezes;
 *   §2.1 texto que não declara: dias úteis (CPC, art. 219), com `declarada: false`;
 *   §3.1 só sábado e domingo não são úteis. Feriado nacional fixo no caminho vira
 *        AVISO (`feriados`), não entra na conta — `FERIADOS_NACIONAIS_FIXOS`;
 *   §3.3 recesso (20/12 a 20/01) no caminho vira aviso (`recesso`), não suspende;
 *   §4   prazo sem número no texto: nenhuma data (`sem_data`).
 *   Corrido terminando em sábado ou domingo passa ao próximo dia útil (CPC, art. 224, §1º).
 *
 * Não confirma nada e não alimenta "vence hoje": só a data que alguém do
 * escritório confirma vira vencimento (0006.E5).
 */
import type { PrazoLido } from "./ler";

export type ContagemSugerida =
  | { situacao: "sem_data" }
  | {
      situacao: "sugerida";
      disponibilizada: string;
      publicada: string;
      inicio: string;
      dias: number;
      contagem: "util" | "corrido";
      /** `false` = o texto não disse útil nem corrido, e a regra geral foi aplicada. */
      declarada: boolean;
      /** Último dia da contagem, antes de passar o fim de semana (só muda em corrido). */
      ultimoDia: string;
      vence: string;
      /** Feriados nacionais fixos entre a disponibilização e o vencimento: NÃO descontados. */
      feriados: Array<{ data: string; nome: string }>;
      /** O caminho passa pelo recesso de 20/12 a 20/01: NÃO descontado. */
      recesso: boolean;
    };

/** `MM-DD` → nome. Os móveis (Carnaval, Sexta-feira Santa, Corpus Christi) ficam no aviso geral. */
export const FERIADOS_NACIONAIS_FIXOS: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-25": "Natal",
};

const DIA = 86_400_000;
const paraData = (iso: string) => new Date(`${iso}T12:00:00Z`);
const paraIso = (d: Date) => d.toISOString().slice(0, 10);
const somaDias = (iso: string, n: number) => paraIso(new Date(paraData(iso).getTime() + n * DIA));
const ehUtil = (iso: string) => ![0, 6].includes(paraData(iso).getUTCDay());
function diaUtilDepois(iso: string): string {
  let d = somaDias(iso, 1);
  while (!ehUtil(d)) d = somaDias(d, 1);
  return d;
}
const noRecesso = (iso: string) => iso.slice(5) >= "12-20" || iso.slice(5) <= "01-20";

export function contaPrazo(dataDisponibilizacao: string, prazo: PrazoLido): ContagemSugerida {
  const disponibilizada = dataDisponibilizacao.slice(0, 10);
  if (prazo.dias === null || prazo.dias < 1 || Number.isNaN(paraData(disponibilizada).getTime())) {
    return { situacao: "sem_data" };
  }
  const publicada = diaUtilDepois(disponibilizada);
  const inicio = diaUtilDepois(publicada);
  const contagem = prazo.contagem === "corrido" ? "corrido" : "util";

  let ultimoDia = inicio;
  if (contagem === "corrido") ultimoDia = somaDias(inicio, prazo.dias - 1);
  else for (let n = 1; n < prazo.dias; n++) ultimoDia = diaUtilDepois(ultimoDia);
  const vence = ehUtil(ultimoDia) ? ultimoDia : diaUtilDepois(ultimoDia);

  const feriados: Array<{ data: string; nome: string }> = [];
  let recesso = false;
  for (let d = somaDias(disponibilizada, 1); d <= vence; d = somaDias(d, 1)) {
    const nome = FERIADOS_NACIONAIS_FIXOS[d.slice(5)];
    if (nome) feriados.push({ data: d, nome });
    recesso ||= noRecesso(d);
  }

  return {
    situacao: "sugerida",
    disponibilizada,
    publicada,
    inicio,
    dias: prazo.dias,
    contagem,
    declarada: prazo.contagem !== "nao_declarada",
    ultimoDia,
    vence,
    feriados,
    recesso,
  };
}
