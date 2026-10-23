/**
 * `registrar_triagem` — a triagem jurídica do agente (spec 0001.E3).
 *
 * O modelo chama a ferramenta quando entende o assunto; ela grava no caso o que
 * for de grava e devolve O QUE O TURNO FAZ A SEGUIR. Quem manda no desvio é o
 * código, não o prompt: a ferramenta não aceita "ignore a urgência".
 *
 * ═══ PRECEDÊNCIA (a primeira que vale encerra) ═══
 *
 *   1. URGÊNCIA — prazo, audiência, pessoa presa, liminar, despejo, pensão
 *      atrasada. Lida do que o CLIENTE escreveu (últimas mensagens recebidas da
 *      conversa, lidas do banco), somada ao que o modelo marcar. O modelo só
 *      acrescenta: nunca desfaz o que o léxico achou. → passa ao advogado.
 *   2. CONFLITO — a parte contrária citada já é cliente? → passa ao advogado,
 *      sem coletar a história, e SEM contar ao cliente o motivo (a outra parte
 *      é cliente do escritório: sigilo).
 *   3. ÁREA — `atende` segue; `recusa` devolve o texto da recusa educada (sem
 *      história); o resto passa ao advogado decidir (falha fechado).
 *
 * Urgência antes da recusa de propósito: quem está preso e cai numa área que o
 * escritório não atende não recebe uma carta de recusa — o advogado vê e decide
 * a quem encaminhar.
 *
 * ═══ O QUE GRAVA ═══
 *
 * Em `crm_leads.custom_fields` do CASO ABERTO do contato, pela mesma função
 * atômica da API (`fn_lead_anotar_campos`: `custom_fields || $campos`, uma
 * instrução, sem apagar o resto), mais uma nota na timeline do caso. Só as
 * chaves abaixo; `resumo_do_caso` e `parte_contraria` NÃO são gravados quando a
 * decisão é recusar (não se guarda a história de quem foi recusado).
 * Contato sem caso aberto, ou com mais de um empatado, não recebe gravação — a
 * decisão sai igual, com `registro.gravado = false` e o motivo.
 *
 * Isolamento: toda consulta filtra `organization_id` da linha do job.
 */
import { z } from "zod";

import { buildLeadActivityRow } from "@/lib/leads/activity-emitter";
import { resolveActiveLeadForContact, type LeadCandidate } from "@/lib/leads/active-lead";
import { logger } from "@/lib/logger";

import {
  AREAS,
  areaDoRotulo,
  classificaArea,
  decideAreaDoCaso,
  textoDeRecusa,
  type AreaId,
  type DecisaoDeArea,
} from "./areas";
import type { Consultavel, QuemEstaNoTurno } from "./banco";
import { checaConflito, type ContatoEmConflito } from "./conflito";
import { configDaTriagem } from "./config";
import {
  detectaUrgenciasJuridicas,
  ROTULO_DA_URGENCIA,
  tipoDeUrgenciaDoTexto,
  type UrgenciaJuridica,
} from "./urgencia-juridica";

/** As chaves de `crm_leads.custom_fields`. Contrato: renomear esconde o que já foi gravado. */
export const CAMPOS_DA_TRIAGEM = {
  /** A ficha do caso (`lib/casos/ficha.ts`) já lê estas duas. */
  area: "area_do_direito",
  resumo: "resumo_do_caso",
  parteContraria: "parte_contraria",
  urgencia: "urgencia_juridica",
  /** Conflito: só `true` e IDS. O nome do outro cliente NUNCA entra em `custom_fields` (o modelo e as integrações leem). */
  conflitoPossivel: "conflito_possivel",
  conflitoContatos: "conflito_contatos",
  conflitoCasos: "conflito_casos",
  decisao: "triagem_decisao",
  motivo: "triagem_motivo",
  em: "triagem_em",
} as const;

/** Quantas mensagens do cliente a triagem relê para achar urgência e área. */
export const MENSAGENS_LIDAS = 30;

