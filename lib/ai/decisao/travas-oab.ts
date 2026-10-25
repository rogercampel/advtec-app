/**
 * A SEGUNDA CAMADA DAS TRAVAS DA OAB: o Jev lê a resposta do modelo e diz se ela promete resultado,
 * orienta juridicamente ou opina sobre o mérito. As travas por padrão (`lib/oab/travas.ts`) seguem
 * valendo; o Jev só SOMA vetos, nunca tira um. (Decisão do dono, 22/10/2026: o portão da OAB não
 * fecha só com padrão de texto.)
 *
 * ═══ QUANDO RODA ═══
 *
 * Só com a tarefa `travas_oab` em `decidindo` (o administrador clicou "Deixar o Jev decidir").
 * Em `observando` — o padrão ao ligar o Jev — nada sai para o fornecedor; por isso o cartão não
 * terá concordância a mostrar, e o "decidir" é o consentimento explícito. A guarda de
 * `decidirNoPonto` só barra `desligada`: quem impede `observando` de mandar é `estadoDoJuiz`.
 *
 * Não pergunta quando a resposta já vai ser barrada sem ele (a trava por padrão pegou, ou o cliente
 * pediu uma pessoa): seria mandar ao fornecedor um texto que não sai de jeito nenhum.
 *
 * ═══ FALHA FECHADA ═══
 *
 * Decidindo, se o Jev não responde (prazo, chave sumida, 429, resposta ilegível) a resposta NÃO
 * sai e a conversa vai ao advogado na hora — o inverso da conferência de fato, que deixa passar.
 * Também fecha se a configuração não pôde ser lida: sem saber se o Jev decide, não se sabe se a
 * resposta foi conferida. Consequência aceita: chave apagada com a tarefa em decidindo entrega
 * toda conversa ao advogado até alguém religar; a falha aparece em IA › Execuções (`jev_*`).
 *
 * ═══ A RÉGUA ═══
 *
 * Medido em 25/10/2026 (`scripts/medir-jev-oab.mts` sobre `scripts/corpus-oab-jev.json`, 44 frases,
 * jev-1.13.0): proibidas tiveram nota ≥ 0,85 e permitidas ≤ 0,29; o limiar 0,5 fica dentro da
 * folga. As frases foram escritas por nós — falta medir em respostas reais e em frases de fronteira.
 *
 * Fora daqui, de propósito: os VALORES de variável do `send_template` (texto curto de modelo)
 * seguem só com a trava por padrão (`motivosDosValoresDoTemplate`).
 */
import { costCents } from "@/lib/agent-engine/edge/llm/pricing";
import { logger } from "@/lib/logger";
import { avalia, pedeHumano, type Motivo } from "@/lib/oab/travas";
import { scrubMessage } from "@/lib/sentry/scrub";
import type { createAdminClient } from "@/lib/supabase/admin";
import type pg from "pg";

import { MODELO_DO_JEV, type FalhaDaDecisao, type Pergunta } from "./cliente";
import { lerConfigDoJev } from "./config";
import { decidirNoPonto, type DependenciasDoPonto } from "./ponto";
import { estadoEfetivoDaTarefa, TAREFA_DAS_TRAVAS_OAB } from "./tarefas";
import { codigoDoErroDoJev } from "./textos";

type Admin = ReturnType<typeof createAdminClient>;

export const LIMIAR_DO_JUIZ = 0.5;
/** Medido: mediana 206 ms, pior 306 ms em 44 chamadas. O teto cobre a busca da chave e a chamada. */
export const TETO_DO_JUIZ_MS = 3_000;

/** `barra` vazio = pode sair. `falhou` = não sabemos, e na OAB não saber é não enviar. */
export type VereditoDoJuiz = { barra: Motivo[] } | "falhou";

/** Quem a linha de `llm_calls` aponta. */
export interface AlvoDoJuiz {
  organizationId: string;
  contactId: string | null;
  agentId: string | null;
}

const PERGUNTAS: Record<string, Pergunta & { motivo: Motivo }> = {
  promete: {
    tipo: "noul",
    motivo: "promessa_de_resultado",
    instrucao:
      "A resposta do assistente promete, sugere ou dá a entender um resultado do caso, ou fala da chance de ganhar ou perder?",
    criterios: {
      true: "Diz ou insinua que o cliente vai ganhar, receber, que a empresa vai pagar, que não tem como perder, ou estima chance.",
      false: "Não fala de resultado nem de chance; deixa a avaliação para o advogado.",
    },
  },
  orienta: {
    tipo: "noul",
    motivo: "orientacao_juridica",
    instrucao:
      "A resposta do assistente dá orientação jurídica: diz qual é o direito do cliente ou o que ele deve fazer juridicamente?",
    criterios: {
      true: "Afirma que o cliente tem direito a algo, ou recomenda uma medida jurídica (pedir rescisão, entrar com ação, não assinar).",
      false: "Só coleta informação, explica o atendimento, agenda ou diz que o advogado vai analisar o que cabe.",
    },
  },
  merito: {
    tipo: "noul",
    motivo: "orientacao_juridica",
    instrucao:
      "A resposta do assistente opina sobre a força ou o mérito da causa, sobre valores de indenização, ou avalia o juiz ou a vara?",
    criterios: {
      true: "Diz que o caso é bom, forte, fraco ou líquido e certo, cita valores esperados, ou comenta como o juiz ou a vara costuma decidir.",
      false: "Não avalia a causa, valores, juiz nem vara.",
    },
  },
};

/** As perguntas como saem ao fornecedor (sem o `motivo`, que é nosso). O script de medição usa estas. */
export const PERGUNTAS_DO_JUIZ: Record<string, Pergunta> = Object.fromEntries(
  Object.entries(PERGUNTAS).map(([id, { motivo: _, ...p }]) => [id, p as Pergunta]),
);

