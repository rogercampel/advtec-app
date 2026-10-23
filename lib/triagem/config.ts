/**
 * A CONFIG DA TRIAGEM POR ESCRITÓRIO — spec 0001.E3.
 *
 * Onde mora: `organizations.settings -> 'triagem'` (jsonb que já existe e já tem
 * outros donos: `visibility_mode`, `routing`, `llm`...). Sem migration, sem
 * coluna nova: o escritório piloto precisa de duas listas curtas, e uma coluna
 * só para isso seria a "tabela para uma chave" que a doutrina evita.
 *
 *   settings.triagem = {
 *     "areas_atendidas": ["trabalhista", "familia_sucessoes"],
 *     "areas_recusadas": ["criminal"]
 *   }
 *
 * Aceita o id (`familia_sucessoes`) ou o nome como a pessoa escreve ("Família e
 * sucessões", "Penal") — `areaDoRotulo` resolve. Entrada que não é área
 * conhecida é IGNORADA: lista de recusa com erro de digitação não recusa nada
 * (cai em "perguntar ao advogado"), nunca o contrário.
 *
 * PADRÃO quando o escritório não configurou: duas listas vazias = nenhuma
 * recusa automática, toda área vai para o advogado decidir. Idem para linha
 * ausente, jsonb malformado e erro de banco: a leitura NUNCA lança, porque roda
 * no meio do turno do agente e um throw ali deixaria o cliente sem resposta.
 *
 * ⚠️ Quem GRAVA: não há tela ainda. `organizations.settings` tem vários donos que
 * fazem read-modify-write do jsonb inteiro (ver o cabeçalho da migration 0157),
 * então a gravação manual usa `jsonb_set` sobre a chave — nunca `set settings = $1`:
 *
 *   update organizations
 *      set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{triagem}',
 *            '{"areas_atendidas":["trabalhista","familia_sucessoes"],"areas_recusadas":["criminal"]}')
 *    where id = '<organization_id>';
 */
import { logger } from "@/lib/logger";

import { areaDoRotulo, type AreaId, type ConfigDeAreas } from "./areas";
import type { Consultavel } from "./banco";

export const CHAVE_DA_CONFIG = "triagem";

export const CONFIG_PADRAO: ConfigDeAreas = { atendidas: [], recusadas: [] };

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function listaDeAreas(v: unknown): AreaId[] {
  if (!Array.isArray(v)) return [];
  const ids = v.flatMap((x) => (typeof x === "string" ? [areaDoRotulo(x)] : []));
  return [...new Set(ids.filter((a): a is AreaId => a !== null))];
}

/** `organizations.settings` → a config. Pura; nunca lança. */
export function leConfigDeTriagem(settings: unknown): ConfigDeAreas {
  const c = objeto(objeto(settings)?.[CHAVE_DA_CONFIG]);
  if (!c) return CONFIG_PADRAO;
  return { atendidas: listaDeAreas(c.areas_atendidas), recusadas: listaDeAreas(c.areas_recusadas) };
}

/** Lê a linha DA organização do turno. Erro = config padrão (ninguém é recusado sozinho). */
export async function configDaTriagem(db: Consultavel, organizationId: string): Promise<ConfigDeAreas> {
  try {
    const { rows } = await db.query<{ settings: unknown }>(
      "select settings from public.organizations where id = $1",
      [organizationId],
    );
    return leConfigDeTriagem(rows[0]?.settings);
  } catch (erro) {
    logger.warn("config da triagem: leitura falhou — usando o padrão (nenhuma recusa automática)", {
      organization_id: organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return CONFIG_PADRAO;
  }
}