export const registrarTriagemSchema = z.object({
  area_do_direito: z.string().trim().min(1).max(120),
  resumo_do_caso: z.string().trim().max(4000).optional(),
  parte_contraria: z.string().trim().max(200).optional(),
  /** Marca do modelo. Só ACRESCENTA urgência, e só `true` ou um tipo do léxico ("prazo", "preso"…) conta; qualquer outro texto não. */
  urgencia: z.union([z.boolean(), z.string().trim().max(300)]).optional(),
});
export type EntradaDaTriagem = z.infer<typeof registrarTriagemSchema>;

export type Registro = {
  gravado: boolean;
  casoId: string | null;
  /** Por que não gravou. */
  motivo?: "sem_caso_aberto" | "varios_casos_abertos" | "falha_ao_gravar";
};

export type MotivoDaPassagem = "urgencia" | "conflito" | "area_a_decidir";

export type DecisaoDeTriagem =
  | {
      acao: "seguir";
      area: string;
      /** O que falta colher, na ordem em que deve ser pedido (nome da outra parte ANTES da história). */
      pendente: Array<"parte_contraria" | "resumo_do_caso">;
      instrucao: string;
      registro: Registro;
    }
  | { acao: "recusar"; area: string; texto: string; instrucao: string; registro: Registro }
  | {
      acao: "passar_ao_advogado";
      motivo: MotivoDaPassagem;
      area: string;
      urgencias: UrgenciaJuridica[];
      /** Só ids e contagens — o nome do outro cliente não sai desta função. */
      conflito: Array<Omit<ContatoEmConflito, "nome">>;
      instrucao: string;
      registro: Registro;
    };

// ── leitura ──

/** As últimas mensagens RECEBIDAS desta conversa, deste contato, da mais antiga para a mais nova. */
export async function mensagensDoCliente(db: Consultavel, quem: QuemEstaNoTurno): Promise<string[]> {
  const { rows } = await db.query<{ body: string }>(
    `select m.body
       from public.messages m
       join public.conversations c on c.id = m.conversation_id and c.organization_id = m.organization_id
      where m.organization_id = $1
        and m.conversation_id = $2
        and c.contact_id = $3
        and m.direction = 'inbound'
        and coalesce(m.type, 'text') not in ('reaction', 'system')
        and btrim(coalesce(m.body, '')) <> ''
      order by m.created_at desc
      limit ${MENSAGENS_LIDAS}`,
    [quem.organizationId, quem.conversationId, quem.contactId],
  );
  return rows.map((r) => r.body).reverse();
}

/** A marca do modelo conta se for `true` ou NOMEAR um tipo do léxico. "Não há urgência" e "sem urgência aparente" não contam. */
function urgenciaDoModelo(v: EntradaDaTriagem["urgencia"]): string | null {
  if (v === undefined || v === false) return null;
  if (v === true) return "marcada pelo agente";
  const tipo = tipoDeUrgenciaDoTexto(v);
  return tipo === null ? null : ROTULO_DA_URGENCIA[tipo];
}

type CasoAberto = { id: string; customFields: Record<string, unknown> };

async function casoAbertoDoContato(
  db: Consultavel,
  quem: QuemEstaNoTurno,
): Promise<{ caso: CasoAberto } | { caso: null; motivo: "sem_caso_aberto" | "varios_casos_abertos" }> {
  const { rows } = await db.query<LeadCandidate & { custom_fields: unknown }>(
    `select l.id, l.organization_id, l.pipeline_id, l.status, l.last_activity_at, l.created_at, l.custom_fields
       from public.crm_leads l
      where l.organization_id = $1 and l.contact_id = $2`,
    [quem.organizationId, quem.contactId],
  );
  const padrao = await db.query<{ id: string }>(
    `select id from public.crm_pipelines
      where organization_id = $1 and is_default = true and is_archived = false
      limit 1`,
    [quem.organizationId],
  );
  const alvo = resolveActiveLeadForContact(rows, { defaultPipelineId: padrao.rows[0]?.id ?? null });
  if (!alvo.routed) {
    return { caso: null, motivo: alvo.reason === "no_open_lead" ? "sem_caso_aberto" : "varios_casos_abertos" };
  }
  const linha = rows.find((r) => r.id === alvo.leadId);
  const cf = linha?.custom_fields;
  return {
    caso: {
      id: alvo.leadId,
      customFields: cf && typeof cf === "object" && !Array.isArray(cf) ? (cf as Record<string, unknown>) : {},
    },
  };
}