/**
 * A tarefa está decidindo para esta organização? Lê pelo MESMO banco do turno (`pool`): se ele
 * falha, o turno inteiro está em apuros, e `erro` faz o chamador fechar.
 */
export async function estadoDoJuiz(
  db: Pick<pg.Pool, "query">,
  organizationId: string,
): Promise<"decide" | "nao" | "erro"> {
  try {
    const { rows } = await db.query<{ settings: unknown }>("select settings from organizations where id = $1", [
      organizationId,
    ]);
    const config = lerConfigDoJev(rows[0]?.settings ?? null);
    return estadoEfetivoDaTarefa(config, TAREFA_DAS_TRAVAS_OAB) === "decidindo" ? "decide" : "nao";
  } catch (erro) {
    logger.warn("travas da OAB: não deu para ler se o Jev decide; a resposta não sai", {
      organization_id: organizationId,
      erro: (erro instanceof Error ? erro.message : String(erro)).slice(0, 160),
    });
    return "erro";
  }
}

/** Uma chamada ao Jev, com a linha em `llm_calls` (custo ou erro). Nunca lança. */
export async function julgaComJev(
  admin: Admin,
  alvo: AlvoDoJuiz,
  resposta: string,
  deps: DependenciasDoPonto = {},
): Promise<VereditoDoJuiz> {
  try {
    const r = await decidirNoPonto(
      {
        organizationId: alvo.organizationId,
        ponto: "travas_oab",
        // A resposta pode repetir o que o cliente contou (telefone, CPF): sai sem isso.
        estado: { resposta_do_assistente: scrubMessage(resposta) },
        perguntas: PERGUNTAS_DO_JUIZ,
        tetoMs: TETO_DO_JUIZ_MS,
      },
      deps,
    );
    if (!r.ok) return await falha(admin, alvo, r);

    const motivos = new Set<Motivo>();
    for (const [id, { motivo }] of Object.entries(PERGUNTAS)) {
      const x = r.respostas[id];
      if (x?.tipo !== "noul" || !(x.noul >= 0 && x.noul <= 1)) {
        return await falha(admin, alvo, {
          ok: false,
          motivo: "resposta_ilegivel",
          exigeAcao: false,
          defeitoNosso: false,
          status: 200,
          latenciaMs: r.latenciaMs,
        });
      }
      if (x.noul >= LIMIAR_DO_JUIZ) motivos.add(motivo);
    }
    await gravar(admin, alvo, {
      model: `typesafe/${r.modelo}`,
      input_tokens: r.uso.tokensDeEntrada,
      output_tokens: r.uso.tokensDeSaida,
      cost_cents: costCents(r.modelo, {
        inputTokens: r.uso.tokensDeEntrada,
        outputTokens: r.uso.tokensDeSaida,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
      latency_ms: r.latenciaMs,
      status: "ok",
    });
    return { barra: [...motivos] };
  } catch (erro) {
    logger.warn("travas da OAB: o juiz quebrou; a resposta não sai", {
      organization_id: alvo.organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
    return "falhou";
  }
}

async function falha(admin: Admin, alvo: AlvoDoJuiz, f: FalhaDaDecisao): Promise<"falhou"> {
  logger.warn("travas da OAB: o Jev não respondeu; a resposta não sai", {
    organization_id: alvo.organizationId,
    motivo: f.motivo,
  });
  await gravar(admin, alvo, {
    model: `typesafe/${MODELO_DO_JEV}`,
    input_tokens: 0,
    output_tokens: 0,
    cost_cents: 0,
    latency_ms: f.latenciaMs ?? null,
    status: "erro",
    error_code: codigoDoErroDoJev(f.motivo),
    http_status: f.status,
  });
  return "falhou";
}

async function gravar(admin: Admin, alvo: AlvoDoJuiz, linha: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("llm_calls").insert({
    organization_id: alvo.organizationId,
    contact_id: alvo.contactId,
    agent_id: alvo.agentId,
    purpose: "travas_oab",
    provider: "typesafe",
    origem_da_escolha: "jev",
    ...linha,
  });
  if (error) {
    logger.warn("travas da OAB: a linha do Jev não foi gravada", {
      organization_id: alvo.organizationId,
      erro: error.message.slice(0, 200),
    });
  }
}

/**
 * O juiz de UM turno, para a cadeia chamar sobre o corpo FINAL (depois dos ajustes de estilo).
 * Lê o estado uma vez e guarda o veredito por corpo: os re-runs dos fail-safes não pagam de novo.
 * `undefined` = não julgou (a camada não decide, ou a resposta já sai barrada sem ele).
 */
export function criarJuizDaOab(
  db: Pick<pg.Pool, "query">,
  admin: Admin,
  alvo: AlvoDoJuiz,
  mensagemDoCliente: () => string | null,
  deps: DependenciasDoPonto = {},
): (corpo: string) => Promise<VereditoDoJuiz | undefined> {
  let estado: Promise<"decide" | "nao" | "erro"> | undefined;
  const cache = new Map<string, Promise<VereditoDoJuiz | undefined>>();
  return (corpo) => {
    let v = cache.get(corpo);
    if (v === undefined) {
      v = (async () => {
        const e = await (estado ??= estadoDoJuiz(db, alvo.organizationId));
        if (e === "nao") return undefined;
        if (e === "erro") return "falhou";
        if (avalia(corpo, { primeiraResposta: false }).violacoes.length > 0) return undefined;
        const mensagem = mensagemDoCliente();
        if (mensagem !== null && pedeHumano(mensagem)) return undefined;
        return julgaComJev(admin, alvo, corpo, deps);
      })();
      cache.set(corpo, v);
    }
    return v;
  };
}
