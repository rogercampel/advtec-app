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
 *   o sistema copiaria a própria peça. A resposta diz o que o filtro tirou
 *   (`deixados_de_fora`) e quais termos não tiraram nada (`termos_sem_efeito`):
 *   termo que não casa com nome nenhum deixaria a própria peça passar, calado.
 * - Gasta modelo e embedding: `agent` em diante, teto por pessoa, e o modo de
 *   acompanhamento só leitura não escreve minuta. O teto mensal de IA da
 *   organização é cobrado por `runModelCall` antes de a chamada sair (critério 8).
 * - As fontes são lidas ANTES do teto por pessoa: organização sem acervo recebe
 *   404 sem gastar uma das 10 vagas da hora.
 * - Nada é gravado e nada sai: a resposta volta para quem pediu (critério 6).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { buscadorDaSessao, novoRegistroDoFiltro, semOsDocumentos, TUDO_DEIXADO_DE_FORA } from "@/lib/acervo/buscador-da-sessao";
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

  const supabase = await createClient();
  const organizationId = authz.org.orgId;
  const { data: fontes, error } = await supabase
    .from("ai_knowledge_sources")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("is_active", true);
  if (error) return fail("internal_error", t("Não foi possível ler o acervo."), 500, { requestId });
  if ((fontes ?? []).length === 0) return fail("not_found", t("O escritório ainda não tem acervo enviado."), 404, { requestId });

  const limite = await checkRateLimit(`acervo-minuta:${authz.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitas minutas seguidas. Tente de novo em uma hora."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  const tirados = novoRegistroDoFiltro();
  const m = await escreveMinuta({
    buscar: semOsDocumentos(buscadorDaSessao(supabase), lido.data.deixar_de_fora, tirados),
    organizationId,
    fontesDoAcervo: (fontes ?? []).map((f) => f.id as string),
    pedido: lido.data.pedido,
    chamar: chamadaPelaAssinatura(getRequestPool(), organizationId, { purpose: "minuta_do_acervo" }),
  });

  if (m.situacao === "falha") {
    if (m.codigo === "sem_acervo") return fail("not_found", t("O escritório ainda não tem acervo enviado."), 404, { requestId });
    if (m.codigo === "embedding_sem_chave") {
      return fail("precondition_failed", t("A minuta precisa de uma chave de embedding em Credenciais."), 412, { requestId });
    }
    if (m.codigo === TUDO_DEIXADO_DE_FORA) {
      return fail("unprocessable", t("O filtro deixou de fora todo o acervo encontrado; confira os nomes."), 422, {
        requestId,
        details: { deixados_de_fora: [...tirados.documentos] },
      });
    }
    if (m.codigo === "modelo" && /llm_budget_exceeded/.test(m.motivo ?? "")) {
      return fail(
        "llm_budget_exceeded",
        t("O limite mensal de uso de IA do escritório foi atingido. Peça a um administrador para ajustar o teto em Uso de IA › Orçamento, ou aguarde a virada do mês."),
        402,
        { requestId },
      );
    }
    if (m.codigo === "modelo" || m.codigo === "formato") {
      return fail("bad_gateway", t("O modelo respondeu fora do esperado. Tente de novo."), 502, { requestId });
    }
    return fail("internal_error", t("Não foi possível escrever a minuta agora. Tente de novo."), 500, { requestId });
  }

  const termosSemEfeito = lido.data.deixar_de_fora.filter((x) => !tirados.termosComEfeito.has(x));
  return ok(
    {
      minuta: m,
      arquivo: m.situacao === "minuta" ? minutaEmTexto(m, lido.data.pedido) : null,
      deixados_de_fora: [...tirados.documentos],
      termos_sem_efeito: termosSemEfeito,
    },
    { requestId },
  );
}