// ── escrita ──

async function gravaNoCaso(
  db: Consultavel,
  quem: QuemEstaNoTurno,
  casoId: string,
  campos: Record<string, unknown>,
): Promise<boolean> {
  try {
    const { rows } = await db.query<{ campos: unknown }>(
      "select public.fn_lead_anotar_campos($1::uuid, $2::uuid, $3::jsonb) as campos",
      [quem.organizationId, casoId, JSON.stringify(campos)],
    );
    // A função devolve nulo quando o caso não é desta organização: nada foi gravado.
    return rows[0]?.campos != null;
  } catch (erro) {
    logger.warn("triagem: não consegui gravar no caso", {
      organization_id: quem.organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
    return false;
  }
}

/** A nota na linha do tempo do caso. Sem nome, sem história: só o que foi decidido. */
async function anotaNaLinhaDoTempo(
  db: Consultavel,
  quem: QuemEstaNoTurno,
  casoId: string,
  decisao: { acao: string; motivo: string | null; area: string },
): Promise<void> {
  try {
    const row = buildLeadActivityRow({
      organizationId: quem.organizationId,
      leadId: casoId,
      contactId: quem.contactId,
      type: "note",
      sourceModule: "triagem_juridica",
      actor: { type: "webhook_source", id: "triagem_juridica" },
      reason: `Triagem jurídica: ${decisao.acao}${decisao.motivo ? ` (${decisao.motivo})` : ""}. Área: ${decisao.area}.`,
      payload: { acao: decisao.acao, motivo: decisao.motivo, area: decisao.area },
    });
    await db.query(
      `insert into public.crm_lead_activities
         (organization_id, lead_id, contact_id, type, source_module, source_id,
          actor_kind, actor_agent_id, performed_by_user_id, reason, evidence, payload)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        row.organization_id,
        row.lead_id,
        row.contact_id,
        row.type,
        row.source_module,
        row.source_id,
        row.actor_kind,
        row.actor_agent_id,
        row.performed_by_user_id,
        row.reason,
        null,
        JSON.stringify(row.payload),
      ],
    );
  } catch (erro) {
    // A timeline não derruba a triagem.
    logger.warn("triagem: a nota na linha do tempo falhou", {
      organization_id: quem.organizationId,
      detalhe: erro instanceof Error ? erro.message : String(erro),
    });
  }
}

// ── o executor ──

export async function executaRegistrarTriagem(
  db: Consultavel,
  quem: QuemEstaNoTurno,
  entrada: EntradaDaTriagem,
  opcoes: { agora?: () => Date } = {},
): Promise<DecisaoDeTriagem> {
  const config = await configDaTriagem(db, quem.organizationId);
  const mensagens = await mensagensDoCliente(db, quem);

  // 1. urgência: o que o cliente escreveu (uma urgência por tipo, a primeira ocorrência) + a marca do modelo
  const porTipo = new Map<string, UrgenciaJuridica>();
  for (const m of mensagens) for (const u of detectaUrgenciasJuridicas(m)) if (!porTipo.has(u.tipo)) porTipo.set(u.tipo, u);
  const urgencias = [...porTipo.values()];
  const marcaDoModelo = urgenciaDoModelo(entrada.urgencia);

  // 2. área
  const doModelo = areaDoRotulo(entrada.area_do_direito);
  const rotuloDaArea = doModelo ? AREAS[doModelo].rotulo : entrada.area_do_direito;
  const decisaoDeArea: DecisaoDeArea = decideAreaDoCaso({
    doModelo,
    classificacao: classificaArea(mensagens.join("\n")),
    config,
  });

  // 3. conflito (só se o modelo trouxe a parte contrária)
  const parte = entrada.parte_contraria?.trim() ?? "";
  const conflito =
    parte === ""
      ? null
      : await checaConflito(db, { organizationId: quem.organizationId, contatoDoTurno: quem.contactId, nomeDaParteContraria: parte });
  const contatosEmConflito = conflito?.resultado === "possivel_conflito" ? conflito.contatos : [];

  // ── a decisão, na ordem de precedência ──
  let acao: "seguir" | "recusar" | "passar_ao_advogado";
  let motivo: MotivoDaPassagem | null = null;
  if (urgencias.length > 0 || marcaDoModelo !== null) {
    acao = "passar_ao_advogado";
    motivo = "urgencia";
  } else if (contatosEmConflito.length > 0) {
    acao = "passar_ao_advogado";
    motivo = "conflito";
  } else if (decisaoDeArea.acao === "recusa") {
    acao = "recusar";
  } else if (decisaoDeArea.acao === "perguntar_ao_advogado") {
    acao = "passar_ao_advogado";
    motivo = "area_a_decidir";
  } else {
    acao = "seguir";
  }

  // ── o que gravar ──
  const agora = (opcoes.agora ?? (() => new Date()))();
  const campos: Record<string, unknown> = { [CAMPOS_DA_TRIAGEM.area]: rotuloDaArea };
  if (acao !== "recusar") {
    if (entrada.resumo_do_caso) campos[CAMPOS_DA_TRIAGEM.resumo] = entrada.resumo_do_caso;
    if (parte !== "") campos[CAMPOS_DA_TRIAGEM.parteContraria] = parte;
  }
  if (urgencias.length > 0 || marcaDoModelo !== null) {
    campos[CAMPOS_DA_TRIAGEM.urgencia] = [
      ...urgencias.map((u) => `${ROTULO_DA_URGENCIA[u.tipo]}: «${u.trecho}»`),
      ...(marcaDoModelo !== null ? [`marcada pelo agente: ${marcaDoModelo}`] : []),
    ].join(" | ");
  }
  if (contatosEmConflito.length > 0) {
    campos[CAMPOS_DA_TRIAGEM.conflitoPossivel] = true;
    campos[CAMPOS_DA_TRIAGEM.conflitoContatos] = contatosEmConflito.map((c) => c.contactId);
    campos[CAMPOS_DA_TRIAGEM.conflitoCasos] = contatosEmConflito.flatMap((c) => c.casoIds);
  }
  campos[CAMPOS_DA_TRIAGEM.decisao] = acao;
  campos[CAMPOS_DA_TRIAGEM.motivo] = motivo ?? (acao === "recusar" ? "area_recusada" : null);
  campos[CAMPOS_DA_TRIAGEM.em] = agora.toISOString();

  let registro: Registro;
  const achado = await casoAbertoDoContato(db, quem);
  if (achado.caso === null) {
    registro = { gravado: false, casoId: null, motivo: achado.motivo };
  } else {
    const anterior = `${achado.caso.customFields[CAMPOS_DA_TRIAGEM.decisao] ?? ""}|${achado.caso.customFields[CAMPOS_DA_TRIAGEM.motivo] ?? ""}`;
    const gravou = await gravaNoCaso(db, quem, achado.caso.id, campos);
    registro = gravou
      ? { gravado: true, casoId: achado.caso.id }
      : { gravado: false, casoId: achado.caso.id, motivo: "falha_ao_gravar" };
    // Uma nota por mudança de decisão, não uma por chamada do modelo.
    const nova = `${campos[CAMPOS_DA_TRIAGEM.decisao]}|${campos[CAMPOS_DA_TRIAGEM.motivo] ?? ""}`;
    if (gravou && nova !== anterior) {
      await anotaNaLinhaDoTempo(db, quem, achado.caso.id, {
        acao,
        motivo: (campos[CAMPOS_DA_TRIAGEM.motivo] as string | null) ?? null,
        area: rotuloDaArea,
      });
    }
  }

  // ── o que devolver ao turno ──
  if (acao === "recusar") {
    const areas: AreaId[] = decisaoDeArea.acao === "recusa" ? decisaoDeArea.areas : [];
    return {
      acao,
      area: rotuloDaArea,
      texto: textoDeRecusa(areas),
      instrucao:
        "Envie o `texto` exatamente como veio e encerre. Não peça nem aceite detalhes do caso, não opine sobre o assunto " +
        "e não prometa nada. Se o cliente insistir em contar a história, diga que não será possível acompanhar e que ele procure outro profissional.",
      registro,
    };
  }
  if (acao === "passar_ao_advogado") {
    const instrucoes: Record<MotivoDaPassagem, string> = {
      urgencia:
        "URGÊNCIA: não continue a triagem. Diga ao cliente, em uma frase, que está avisando o advogado agora — sem opinar sobre " +
        "o caso, sobre prazos ou sobre o que ele deve fazer. Em seguida chame request_human_handoff.",
      conflito:
        "Pare AQUI: não colete a história. NÃO diga ao cliente que há conflito nem que a outra parte é cliente do escritório " +
        "(é sigilo). Diga só que o advogado vai analisar o caso e dará retorno. Em seguida chame request_human_handoff.",
      area_a_decidir:
        "Não recuse e não colete a história. Diga ao cliente que o advogado vai avaliar se o escritório atua nesse assunto e dará retorno. " +
        "Em seguida chame request_human_handoff.",
    };
    return {
      acao,
      motivo: motivo!,
      area: rotuloDaArea,
      urgencias,
      conflito: contatosEmConflito.map(({ nome: _nome, ...semNome }) => semNome),
      instrucao: instrucoes[motivo!],
      registro,
    };
  }
  const pendente: Array<"parte_contraria" | "resumo_do_caso"> = [
    ...(parte === "" ? (["parte_contraria"] as const) : []),
    ...(entrada.resumo_do_caso ? [] : (["resumo_do_caso"] as const)),
  ];
  return {
    acao,
    area: rotuloDaArea,
    pendente,
    instrucao:
      pendente.length === 0
        ? "Triagem completa. Avise que o advogado vai analisar o caso e siga para o agendamento da consulta. Não opine sobre o mérito."
        : "Siga a triagem sem opinar sobre o caso. " +
          (pendente.includes("parte_contraria")
            ? "ANTES de pedir a história, pergunte o nome da outra parte (pessoa ou empresa) e chame registrar_triagem de novo com `parte_contraria`. "
            : "") +
          (pendente.includes("resumo_do_caso")
            ? "Depois peça um resumo curto do que aconteceu e chame registrar_triagem com `resumo_do_caso` em texto limpo."
            : ""),
    registro,
  };
}

/**
 * Grava no caso aberto do contato a urgência que o turno detectou ANTES do modelo (o modelo não roda, então
 * `registrar_triagem` não chega a ser chamada). Mescla só `urgencia_juridica` e `triagem_em`, pelo mesmo
 * merge atômico, e NÃO toca `triagem_decisao`: a decisão da triagem continua sendo a que a ferramenta tomou
 * (ou nenhuma). Urgência já gravada é mantida, e as novas entram depois dela sem repetir.
 */
export async function registraUrgenciaNoCaso(
  db: Consultavel,
  quem: QuemEstaNoTurno,
  urgencias: readonly UrgenciaJuridica[],
  opcoes: { agora?: () => Date } = {},
): Promise<Registro> {
  if (urgencias.length === 0) return { gravado: false, casoId: null };
  const achado = await casoAbertoDoContato(db, quem);
  if (achado.caso === null) return { gravado: false, casoId: null, motivo: achado.motivo };
  const antes = achado.caso.customFields[CAMPOS_DA_TRIAGEM.urgencia];
  const ja = typeof antes === "string" && antes.trim() !== "" ? antes.split(" | ") : [];
  const novas = urgencias.map((u) => `${ROTULO_DA_URGENCIA[u.tipo]}: «${u.trecho}»`).filter((t) => !ja.includes(t));
  const agora = (opcoes.agora ?? (() => new Date()))();
  const gravou = await gravaNoCaso(db, quem, achado.caso.id, {
    [CAMPOS_DA_TRIAGEM.urgencia]: [...ja, ...novas].join(" | "),
    [CAMPOS_DA_TRIAGEM.em]: agora.toISOString(),
  });
  return gravou ? { gravado: true, casoId: achado.caso.id } : { gravado: false, casoId: achado.caso.id, motivo: "falha_ao_gravar" };
}
