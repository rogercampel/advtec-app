import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { perfilDoRecorte, type LinhaDoRecorte } from "@/lib/datajud/recorte";
import { textoDoPerfil } from "@/lib/datajud/trava";
import { createClient } from "@/lib/supabase/server";

import { LaudoDoJuizo, type RecorteNaTela } from "./_components/LaudoDoJuizo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Perfil do juízo" };

/** Teto da leitura do espelho por recorte: o DataJud manda páginas de 500; dez delas bastam. */
const LIMITE = 5000;

/**
 * PERFIL DO JUÍZO — issue #91 (spec 0007, AdvTec). Lê com a sessão (RLS recorta
 * a organização). O texto da tela é `textoDoPerfil`, que a trava da 0007.E6
 * aprova antes de devolver: aqui não se escreve frase com número à mão.
 *
 * Os "demais" vêm de TODO o espelho do escritório no mesmo tribunal e classe,
 * de qualquer recorte: um recorte de órgão só traz aquele órgão.
 */
export default async function JuizoPage({ searchParams }: { searchParams: Promise<{ recorte?: string }> }) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const org = activeOrg.orgId;
  const { recorte: pedido } = await searchParams;

  const supabase = await createClient();
  const { data: rs, error } = await supabase
    .from("datajud_recortes")
    .select("id, rotulo, tribunal, classe_codigo, assunto_codigo, orgao_julgador_codigo, ultima_coleta_em")
    .eq("organization_id", org)
    .eq("ativo", true)
    .order("rotulo");
  const recortes = (rs ?? []) as RecorteNaTela[];
  const escolhido = recortes.find((r) => r.id === pedido) ?? recortes[0] ?? null;

  let texto: string | null = null;
  let aviso: "sem_orgao" | "sem_coleta" | null = null;
  if (escolhido && escolhido.orgao_julgador_codigo === null) aviso = "sem_orgao";
  else if (escolhido && !escolhido.ultima_coleta_em) aviso = "sem_coleta";
  else if (escolhido) {
    let q = supabase
      .from("datajud_processos")
      .select("datajud_id, data_ajuizamento, data_ajuizamento_bruto, nivel_sigilo, orgao_julgador_codigo, orgao_julgador_nome, classe_codigo, classe_nome, movimentos")
      .eq("organization_id", org)
      .eq("tribunal", escolhido.tribunal)
      .limit(LIMITE);
    if (escolhido.classe_codigo !== null) q = q.eq("classe_codigo", escolhido.classe_codigo);
    const { data: ps } = await q;
    // O mesmo processo pode estar em dois recortes do escritório: conta uma vez.
    const unicos = new Map<string, LinhaDoRecorte>();
    let classeNome: string | null = null;
    for (const p of (ps ?? []) as Array<LinhaDoRecorte & { datajud_id: string; classe_nome: string | null }>) {
      unicos.set(p.datajud_id, p);
      classeNome ??= p.classe_nome;
    }
    texto = textoDoPerfil(
      perfilDoRecorte({
        filtro: {
          rotulo: escolhido.rotulo,
          tribunal: escolhido.tribunal,
          classe_codigo: escolhido.classe_codigo,
          classe_nome: classeNome,
          assunto_codigo: escolhido.assunto_codigo,
          orgao_julgador_codigo: escolhido.orgao_julgador_codigo!,
        },
        coletadoEm: escolhido.ultima_coleta_em!,
        linhas: [...unicos.values()],
        hoje: new Date(),
      }),
    );
  }

  return (
    <LaudoDoJuizo
      recortes={recortes}
      escolhido={escolhido?.id ?? null}
      texto={texto}
      aviso={aviso}
      erroDeLeitura={Boolean(error)}
    />
  );
}
