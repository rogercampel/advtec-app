import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";

import { MinutaParaConferencia } from "./_components/MinutaParaConferencia";
import { PesquisaNoAcervo } from "./_components/PesquisaNoAcervo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pesquisa no acervo" };

/**
 * PESQUISA NO ACERVO — issue #90 (specs 0004 e 0002.E4, AdvTec). A pesquisa
 * roda em `POST /api/v1/acervo/pesquisa`, com a sessão do usuário; aqui só a
 * porta. Pesquisar gasta um embedding, então é `agent` em diante, como a busca
 * do acervo da base — e a rota cobra de novo.
 */
export default async function AcervoPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const podePesquisar = (user.is_platform_admin && !user.support) || ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent;
  return (
    <>
      <PesquisaNoAcervo podePesquisar={podePesquisar} />
      {/* 0005.E2 (#37): a minuta para o advogado conferir. A rota cobra o papel de novo. */}
      <MinutaParaConferencia podeEscrever={podePesquisar} />
    </>
  );
}
