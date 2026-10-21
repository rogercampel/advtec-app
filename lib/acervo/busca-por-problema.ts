/**
 * Busca por problema — ticket 0004.E1.
 *
 * "O advogado descreve a situação. O sistema devolve os trechos das peças do
 * escritório que enfrentaram aquilo — por significado, não por termo exato."
 * (spec 0004) A busca é a da base (`searchKnowledge`: embedding + recorte por
 * organização e por fonte); este módulo é a camada jurídica em volta dela:
 *
 *   - todo trecho sai com documento e página (`comOrigem`, 0002.E4 — critério 3);
 *   - e com o processo da peça, quando a E3 conseguiu amarrar;
 *   - nada acima do limiar → `nada_no_acervo`, com a frase pronta. É a
 *     armadilha do critério 4: matéria ausente do acervo nunca vira um texto
 *     plausível, porque não existe texto nenhum aqui para o modelo enfeitar;
 *   - falha da busca é falha, com o código — não "nada encontrado".
 */
import { comOrigem, origemDoTrecho, type TrechoComOrigem } from "@/lib/acervo/origem";
import { searchKnowledge, type SearchKnowledgeResult } from "@/lib/agent-engine/agent/search-knowledge";

export const NADA_NO_ACERVO = "Não há nada no acervo do escritório sobre isso.";

/** ponytail: limiar e K da base do agente (0.4 / 5 ficam no agente); aqui, 8 trechos e o mesmo 0.4. Ajuste depois de medir com peças reais. */
export const LIMIAR_PADRAO = 0.4;
export const TRECHOS_PADRAO = 8;

export type TrechoDaPeca = TrechoComOrigem & { processo: string | null };

export type ResultadoDaBusca =
  | { situacao: "encontrado"; trechos: TrechoDaPeca[]; semOrigem: number }
  | { situacao: "nada_no_acervo"; mensagem: typeof NADA_NO_ACERVO; semOrigem: number }
  | { situacao: "falha"; codigo: string };

/**
 * Quem busca: o motor do agente usa o pool do Postgres (`buscadorPg`); a tela usa
 * a RPC do Supabase com a sessão do usuário (a rota da pesquisa). A camada
 * jurídica abaixo é a mesma para os dois.
 */
export type Buscador = (q: {
  organizationId: string;
  fontes: string[];
  query: string;
  topK: number;
  threshold: number;
}) => Promise<SearchKnowledgeResult>;

type Busca = typeof searchKnowledge;

export const buscadorPg =
  (pool: Parameters<Busca>[0], deps?: Parameters<Busca>[2]): Buscador =>
  (q) =>
    searchKnowledge(
      pool,
      { organizationId: q.organizationId, knowledgeSourceIds: q.fontes, query: q.query, topK: q.topK, threshold: q.threshold },
      deps,
    );

export async function buscaPorProblema(
  buscar: Buscador,
  args: { organizationId: string; fontesDoAcervo: string[]; problema: string; limiar?: number; trechos?: number },
): Promise<ResultadoDaBusca> {
  if (args.problema.trim() === "") return { situacao: "falha", codigo: "pergunta_vazia" };
  if (args.fontesDoAcervo.length === 0) return { situacao: "falha", codigo: "sem_acervo" };
  const r = await buscar({
    organizationId: args.organizationId,
    fontes: args.fontesDoAcervo,
    query: args.problema,
    topK: args.trechos ?? TRECHOS_PADRAO,
    threshold: args.limiar ?? LIMIAR_PADRAO,
  });
  if (!r.ok) return { situacao: "falha", codigo: r.error.code };

  const { trechos, semOrigem } = comOrigem(r.results);
  // `comOrigem` mantém a ordem dos que têm origem: o i-ésimo trecho é o i-ésimo destes.
  const comFonte = r.results.filter((h) => origemDoTrecho(h.metadata));
  if (trechos.length === 0) return { situacao: "nada_no_acervo", mensagem: NADA_NO_ACERVO, semOrigem };
  return {
    situacao: "encontrado",
    trechos: trechos.map((t, i) => {
      const processo = comFonte[i]?.metadata?.processo;
      return { ...t, processo: typeof processo === "string" ? processo : null };
    }),
    semOrigem,
  };
}
