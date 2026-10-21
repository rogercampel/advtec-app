/**
 * A ROTINA DO DJEN — spec 0009, etapa E1.
 *
 * De hora em hora: coleta as publicações de cada escritório com OAB monitorada
 * (uma coleta boa por dia, no fuso do foro) e avalia o alarme de coleta parada.
 * A regra mora em `lib/djen/rotina.ts`; aqui só há autorização, banco e log.
 *
 * O aviso vai para a Central da equipe — nunca para cliente. Quem é avisado
 * sobre falha da busca de intimações é o escritório, que precisa saber que a
 * lista de hoje pode estar incompleta.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { rodaRotina } from "@/lib/djen/rotina";
import { clienteDaRotina } from "@/lib/djen/rotina-banco";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  try {
    const resumo = await rodaRotina(clienteDaRotina(createAdminClient()), { agora: new Date() });
    const comAlarme = resumo.filter((r) => r.decisao.alarmar).length;
    const falhas = resumo.filter((r) => r.ok === false).length;
    if (falhas > 0 || comAlarme > 0) {
      logger.warn("[djen-coleta] rodada com falha ou alarme", { requestId, falhas, comAlarme });
    }
    return ok(
      {
        escritorios: resumo.length,
        coletados: resumo.filter((r) => r.coletou).length,
        falhas,
        alarmes: comAlarme,
        gravadas: resumo.reduce((s, r) => s + r.gravadas, 0),
      },
      { requestId },
    );
  } catch (e) {
    logger.error("[djen-coleta] rodada falhou", { requestId, error: e instanceof Error ? e.message : String(e) });
    return fail("internal_error", "Falha na rotina do DJEN.", 500, { requestId });
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  return handle(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handle(req);
}
