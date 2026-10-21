/**
 * O resumo da manhã no banco de verdade (service role, filtro de organização
 * explícito em toda leitura). A regra mora em `./resumo`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// Import com `@/`: o fiscal da régua de org parada só segue esse caminho.
import { clienteDaRotina } from "@/lib/djen/rotina-banco";
import { sendEmail } from "@/lib/email/roteador";

import {
  COLUNAS_DA_PUBLICACAO,
  daLinha,
  semRepetir,
  type LinhaDaPublicacao,
  type NegocioDoFunil,
  type PublicacaoDaCaixa,
} from "./caixa";
import { corteDoVencido } from "./pauta";
import type { PortaDoResumo } from "./resumo";

/** Mesmo teto da tela (`app/app/publicacoes/page.tsx`). */
const LIMITE = 300;

/** Quem recebe: membro ativo do escritório que trabalha nele. `viewer` não. */
const PAPEIS = ["agent", "manager", "admin"];

export function portaDoResumo(admin: SupabaseClient): PortaDoResumo {
  return {
    async escritorios() {
      // Já pula escritório parado (régua `idsDeOrgsParadas`).
      const monitorados = await clienteDaRotina(admin).escritoriosMonitorados();
      if (monitorados.length === 0) return [];
      const { data, error } = await admin
        .from("organizations")
        .select("id, display_name")
        .in("id", monitorados.map((m) => m.organizationId));
      if (error) throw error;
      return ((data ?? []) as Array<{ id: string; display_name: string }>).map((o) => ({
        organizationId: o.id,
        nome: o.display_name,
      }));
    },

    async leituraDaPauta(org) {
      const [pubs, confirmadas, negocios] = await Promise.all([
        admin
          .from("djen_publicacoes")
          .select(COLUNAS_DA_PUBLICACAO)
          .eq("organization_id", org)
          .order("data_disponibilizacao", { ascending: false })
          .limit(LIMITE),
        // Prazo confirmado não cai fora pelo teto das recentes (spec 0006.E5).
        admin
          .from("djen_publicacoes")
          .select(COLUNAS_DA_PUBLICACAO)
          .eq("organization_id", org)
          .gte("prazo_vence_em", corteDoVencido(new Date()))
          .order("prazo_vence_em")
          .limit(LIMITE),
        admin
          .from("crm_leads")
          .select("id, organization_id, title, custom_fields")
          .eq("organization_id", org)
          .eq("status", "open")
          .limit(LIMITE),
      ]);
      if (pubs.error) throw pubs.error;
      if (confirmadas.error) throw confirmadas.error;
      if (negocios.error) throw negocios.error;
      const publicacoes: PublicacaoDaCaixa[] = semRepetir(
        (pubs.data ?? []) as LinhaDaPublicacao[],
        (confirmadas.data ?? []) as LinhaDaPublicacao[],
      ).map(daLinha);
      return { publicacoes, negocios: (negocios.data ?? []) as NegocioDoFunil[] };
    },

    async destinatarios(org) {
      const [membros, donos] = await Promise.all([
        admin
          .from("user_organizations")
          .select("user_id")
          .eq("organization_id", org)
          .in("role", PAPEIS)
          .is("revoked_at", null)
          .not("accepted_at", "is", null),
        // O dono da instalação não é do escritório: a pauta tem dado de cliente.
        admin.from("platform_admins").select("user_id").is("revoked_at", null),
      ]);
      if (membros.error) throw membros.error;
      if (donos.error) throw donos.error;
      const fora = new Set(((donos.data ?? []) as Array<{ user_id: string }>).map((d) => d.user_id));
      const ids = ((membros.data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id).filter((id) => !fora.has(id));
      const emails = await Promise.all(
        ids.map(async (id) => (await admin.auth.admin.getUserById(id)).data.user?.email ?? null),
      );
      return [...new Set(emails.filter((e): e is string => typeof e === "string" && e.includes("@")))];
    },

    async enviar(m) {
      const r = await sendEmail({ ...m, tags: [{ name: "kind", value: "djen_resumo_da_manha" }] });
      return { ok: r.ok };
    },
  };
}
