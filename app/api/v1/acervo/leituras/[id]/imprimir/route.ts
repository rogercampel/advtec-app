/**
 * GET /api/v1/acervo/leituras/[id]/imprimir — o documento da leitura numa página
 * própria, sem o menu do app, para imprimir ou salvar em PDF (spec 0003.E6: "uma
 * página só, legível, imprimível").
 *
 * Lê com a SESSÃO: a RLS da `acervo_leituras` (migration 9007) só devolve a
 * leitura do escritório de quem pede — outro escritório recebe 404, nunca o
 * documento. Ver é `viewer`: ler o documento não gasta nada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { CSS_DO_DOCUMENTO, documentoEmHtml, escapa } from "@/lib/acervo/documento-em-html";
import type { DocumentoDeLeitura } from "@/lib/acervo/documento-de-leitura";
import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return fail("validation_failed", t("Leitura inválida."), 422, { requestId });

  const supabase = await createClient();
  const { data } = await supabase
    .from("acervo_leituras")
    .select("nome_do_arquivo, estado, documento")
    .eq("id", id)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!data || data.estado !== "pronta" || !data.documento) {
    return fail("not_found", t("Leitura não encontrada, ou ainda não está pronta."), 404, { requestId });
  }

  const titulo = `${t("Leitura de")} ${data.nome_do_arquivo}`;
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapa(titulo)}</title><style>body{margin:2rem 1rem;background:#fff}${CSS_DO_DOCUMENTO}</style></head><body>${documentoEmHtml(data.documento as DocumentoDeLeitura, t, titulo)}</body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // O documento traz trecho de processo de cliente: nada de script, nada de terceiro.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'",
      "X-Request-Id": requestId,
    },
  });
}
