/**
 * A IDENTIFICAÇÃO NO AVISO DE ESCALAÇÃO DAS TRAVAS DA OAB.
 *
 * O aviso ("esse assunto precisa ser respondido por um advogado…") é texto do sistema e não
 * passa pelo gate `travas_oab`. Mas pode ser o PRIMEIRO envio ao cliente: o modelo foi barrado
 * antes de falar. Sem template de disclosure configurado (que o `disclosureGate` injetaria), o
 * cliente leria a primeira mensagem da conversa sem saber que fala com um atendimento
 * automatizado — a exigência que o gate de saída cobra do modelo e o sistema não cumpriria por
 * conta própria. Nesse caso (e só nele) o aviso abre com a frase de identificação.
 */
import { loadDisclosureTemplate, countPriorAcceptedSends } from "@/lib/agent-engine/guardrails/disclosure/template";
import type { Queryable } from "@/lib/agent-engine/queue/queue";

import { FRASE_DE_IDENTIFICACAO, FRASE_DE_IDENTIFICACAO_ES } from "./gate-das-travas";

export async function comIdentificacaoSeForOPrimeiro(
  db: Queryable,
  ids: { tenantId: string; leadId: string },
  corpo: string,
  idioma: string | null,
): Promise<string> {
  // Com template de disclosure, quem apresenta é o `disclosureGate` (inject) na cadeia do aviso.
  if ((await loadDisclosureTemplate(db, ids.tenantId)) !== null) return corpo;
  if ((await countPriorAcceptedSends(db, ids.tenantId, ids.leadId)) > 0) return corpo;
  const frase = (idioma ?? "").trim().toLowerCase().startsWith("es") ? FRASE_DE_IDENTIFICACAO_ES : FRASE_DE_IDENTIFICACAO;
  return `${frase}\n\n${corpo}`;
}
