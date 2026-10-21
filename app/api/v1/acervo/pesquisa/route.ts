/**
 * POST /api/v1/acervo/pesquisa — a pesquisa de tese no acervo (issue #90).
 *
 * Lê com a SESSÃO do usuário: a RPC `fn_buscar_trechos_das_fontes` recusa quem
 * não é membro da organização pedida, e o espelho do DataJud tem RLS. A
 * organização vem de `requireRole`, nunca do corpo. Não grava no acervo, mas
 * cada pergunta gasta um embedding na chave do escritório — é efeito, e por isso
 * o modo de acompanhamento só leitura (`requireSupportWrite`) não pesquisa.
 *
 * Mesmo teto de chamadas da busca do acervo da base (`/api/v1/ai/knowledge/busca`),
 * porque cada pergunta gasta um embedding.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import type { ProcessoNoEspelho } from "@/lib/acervo/desfecho-das-pecas";
import { pesquisaNoAcervo } from "@/lib/acervo/pesquisa";
import { ok, fail } from "@/lib/api/wrappers";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { SemChaveDeEmbeddingError, embedText } from "@/lib/ai/embed";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TETO_POR_USUARIO = 12;
const JANELA_SEGUNDOS = 60;

const corpo = z.object({ problema: z.string().trim().min(3).max(1000) });

type Supa = Awaited<ReturnType<typeof createClient>>;

/** A busca da base pela RPC, trazendo a `metadata` — é nela que mora a origem. */
function buscadorDaSessao(supabase: Supa): Buscador {
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

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const support = await requireSupportWrite();
  if (support) return support;

  const authz = await requireRole("agent", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = corpo.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("unprocessable", t("Descreva o problema em poucas palavras."), 422, { requestId });

  const limite = await checkRateLimit(`acervo-pesquisa:${authz.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitas perguntas seguidas. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const supabase = await createClient();
  const organizationId = authz.org.orgId;
  const { data: fontes, error } = await supabase
    .from("ai_knowledge_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  if (error) return fail("internal_error", t("Não foi possível ler o acervo."), 500, { requestId });

  const r = await pesquisaNoAcervo({
    buscar: buscadorDaSessao(supabase),
    organizationId,
    fontes: (fontes ?? []).map((f) => f.id as string),
    problema: lido.data.problema,
    espelhoDe: async (processos) => {
      const { data } = await supabase
        .from("datajud_processos")
        .select("numero_processo, nivel_sigilo, data_ajuizamento, data_ajuizamento_bruto, movimentos, coletado_em")
        .eq("organization_id", organizationId)
        .in("numero_processo", processos);
      return (data ?? []) as unknown as ProcessoNoEspelho[];
    },
  });

  if (r.situacao === "falha") {
    const semAcervo = r.codigo === "sem_acervo";
    const semChave = r.codigo === "embedding_sem_chave";
    return fail(
      semAcervo ? "not_found" : semChave ? "precondition_failed" : "internal_error",
      semAcervo
        ? t("O escritório ainda não tem acervo enviado.")
        : semChave
          ? t("A pesquisa precisa de uma chave de embedding em Credenciais.")
          : t("Não foi possível pesquisar agora. Tente de novo."),
      semAcervo ? 404 : semChave ? 412 : 500,
      { requestId },
    );
  }
  return ok(r, { requestId });
}
