/**
 * O RESUMO DA MANHÃ DO DJEN — spec 0009, etapa E5.
 *
 * Uma vez por dia, às 7h de Brasília: a pauta de hoje de cada escritório com OAB
 * monitorada vai por e-mail para os usuários do escritório. Nunca para cliente.
 * A regra mora em `lib/djen/resumo.ts`; aqui só há autorização, banco e log.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodaResumo } from "@/lib/djen/resumo";
import { portaDoResumo } from "@/lib/djen/resumo-banco";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const url = `${(env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "")}/app/publicacoes`;
    const resumo = await rodaResumo(portaDoResumo(createAdminClient()), { agora: new Date(), url });
    const falhas = resumo.reduce((s, r) => s + r.falhas, 0);
    if (falhas > 0) logger.warn("[djen-resumo] e-mails que não saíram", { requestId, falhas });
    return ok(
      { escritorios: resumo.length, enviados: resumo.reduce((s, r) => s + r.enviados, 0), falhas },
      { requestId },
    );
  } catch (e) {
    logger.error("[djen-resumo] rodada falhou", { requestId, error: e instanceof Error ? e.message : String(e) });
    return fail("internal_error", "Falha no resumo da manhã.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
