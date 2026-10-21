/**
 * POST /api/v1/djen/publicacoes/[id]/descartar — "não é nossa" (spec 0009.E2).
 *
 * A terceira saída da caixa de não reconhecidas, e a única que precisa de rota
 * própria: as outras duas são o PATCH e o POST de negócio que já existem.
 *
 * `djen_publicacoes` não dá UPDATE ao papel autenticado (migration 9001), então a
 * escrita é com service role — e a organização vem de `requireRole`, nunca do
 * corpo. O motivo é obrigatório: descarte sem motivo é o descarte silencioso que
 * a spec 0006 proíbe ("descartar em silêncio é como se perde prazo").
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const corpoSchema = z.object({
  motivo: z.string().trim().min(3, "Diga em poucas palavras por que não é do escritório.").max(300),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const authz = await requireRole("agent", { requestId, resource: "djen_publicacoes" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return fail("validation_failed", "Publicação inválida.", 422, { requestId });
  }
  const lido = corpoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "corpo inválido", 422, { requestId });
  }

  const { data, error } = await createAdminClient()
    .from("djen_publicacoes")
    .update({
      descartada_em: new Date().toISOString(),
      descartada_por: authz.user.id,
      descartada_motivo: lido.data.motivo,
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("descartada_em", null)
    // Prazo confirmado não sai pela caixa: descartar tiraria a data conferida de
    // todas as listas (0006.E5). Corrige-se a data; descartar, não.
    .is("prazo_vence_em", null)
    .select("id, descartada_em")
    .maybeSingle();

  if (error) return fail("internal_error", "Não foi possível descartar a publicação.", 500, { requestId });
  if (!data) {
    return fail("not_found", "Publicação não encontrada, já descartada ou com prazo confirmado.", 404, { requestId });
  }
  return ok(data, { requestId });
}
