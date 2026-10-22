/**
 * POST /api/v1/conversations/[id]/historico — AdvTec: traz para a conversa o
 * histórico que o canal do WhatsApp guardou daquele contato (sob demanda).
 *
 * Quem pode: `agent` em diante, fora do modo suporte só-leitura. A conversa é
 * conferida com a SESSÃO (RLS + organização ativa) antes de qualquer escrita;
 * só então o client de serviço grava. O que a importação grava e por que não
 * dispara nada está em `lib/waha/historico.ts`.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getWahaClient } from "@/lib/waha/client";
import { importarHistoricoDaConversa } from "@/lib/waha/historico";

export const dynamic = "force-dynamic";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

/** Cada frase escrita literal dentro de `t()`: a cerca de i18n só traduz o que consegue ler. */
const recusas = (t: (s: string) => string) =>
  ({
    conversa_nao_encontrada: [404, t("Conversa não encontrada.")],
    conversa_de_grupo: [422, t("O histórico de grupo não é importado por aqui.")],
    sem_canal: [422, t("Esta conversa não está ligada a um número de WhatsApp conectado.")],
    contato_sem_endereco: [422, t("O contato não tem número de WhatsApp para buscar o histórico.")],
    canal_indisponivel: [503, t("O servidor do WhatsApp não respondeu. Tente de novo em instantes.")],
  }) as const;

export async function POST(_req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const t = (s: string) => traduzir(s, authz.user.idioma);

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  // A conversa tem de ser visível PARA ESTA PESSOA, nesta organização.
  const supabase = await createClient();
  const { data: visivel } = await supabase
    .from("conversations")
    .select("id")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!visivel) return fail("not_found", t("Conversa não encontrada."), 404, { requestId });

  const waha = getWahaClient();
  if (!waha) return fail("unavailable", recusas(t).canal_indisponivel[1], 503, { requestId });

  const r = await importarHistoricoDaConversa(createAdminClient(), waha, authz.org.orgId, id);
  if (!r.ok) {
    const [status, mensagem] = recusas(t)[r.motivo];
    return fail(r.motivo, mensagem, status, { requestId });
  }
  return ok({ importadas: r.importadas, ja_estavam: r.jaEstavam, no_canal: r.noCanal }, { requestId });
}
