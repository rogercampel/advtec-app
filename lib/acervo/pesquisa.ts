/**
 * A pesquisa no acervo como a tela consome — issue #90.
 *
 * Junta as peças já provadas, sem regra nova:
 *   busca com origem (0004.E1) → teses (0004.E2) → desfecho pelo espelho do
 *   DataJud (0004.E4). As travas (0004.E5) valem para o texto do sistema, que na
 *   tela é rótulo fixo; o trecho é literal da peça, com a origem.
 */
import { chaveDeProcesso } from "@/lib/djen/amarrar";

import { buscaPorProblema, type Buscador } from "./busca-por-problema";
import { desfechoDasPecas, type DesfechoDaTese, type ProcessoNoEspelho } from "./desfecho-das-pecas";
import { agrupaPorTese } from "./tese";

export type FonteNaTela = { citacao: string; processo: string | null };

export type TeseNaTela = {
  /** O trecho literal mais bem colocado da tese. */
  trecho: string;
  fontes: FonteNaTela[];
  desfecho: DesfechoDaTese;
};

export type ResultadoDaPesquisa =
  | { situacao: "encontrado"; teses: TeseNaTela[] }
  | { situacao: "nada_no_acervo"; mensagem: string }
  | { situacao: "falha"; codigo: string };

export async function pesquisaNoAcervo(args: {
  buscar: Buscador;
  organizationId: string;
  fontes: string[];
  problema: string;
  /** O espelho do DataJud para estes processos (20 dígitos), só desta organização. */
  espelhoDe: (processos: string[]) => Promise<ProcessoNoEspelho[]>;
}): Promise<ResultadoDaPesquisa> {
  const r = await buscaPorProblema(args.buscar, {
    organizationId: args.organizationId,
    fontesDoAcervo: args.fontes,
    problema: args.problema,
  });
  if (r.situacao !== "encontrado") return r.situacao === "falha" ? r : { situacao: "nada_no_acervo", mensagem: r.mensagem };

  const teses = agrupaPorTese(r.trechos);
  const processos = [...new Set(teses.flatMap((t) => t.processos).map(chaveDeProcesso).filter((c): c is string => c !== null))];
  const espelho = processos.length ? await args.espelhoDe(processos) : [];

  return {
    situacao: "encontrado",
    teses: teses.map((t) => ({
      trecho: t.representante.texto,
      fontes: t.trechos.map((x) => ({ citacao: x.citacao, processo: x.processo })),
      desfecho: desfechoDasPecas(
        t.trechos.map((x) => ({ documento: x.origem.documento, processo: x.processo })),
        espelho,
      ),
    })),
  };
}
