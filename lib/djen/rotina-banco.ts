/**
 * `ClienteDaRotina` sobre o Supabase com service role.
 *
 * Service role ignora RLS: toda escrita e leitura daqui filtra
 * `organization_id` à mão, com o id vindo das próprias tabelas do DJEN — nunca
 * de entrada externa (a rota de cron não recebe corpo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { idsDeOrgsParadas } from "@/lib/organizacao/operante";

import type { ClienteDaRotina, EscritorioMonitorado } from "./rotina";

/** O aviso da Central é um só por escritório; a referência é a própria organização. */
export const REF_DO_AVISO = "djen_coleta";

/**
 * Início e fim do dia do foro em instantes absolutos.
 *
 * ponytail: offset fixo -03:00 — o Brasil não tem horário de verão desde 2019.
 * Se ele voltar, troque por conversão via Intl com o fuso America/Sao_Paulo.
 */
export function limitesDoDia(dia: string): { de: string; ate: string } {
  return { de: `${dia}T00:00:00-03:00`, ate: `${dia}T23:59:59.999-03:00` };
}

export function clienteDaRotina(admin: SupabaseClient): ClienteDaRotina {
  return {
    async escritoriosMonitorados() {
      const { data, error } = await admin
        .from("djen_oabs_monitoradas")
        .select("organization_id, numero, uf")
        .eq("ativo", true);
      if (error) throw error;
      // Escritório parado (suspenso, redigido, arquivado) não consulta o DJEN nem
      // recebe alarme: a régua do produto, não um filtro próprio.
      const paradas = new Set(await idsDeOrgsParadas(admin));
      const por = new Map<string, EscritorioMonitorado>();
      for (const l of (data ?? []) as Array<{ organization_id: string; numero: string; uf: string }>) {
        if (paradas.has(l.organization_id)) continue;
        const e: EscritorioMonitorado = por.get(l.organization_id) ?? { organizationId: l.organization_id, oabs: [] };
        e.oabs.push({ numero: l.numero, uf: l.uf });
        por.set(l.organization_id, e);
      }
      return [...por.values()];
    },

    async coletouBemNoDia(organizationId, dia) {
      const { de, ate } = limitesDoDia(dia);
      const { count, error } = await admin
        .from("djen_coletas")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("ok", true)
        .gte("iniciada_em", de)
        .lte("iniciada_em", ate);
      if (error) throw error;
      return (count ?? 0) > 0;
    },

    async abreRodada(organizationId, inicio) {
      const { data, error } = await admin
        .from("djen_coletas")
        .insert({ organization_id: organizationId, iniciada_em: inicio.toISOString(), ok: false })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },

    async fechaRodada(id, r, ok, fim) {
      const { error } = await admin
        .from("djen_coletas")
        .update({
          terminada_em: fim.toISOString(),
          ok,
          oabs_consultadas: r.oabsConsultadas,
          publicacoes_vistas: r.publicacoesVistas,
          gravadas: r.gravadas,
          falhas: r.falhas,
        })
        .eq("id", id)
        .eq("organization_id", r.organizationId);
      if (error) throw error;
    },

    async estadoDoAlarme(organizationId) {
      const ultima = await admin
        .from("djen_coletas")
        .select("iniciada_em, ok")
        .eq("organization_id", organizationId)
        .order("iniciada_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima.error) throw ultima.error;
      const sucesso = await admin
        .from("djen_coletas")
        .select("iniciada_em")
        .eq("organization_id", organizationId)
        .eq("ok", true)
        .order("iniciada_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sucesso.error) throw sucesso.error;
      const alarme = await admin
        .from("djen_coletas")
        .select("alarme_enviado_em")
        .eq("organization_id", organizationId)
        .not("alarme_enviado_em", "is", null)
        .order("alarme_enviado_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (alarme.error) throw alarme.error;
      return {
        ultimaTentativaEm: ultima.data ? new Date(ultima.data.iniciada_em) : null,
        ultimaFoiOk: ultima.data ? Boolean(ultima.data.ok) : null,
        ultimoSucessoEm: sucesso.data ? new Date(sucesso.data.iniciada_em) : null,
        alarmeEnviadoEm: alarme.data?.alarme_enviado_em ? new Date(alarme.data.alarme_enviado_em) : null,
      };
    },

    async avisa(organizationId, texto, quando) {
      const valores = { title: "Busca de publicações do DJEN sem coleta", body: texto, severity: "warn" };
      const aberto = await admin
        .from("agent_inbox_items")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("ref_kind", REF_DO_AVISO)
        .eq("ref_id", organizationId)
        .eq("status", "open")
        .maybeSingle();
      if (aberto.error) throw aberto.error;
      const { error } = aberto.data
        ? await admin
            .from("agent_inbox_items")
            .update(valores)
            .eq("id", aberto.data.id)
            .eq("organization_id", organizationId)
        : await admin.from("agent_inbox_items").insert({
            ...valores,
            organization_id: organizationId,
            kind: "other",
            ref_kind: REF_DO_AVISO,
            ref_id: organizationId,
            status: "open",
          });
      if (error && error.code !== "23505") throw error;

      // A marca vai na rodada mais recente: é ela que o alarme lê para a carência.
      const ultima = await admin
        .from("djen_coletas")
        .select("id")
        .eq("organization_id", organizationId)
        .order("iniciada_em", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima.error) throw ultima.error;
      if (ultima.data) {
        const marca = await admin
          .from("djen_coletas")
          .update({ alarme_enviado_em: quando.toISOString() })
          .eq("id", ultima.data.id)
          .eq("organization_id", organizationId);
        if (marca.error) throw marca.error;
      }
    },

    async resolveAviso(organizationId) {
      const { error } = await admin
        .from("agent_inbox_items")
        .update({ status: "resolved", resolved_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("ref_kind", REF_DO_AVISO)
        .eq("ref_id", organizationId)
        .eq("status", "open");
      if (error) throw error;
    },

    async upsertPublicacoes(organizationId, linhas) {
      if (linhas.length === 0) return { gravadas: 0 };
      const { data, error } = await admin
        .from("djen_publicacoes")
        .upsert(
          linhas.filter((l) => l.organization_id === organizationId),
          { onConflict: "organization_id,djen_id", ignoreDuplicates: true },
        )
        .select("id");
      if (error) return { gravadas: 0, erro: error.message };
      return { gravadas: data?.length ?? 0 };
    },
  };
}
