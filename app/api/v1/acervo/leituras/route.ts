/**
 * POST /api/v1/acervo/leituras — a leitura de um processo (spec 0003.E6, #41).
 *
 * Dois passos, de propósito (critério 7: "avisa o custo ANTES de processar"):
 *   1. sem `confirmar`: lê o PDF, recusa escaneado (critério 5) e devolve a
 *      estimativa — páginas, minutos, custo pela chave de API. Nada é gravado,
 *      nenhum modelo é chamado.
 *   2. com `confirmar=1`: grava a leitura como `lendo` e devolve o id na hora; a
 *      leitura roda depois da resposta (`after`) e termina `pronta` ou `falhou`.
 *      O PDF não é guardado: só o documento, que já traz os trechos citados.
 *
 * A organização vem de `requireRole`, nunca do corpo; a escrita é por service
 * role (a tabela não dá escrita ao papel autenticado, migration 9007). Cada
 * leitura gasta modelo — é efeito, por isso o modo de acompanhamento só leitura
 * (`requireSupportWrite`) não lê.
 */
import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";

import { estimaCusto, executaLeitura } from "@/lib/acervo/leitura-de-processo";
import { chamadaPelaAssinatura, motivoDaFalha } from "@/lib/acervo/leitura-por-modelo";
import { lePaginasDoPdf, MOTIVO_SEM_TEXTO } from "@/lib/acervo/paginas-do-pdf";
import { PdfExtractError } from "@/lib/ai/rag/extractors/pdf";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const TAMANHO_MAXIMO = 40 * 1024 * 1024; // 40 MB: um processo de 400 páginas digitais cabe com folga
/** Leitura é cara em tempo: poucas por pessoa por hora. */
const TETO_POR_USUARIO = 6;
const JANELA_SEGUNDOS = 3600;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const support = await requireSupportWrite();
  if (support) return support;

  const authz = await requireRole("agent", { requestId, resource: "ai_knowledge" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("invalid_request", t("Falha ao processar o envio do arquivo."), 400, { requestId });
  }
  const arquivo = form.get("arquivo");
  if (!(arquivo instanceof File)) return fail("invalid_request", t("Nenhum arquivo foi enviado."), 400, { requestId });
  if (arquivo.size > TAMANHO_MAXIMO) {
    return fail("validation_failed", t("O PDF passa de 40 MB. Envie o processo em partes."), 422, { requestId });
  }
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return fail("validation_failed", t("O arquivo não é um PDF."), 422, { requestId });
  }

  let paginas: Awaited<ReturnType<typeof lePaginasDoPdf>>;
  try {
    paginas = await lePaginasDoPdf(bytes);
  } catch (e) {
    // Critério 5: escaneado é recusa explícita, com o motivo — nunca documento vazio.
    // O leitor LANÇA nesse caso (`motivo: "sem_texto"`), não devolve zero páginas.
    if (e instanceof PdfExtractError && e.motivo === "sem_texto") return fail("validation_failed", t(MOTIVO_SEM_TEXTO), 422, { requestId });
    logger.warn("[acervo-leitura] o PDF não abriu", { requestId, motivo: motivoDaFalha(e), causa: motivoDaFalha((e as { cause?: unknown })?.cause) });
    return fail("validation_failed", t("Não foi possível abrir este PDF. Ele pode estar protegido por senha ou corrompido."), 422, { requestId });
  }

  const estimativa = await estimaCusto(paginas.paginas);
  if (form.get("confirmar") !== "1") {
    return ok({ estimativa: { ...estimativa, paginasSemTexto: paginas.paginasSemTexto } }, { requestId });
  }

  const limite = await checkRateLimit(`acervo-leitura:${authz.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", t("Muitas leituras seguidas. Tente de novo em uma hora."), 429, { requestId });
  }

  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const { data: linha, error } = await admin
    .from("acervo_leituras")
    .insert({
      organization_id: orgId,
      criada_por: authz.user.id,
      nome_do_arquivo: (arquivo.name || "processo.pdf").slice(0, 255),
      total_de_paginas: paginas.totalDePaginas,
    })
    .select("id")
    .single();
  if (error || !linha) return fail("internal_error", t("Não foi possível começar a leitura."), 500, { requestId });

  // Folhas escaneadas no meio dos autos entram como páginas vazias: a leitura as
  // marca como não lidas no documento.
  const comVazias = [...paginas.paginas, ...paginas.paginasSemTexto.map((numero) => ({ numero, texto: "" }))];
  after(async () => {
    try {
      const documento = await executaLeitura(comVazias, chamadaPelaAssinatura(getRequestPool(), orgId));
      await admin.from("acervo_leituras").update({ estado: "pronta", documento, updated_at: new Date().toISOString() }).eq("id", linha.id).eq("organization_id", orgId);
    } catch (e) {
      logger.error("[acervo-leitura] a leitura falhou", { requestId, leitura_id: linha.id, motivo: motivoDaFalha(e) });
      await admin
        .from("acervo_leituras")
        .update({ estado: "falhou", motivo_da_falha: motivoDaFalha(e).slice(0, 300), updated_at: new Date().toISOString() })
        .eq("id", linha.id)
        .eq("organization_id", orgId);
    }
  });

  return ok({ id: linha.id, estimativa }, { requestId });
}
