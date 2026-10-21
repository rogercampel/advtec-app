/**
 * POST /api/v1/djen/publicacoes/[id]/confirmar-prazo — alguém do escritório diz
 * a data final do prazo (spec 0006.E5; 0009, "vence hoje / nesta semana").
 *
 * O sistema NÃO conta prazo: a contagem automática (0006.E4) espera o gabarito
 * do advogado. Quem confirma digita a data que conferiu no próprio controle, e é
 * só essa data que a pauta apresenta como fato. Confirmar de novo corrige
 * ("alguém confirma ou corrige", spec 0006, seção 5) e regrava quem e quando.
 *
 * `djen_publicacoes` não dá UPDATE ao papel autenticado (migration 9001): a
 * escrita é com service role, e a organização vem de `requireRole`, nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { diaNoForo } from "@/lib/djen/coletar";
import { diasEntre, JANELA_DO_VENCIDO } from "@/lib/djen/pauta";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Janela de data plausível em volta de hoje. Fora dela é quase sempre erro de
 * digitação (2062 no lugar de 2026); a data vencida recente passa, para quem
 * confirma atrasado registrar o que aconteceu. Para trás é a mesma janela em que
 * a pauta mostra o vencido: tudo que dá para confirmar, dá para ver e corrigir.
 */
const DIAS_PARA_TRAS = JANELA_DO_VENCIDO;
const DIAS_PARA_FRENTE = 400;

const corpoSchema = z.object({
  vence_em: z.iso.date("Informe a data final no formato AAAA-MM-DD."),
  observacao: z.string().trim().max(300).optional(),
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
  const distancia = diasEntre(diaNoForo(new Date()), lido.data.vence_em);
  if (distancia < -DIAS_PARA_TRAS || distancia > DIAS_PARA_FRENTE) {
    return fail("validation_failed", "Confira a data: ela está longe demais de hoje para ser o fim deste prazo.", 422, {
      requestId,
    });
  }

  const { data, error } = await createAdminClient()
    .from("djen_publicacoes")
    .update({
      prazo_vence_em: lido.data.vence_em,
      prazo_confirmado_em: new Date().toISOString(),
      prazo_confirmado_por: authz.user.id,
      prazo_observacao: lido.data.observacao || null,
    })
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .is("descartada_em", null)
    .select("id, prazo_vence_em, prazo_confirmado_em")
    .maybeSingle();

  if (error) return fail("internal_error", "Não foi possível confirmar o prazo.", 500, { requestId });
  if (!data) return fail("not_found", "Publicação não encontrada ou descartada.", 404, { requestId });
  return ok(data, { requestId });
}
