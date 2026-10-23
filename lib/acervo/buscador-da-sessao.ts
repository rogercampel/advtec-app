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
 * O buscador sem os trechos dos documentos cujo NOME contém algum dos termos
 * (sem caixa). Serve à conferência da 0005: a peça que o advogado escreveu fica
 * fora do acervo da minuta, senão o sistema copiaria a própria peça.
 * ponytail: filtra depois do top-k, então a minuta pode receber menos trechos.
 */
export function semOsDocumentos(buscar: Buscador, termos: string[]): Buscador {
  const fora = termos.map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (fora.length === 0) return buscar;
  return async (q) => {
    const r = await buscar(q);
    if (!r.ok) return r;
    const nome = (h: { metadata?: unknown }) => String((h.metadata as { nome?: unknown } | null)?.nome ?? "").toLowerCase();
    return { ...r, results: r.results.filter((h) => !fora.some((t) => nome(h).includes(t))) };
  };
}
