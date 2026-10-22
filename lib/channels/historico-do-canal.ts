import type { SupabaseClient } from "@supabase/supabase-js";

import { getWahaClient } from "@/lib/waha/client";
import { importarHistoricoDaConversa, type ResultadoDaImportacao } from "@/lib/waha/historico";

/**
 * AdvTec: a porta da importação sob demanda do histórico, na fronteira de canal.
 *
 * Só `lib/channels/` nomeia o transporte (doutrina de restrição de canal,
 * `scripts/lint-channels.ts`): a rota e a tela perguntam a capability
 * `importaHistorico` e chamam esta função, sem saber quem guarda o histórico.
 * O que a importação grava, e por que não dispara nada, está no módulo do
 * transporte que esta função chama.
 *
 * `admin` é o client de serviço: quem chama JÁ conferiu, com a sessão do usuário,
 * que a conversa é da organização e visível para ele.
 */
export async function importarHistoricoDoCanal(
  admin: SupabaseClient,
  organizationId: string,
  conversationId: string,
): Promise<ResultadoDaImportacao> {
  const cliente = getWahaClient();
  if (!cliente) return { ok: false, motivo: "canal_indisponivel" };
  return importarHistoricoDaConversa(admin, cliente, organizationId, conversationId);
}

export type { ResultadoDaImportacao };
