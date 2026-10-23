/**
 * POST /api/v1/acervo/minutas — a minuta a partir do acervo, para o advogado
 * CONFERIR (spec 0005.E2, #37). Devolve a minuta com a origem de cada bloco e o
 * texto do arquivo que ele baixa e edita onde já edita.
 *
 * - A organização vem de `requireRole`, nunca do corpo; a busca é com a SESSÃO
 *   (a RPC recusa quem não é membro) — o acervo de um escritório nunca alimenta
 *   minuta de outro (critério 9).
 * - `deixar_de_fora`: termos do NOME dos documentos que não entram na busca. É
 *   como a conferência funciona: a peça que o advogado escreveu fica fora, senão
 *   o sistema copiaria a própria peça.
 * - Gasta modelo e embedding: `agent` em diante, teto por pessoa, e o modo de
 *   acompanhamento só leitura não escreve minuta. O teto mensal de IA da
 *   organização é cobrado por `runModelCall` antes de a chamada sair (critério 8).
 * - Nada é gravado e nada sai: a resposta volta para quem pediu (critério 6).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { buscadorDaSessao, semOsDocumentos } from "@/lib/acervo/buscador-da-sessao";
import { chamadaPelaAssinatura } from "@/lib/acervo/leitura-por-modelo";
import { escreveMinuta } from "@/lib/acervo/minuta";
import { minutaEmTexto } from "@/lib/acervo/minuta-em-texto";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Cada minuta é uma chamada de modelo: poucas por pessoa por hora. */
const TETO_POR_USUARIO = 10;
const JANELA_SEGUNDOS = 3600;

const corpo = z.object({
  pedido: z.string().trim().min(10).max(2000),
  deixar_de_fora: z.array(z.string().trim().min(3).max(120)).max(10).default([]),
});

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const support = await requireSupportWrite();
  if (support) return support;

  const authz = await requireRole("agent", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const lido = corpo.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) return fail("unprocessable", t("Descreva a peça em uma ou duas frases."), 422, { requestId });

  const limite = await checkRateLimit(`acervo-minuta:${authz.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitas minutas seguidas. Tente de novo em uma hora."), 429, {
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

  const m = await escreveMinuta({
    buscar: semOsDocumentos(buscadorDaSessao(supabase), lido.data.deixar_de_fora),
    organizationId,
    fontesDoAcervo: (fontes ?? []).map((f) => f.id as string),
    pedido: lido.data.pedido,
    chamar: chamadaPelaAssinatura(getRequestPool(), organizationId, { purpose: "minuta_do_acervo" }),
  });

  if (m.situacao === "falha") {
    const semChave = m.codigo === "embedding_sem_chave";
    return fail(
      semChave ? "precondition_failed" : "internal_error",
      semChave ? t("A minuta precisa de uma chave de embedding em Credenciais.") : t("Não foi possível escrever a minuta agora. Tente de novo."),
      semChave ? 412 : 500,
      { requestId },
    );
  }
  return ok({ minuta: m, arquivo: m.situacao === "minuta" ? minutaEmTexto(m, lido.data.pedido) : null }, { requestId });
}
