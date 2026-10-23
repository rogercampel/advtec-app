/**
 * A busca no acervo com a SESSÃO do usuário (pesquisa, #90, e minuta, 0005.E2).
 * A RPC `fn_buscar_trechos_das_fontes` recusa quem não é membro da organização
 * pedida; a `metadata` de cada trecho traz a origem (documento, nome, páginas).
 */
import type { createClient } from "@/lib/supabase/server";
import { SemChaveDeEmbeddingError, embedText } from "@/lib/ai/embed";

import type { Buscador } from "./busca-por-problema";

type Supa = Awaited<ReturnType<typeof createClient>>;

export function buscadorDaSessao(supabase: Supa): Buscador {
  return async (q) => {
    try {
      const { embedding, model } = await embedText(q.query, { organizationId: q.organizationId, ponto: "embedding_consultar" });
      const { data, error } = await supabase.rpc("fn_buscar_trechos_das_fontes", {
        p_organization_id: q.organizationId,
        p_source_ids: q.fontes,
        p_embedding: `[${embedding.join(",")}]`,
        p_k: q.topK,
        p_threshold: q.threshold,
        p_embedding_model: model,
      });
      if (error) return { ok: false, error: { code: "busca_falhou", message: error.message } };
      return { ok: true, results: (data ?? []) as never };
    } catch (e) {
      if (e instanceof SemChaveDeEmbeddingError) return { ok: false, error: { code: e.code, message: e.message } };
      return { ok: false, error: { code: "busca_falhou", message: e instanceof Error ? e.message : String(e) } };
    }
  };
}

/**
 * Forma comparável de um nome de documento ou de um termo: sem acento (NFKD, que
 * também separa o acento decomposto de arquivo vindo de macOS), sem caixa, e com
 * qualquer sequência de espaço, `_`, `-` e `.` reduzida a UM espaço.
 * "Contestacao_Silva.pdf" e "contestação  Silva" passam a conter um ao outro.
 */
export function normalizaNome(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s_\-.]+/g, " ")
    .trim();
}

/** Quantas vezes o top-k a busca pede, para sobrar trecho depois de tirar a peça excluída. */
export const FOLGA_DO_FILTRO = 3;

/** O que o filtro tirou nesta busca — a rota devolve, a tela mostra. */
export type RegistroDoFiltro = {
  /** Nomes (como estão no acervo) dos documentos que saíram. */
  documentos: Set<string>;
  /** Termos (como o advogado digitou) que tiraram pelo menos um trecho. */
  termosComEfeito: Set<string>;
};
export const novoRegistroDoFiltro = (): RegistroDoFiltro => ({ documentos: new Set(), termosComEfeito: new Set() });

export const TUDO_DEIXADO_DE_FORA = "tudo_deixado_de_fora";

/**
 * O buscador sem os trechos dos documentos cujo NOME contém algum dos termos
 * (comparação por `normalizaNome` nos dois lados). Serve à conferência da 0005: a
 * peça que o advogado escreveu fica fora do acervo da minuta, senão o sistema
 * copiaria a própria peça.
 *
 * Pede `FOLGA_DO_FILTRO` vezes o top-k e corta para o top-k DEPOIS de filtrar: a peça
 * excluída é a mais parecida com o pedido e, sem a folga, ocuparia as vagas. Se o
 * filtro tirar TODOS os trechos que vieram, devolve a falha `tudo_deixado_de_fora` —
 * dizer "não há base no acervo" seria mentira. `registro` recebe o que foi tirado.
 */
export function semOsDocumentos(buscar: Buscador, termos: string[], registro?: RegistroDoFiltro): Buscador {
  const fora = termos
    .map((t) => ({ original: t.trim(), forma: normalizaNome(t) }))
    .filter((t) => t.forma !== "");
  if (fora.length === 0) return buscar;
  return async (q) => {
    const r = await buscar({ ...q, topK: q.topK * FOLGA_DO_FILTRO });
    if (!r.ok) return r;
    const mantidos: typeof r.results = [];
    for (const h of r.results) {
      const nome = String((h.metadata as { nome?: unknown } | null)?.nome ?? "");
      const forma = normalizaNome(nome);
      const acionados = fora.filter((t) => forma.includes(t.forma));
      if (acionados.length === 0) {
        mantidos.push(h);
        continue;
      }
      registro?.documentos.add(nome.trim() || "(sem nome)");
      for (const t of acionados) registro?.termosComEfeito.add(t.original);
    }
    if (r.results.length > 0 && mantidos.length === 0) {
      return { ok: false, error: { code: TUDO_DEIXADO_DE_FORA, message: "O filtro deixou de fora todo o acervo encontrado." } };
    }
    return { ...r, results: mantidos.slice(0, q.topK) };
  };
}
