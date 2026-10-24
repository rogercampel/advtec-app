/**
 * PAINEL DE MEDIÇÃO — spec 0001, etapa E5, critério 12: "o painel mostra os cinco
 * números do funil". É a razão de existir do v1, e a implantação real é medida por
 * 30 dias com ele:
 *
 *   primeiros contatos fora do horário → triados → agendados → compareceram → viraram cliente
 *
 * Esta função é PURA: recebe as leituras já feitas (com a sessão, recortadas pela RLS e
 * pela organização ativa) e devolve os números. Quem lê o banco é a página
 * (`lib/painel/leitura.ts` cuida de erro, paginação e teto).
 *
 * ## Regra de ouro: onde o dado não existe, o número é "não medido" — nunca um palpite
 *
 * `Medida` é `{ medido: true, valor }` ou `{ medido: false, motivo }`. Zero é um valor
 * (medimos e deu zero); "não medido" é outra coisa (não há como saber). Isso inclui:
 * leitura com erro, leitura que bateu no teto de linhas, horário não configurado.
 *
 * ## As definições (a tela repete cada uma ao lado do número)
 *
 *   1. PRIMEIROS CONTATOS FORA DO HORÁRIO — conversas NOVAS no período (a conversa nasceu no
 *      período e a primeira mensagem do cliente de TODA a história dela também), fora de grupo,
 *      cuja primeira mensagem chegou fora do horário comercial. Na versão 1 valia a primeira
 *      mensagem DO PERÍODO: como o canal tem uma conversa por contato e número para sempre,
 *      um cliente antigo que escreve toda semana contava como atendimento novo. O horário é o que
 *      a tela do agente grava em `ai_agent_versions.trigger_config.filters.business_hours`
 *      (o PUBLICADO HOJE, aplicado ao período inteiro), com a mesma régua do motor
 *      (`msAteAJanelaAbrir`). Limite: contato antigo que ganha conversa em um número novo conta.
 *   2. TRIADOS — casos (`crm_leads`) que a triagem registrou NO período (`custom_fields.triagem_em`)
 *      com `custom_fields.area_do_direito` preenchida: as chaves que `registrar_triagem` grava
 *      (`lib/triagem/registrar-triagem.ts`). A triagem pode gravar de novo no mesmo caso; vale a
 *      última data. Desdobramento por `triagem_decisao`: seguiu / recusou / passou ao advogado.
 *      As etapas 3 a 5 partem só dos triados que NÃO foram recusados ("elegíveis"), e cada caso
 *      conta UMA vez.
 *   3. AGENDADOS — dos elegíveis, os que têm consulta na agenda VINCULADA AO CASO
 *      (`crm_lead_links`, `target_kind = 'appointment'`: o vínculo que a agenda grava ao marcar)
 *      e não cancelada. Limites: o painel não filtra por categoria do compromisso (consulta,
 *      reunião, call…), e compromisso marcado sem caso aberto não tem vínculo e fica de fora.
 *   4. COMPARECERAM — entre os agendados com consulta já passada, os que têm consulta `completed`.
 *      Só é medido quando TODA consulta já passada tem desfecho (`completed` ou `no_show`);
 *      faltando algum, "não medido" e quantos faltam. Consultas ainda por acontecer saem do
 *      denominador e aparecem como "ainda por acontecer".
 *   5. VIRARAM CLIENTE — entre os que compareceram, os com `crm_leads.status = 'won'`. Ganhos que
 *      não passaram por consulta realizada aparecem à parte (`ganhos`).
 *
 * Como cada etapa parte da anterior, são subconjuntos por construção. A etapa 1 conta CONVERSAS e a
 * 2 conta CASOS — unidades diferentes —, então não há taxa entre elas.
 *
 * ## Datas no fuso da organização
 *
 * "Últimos N dias" são N dias do CALENDÁRIO do escritório (hoje incluído), a partir da meia-noite
 * local, não 24h×N em UTC. Mensagem das 22h30 em Brasília é 01h30 UTC do dia seguinte;
 * contá-la no dia errado é o defeito que `diaNoForo` (`lib/djen/coletar.ts`) existe para evitar.
 * Aqui o fuso vem de `organizations.timezone`.
 */
import { lerJanelaDeAtendimento, msAteAJanelaAbrir, type JanelaDeAtendimento } from "@/lib/agent-engine/agent/janela-de-atendimento";
import { CAMPO_DA_AREA } from "@/lib/casos/ficha";

import { piorEstado, type EstadoDaLeitura, type Leitura } from "./leitura";

export const DIAS_DO_PAINEL = [7, 30, 90] as const;
export const DIAS_PADRAO = 30;
export const FUSO_PADRAO = "America/Sao_Paulo";

/** As chaves de `crm_leads.custom_fields` que `registrar_triagem` grava (lib/triagem/registrar-triagem.ts). */
export const CAMPO_DA_DATA_DA_TRIAGEM = "triagem_em";
export const CAMPO_DA_DECISAO_DA_TRIAGEM = "triagem_decisao";

/** `?dias=` da URL: só 7, 30 ou 90; qualquer outra coisa cai no padrão (30). */
export function lerDias(valor: unknown): number {
  const n = typeof valor === "string" ? Number(valor) : NaN;
  return (DIAS_DO_PAINEL as readonly number[]).includes(n) ? n : DIAS_PADRAO;
}

/** Fuso que o ambiente não conhece (ou vazio) vira o do foro, em vez de derrubar a tela. */
export function fusoOuPadrao(fuso: string | null | undefined): string {
  if (!fuso || fuso.trim() === "") return FUSO_PADRAO;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/** `YYYY-MM-DD` de um instante NO FUSO dado. `en-CA` formata assim. */
export function diaNoFuso(quando: Date, fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(quando);
}

function relogioComoUtc(quando: Date, fuso: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(quando);
  const v = (t: Intl.DateTimeFormatPartTypes) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
}

/** O instante (UTC) em que o dia `YYYY-MM-DD` COMEÇA no fuso dado — a meia-noite local. */
export function inicioDoDia(dia: string, fuso: string): Date {
  const [y, m, d] = dia.split("-").map(Number) as [number, number, number];
  const alvo = Date.UTC(y, m - 1, d);
  // Duas passadas: a segunda corrige o deslocamento quando o primeiro palpite cai do outro lado de uma virada de horário.
  const palpite = alvo - (relogioComoUtc(new Date(alvo), fuso) - alvo);
  return new Date(alvo - (relogioComoUtc(new Date(palpite), fuso) - palpite));
}

export type PeriodoDoFunil = { dias: number; de: string; ate: string; inicio: Date; fim: Date; fuso: string };

/** Os últimos `dias` dias do calendário do escritório, hoje incluído, até `agora`. */
export function periodoDoFunil(dias: number, agora: Date, fusoBruto?: string | null): PeriodoDoFunil {
  const fuso = fusoOuPadrao(fusoBruto);
  const ate = diaNoFuso(agora, fuso);
  const [y, m, d] = ate.split("-").map(Number) as [number, number, number];
  const de = new Date(Date.UTC(y, m - 1, d - (dias - 1))).toISOString().slice(0, 10);
  return { dias, de, ate, inicio: inicioDoDia(de, fuso), fim: agora, fuso };
}

// ── escolha do horário comercial ────────────────────────────────────────────────────────────

export type VersaoPublicada = { agente: string; criadoEm: string; trigger_config: unknown };
export type HorarioEscolhido = {
  janela: JanelaDeAtendimento | null;
  agente: string | null;
  divergentes: boolean;
  /** Agente cujo horário atravessa a meia-noite (22:00–02:00): o motor não suporta e o descarta. */
  atravessaMeiaNoite: string | null;
};

const chaveDaJanela = (j: JanelaDeAtendimento) => JSON.stringify([j.timezone, j.start, j.end, [...j.weekdays].sort()]);

const HORA = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;
function atravessaAMeiaNoite(triggerConfig: unknown): boolean {
  const filters = (triggerConfig as { filters?: unknown } | null | undefined)?.filters;
  const bh = (filters as { business_hours?: unknown } | null | undefined)?.business_hours as
    | { start?: unknown; end?: unknown }
    | null
    | undefined;
  if (!bh || typeof bh.start !== "string" || typeof bh.end !== "string") return false;
  const a = HORA.exec(bh.start);
  const b = HORA.exec(bh.end);
  if (!a || !b) return false;
  return Number(b[1]) * 60 + Number(b[2]) < Number(a[1]) * 60 + Number(a[2]);
}

/**
 * O horário do escritório é o que a tela do agente grava, e o agente é por versão publicada.
 * Com um agente só (o caso comum) não há dúvida. Com vários horários diferentes, usa-se o do
 * agente mais antigo e `divergentes` avisa — a tela diz qual foi usado, em vez de escolher calada.
 */
export function escolheHorario(versoes: VersaoPublicada[]): HorarioEscolhido {
  const ordenadas = [...versoes].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
  const comJanela = ordenadas
    .map((v) => ({ agente: v.agente, janela: lerJanelaDeAtendimento(v.trigger_config) }))
    .filter((v): v is { agente: string; janela: JanelaDeAtendimento } => v.janela !== null);
  const atravessa = ordenadas.find((v) => atravessaAMeiaNoite(v.trigger_config))?.agente ?? null;
  const primeira = comJanela[0];
  if (!primeira) return { janela: null, agente: null, divergentes: false, atravessaMeiaNoite: atravessa };
  const divergentes = comJanela.some((v) => chaveDaJanela(v.janela) !== chaveDaJanela(primeira.janela));
  return { janela: primeira.janela, agente: primeira.agente, divergentes, atravessaMeiaNoite: atravessa };
}

// ── os números ──────────────────────────────────────────────────────────────────────────────

export type Fonte = "conversas" | "mensagens" | "casos" | "vinculos" | "consultas" | "horario" | "fuso";

export type MotivoNaoMedido =
  | "sem_horario_configurado"
  | "horario_atravessa_meia_noite"
  | "erro_ao_ler"
  | "leitura_parcial"
  | "sem_registro_de_comparecimento"
  | "consultas_ainda_no_futuro"
  | "etapa_anterior_nao_medida";

export type Medida =
  | { medido: true; valor: number }
  /** `faltam`: só em `sem_registro_de_comparecimento` — quantas consultas passadas sem desfecho. */
  | { medido: false; motivo: MotivoNaoMedido; faltam?: number };

export type Aviso = { fonte: Fonte; tipo: "erro" | "parcial" };

export type EtapaId = "fora_do_horario" | "triados" | "agendados" | "compareceram" | "clientes";

export type Passagem =
  | { tipo: "primeira" }
  | { tipo: "outra_unidade" }
  | { tipo: "sem_base" }
  | { tipo: "taxa"; percentual: number };

export type Etapa = {
  id: EtapaId;
  medida: Medida;
  passagem: Passagem;
  /** O denominador que a tela mostra ("N de M …"); `null` quando a etapa não tem. */
  de: number | null;
};

export type Desdobramento = { seguiu: number; recusou: number; passouAoAdvogado: number; semDecisao: number };

export type Funil = {
  periodo: PeriodoDoFunil;
  /** Conversas novas no período, fora de grupo — o denominador da etapa 1. `null` = não lido. */
  totalDePrimeirosContatos: number | null;
  /** Triados por decisão da triagem. `null` = não lido. */
  desdobramento: Desdobramento | null;
  /** Triados que não foram recusados — a base das etapas 3 a 5. */
  elegiveis: number | null;
  /** Agendados cujas consultas ainda não aconteceram (fora do denominador de "compareceram"). */
  aindaPorAcontecer: number | null;
  /** Ganhos entre os elegíveis, e quantos deles NÃO passaram por consulta realizada. */
  ganhos: { total: number; semConsultaRealizada: number | null } | null;
  etapas: Etapa[];
  avisos: Aviso[];
  /** O fuso do escritório difere do fuso do horário do agente. */
  fusosDiferem: boolean;
};

export type LinhaDeConversa = { id: string; created_at: string; is_group?: boolean | null };
export type LinhaDeMensagem = { id: string; conversation_id: string; created_at: string; direction?: string | null; type?: string | null };
export type LinhaDeCaso = { id: string; status: string; custom_fields: unknown; created_at: string };
export type LinhaDeVinculo = { id: string; lead_id: string; target_id: string };
export type LinhaDeConsulta = { id: string; status: string; starts_at: string };

export type LeituraDoHorario = HorarioEscolhido & { estado: "ok" | "erro" };

export type EntradaDoFunil = {
  periodo: PeriodoDoFunil;
  /** O fuso da organização foi lido? Sem ele os limites do período são um palpite: tudo vira "não medido". */
  fusoLido: boolean;
  horario: LeituraDoHorario;
  conversas: Leitura<LinhaDeConversa>;
  mensagens: Leitura<LinhaDeMensagem>;
  casos: Leitura<LinhaDeCaso>;
  vinculos: Leitura<LinhaDeVinculo>;
  consultas: Leitura<LinhaDeConsulta>;
  agora: Date;
};

const SEM_FALA = new Set(["reaction", "system"]);

function campo(campos: unknown, chave: string): unknown {
  return campos && typeof campos === "object" ? (campos as Record<string, unknown>)[chave] : undefined;
}

function areaPreenchida(campos: unknown): boolean {
  const v = campo(campos, CAMPO_DA_AREA);
  return typeof v === "string" && v.trim() !== "";
}

const naoMedido = (motivo: MotivoNaoMedido, extra: { faltam?: number } = {}): Medida => ({ medido: false, motivo, ...extra });
const medido = (valor: number): Medida => ({ medido: true, valor });

function dentroDoPeriodo(iso: string, p: PeriodoDoFunil): boolean {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= p.inicio.getTime() && t <= p.fim.getTime();
}

/** O caso foi triado NO período e tem a área preenchida: a coorte do painel. Cada caso uma vez. */
export function triadosNoPeriodo(casos: readonly LinhaDeCaso[], periodo: PeriodoDoFunil): LinhaDeCaso[] {
  const vistos = new Set<string>();
  return casos.filter((c) => {
    if (vistos.has(c.id)) return false;
    vistos.add(c.id);
    const quando = campo(c.custom_fields, CAMPO_DA_DATA_DA_TRIAGEM);
    return typeof quando === "string" && dentroDoPeriodo(quando, periodo) && areaPreenchida(c.custom_fields);
  });
}

const foiRecusado = (c: LinhaDeCaso) => campo(c.custom_fields, CAMPO_DA_DECISAO_DA_TRIAGEM) === "recusar";

/** Os triados que seguem para agendar: tudo menos os recusados. */
export function elegiveisDoFunil(casos: readonly LinhaDeCaso[], periodo: PeriodoDoFunil): LinhaDeCaso[] {
  return triadosNoPeriodo(casos, periodo).filter((c) => !foiRecusado(c));
}

/** A razão para a etapa anterior, com uma casa decimal. Sem base (não medida ou zero), sem taxa. */
function taxa(base: Medida | number | null, atual: Medida): Passagem {
  const b = base === null ? null : typeof base === "number" ? base : base.medido ? base.valor : null;
  if (b === null || b === 0 || !atual.medido) return { tipo: "sem_base" };
  return { tipo: "taxa", percentual: Math.round((atual.valor / b) * 1000) / 10 };
}

/** Por que uma leitura ruim deixa uma etapa sem número. `null` = a leitura serve. */
function motivoDaLeitura(estado: EstadoDaLeitura): MotivoNaoMedido | null {
  return estado === "erro" ? "erro_ao_ler" : estado === "parcial" ? "leitura_parcial" : null;
}

export function calculaFunil(e: EntradaDoFunil): Funil {
  const { periodo, agora } = e;
  const avisos: Aviso[] = [];
  const avisa = (fonte: Fonte, estado: EstadoDaLeitura) => {
    if (estado !== "ok") avisos.push({ fonte, tipo: estado === "erro" ? "erro" : "parcial" });
  };
  if (!e.fusoLido) avisa("fuso", "erro");
  avisa("conversas", e.conversas.estado);
  avisa("mensagens", e.mensagens.estado);
  avisa("casos", e.casos.estado);
  avisa("vinculos", e.vinculos.estado);
  avisa("consultas", e.consultas.estado);
  avisa("horario", e.horario.estado);

  // Sem o fuso, o corte do período é um palpite: nada é medido.
  const motivoDoFuso: MotivoNaoMedido | null = e.fusoLido ? null : "erro_ao_ler";

  // 1 · primeiros contatos: conversa nova no período, fora de grupo, cuja primeira fala do cliente (de toda a história) caiu no período.
  const motivoDoContato = motivoDoFuso ?? motivoDaLeitura(piorEstado(e.conversas.estado, e.mensagens.estado));
  let totalDePrimeirosContatos: number | null = null;
  let foraDoHorario: Medida;
  if (motivoDoContato) {
    foraDoHorario = naoMedido(motivoDoContato);
  } else {
    const novas = new Set(e.conversas.linhas.filter((c) => !c.is_group && dentroDoPeriodo(c.created_at, periodo)).map((c) => c.id));
    const primeiraFala = new Map<string, number>();
    for (const m of e.mensagens.linhas) {
      if (!novas.has(m.conversation_id)) continue;
      if (m.direction !== undefined && m.direction !== null && m.direction !== "inbound") continue;
      if (m.type && SEM_FALA.has(m.type)) continue;
      const t = new Date(m.created_at).getTime();
      if (!Number.isFinite(t)) continue;
      const ate = primeiraFala.get(m.conversation_id);
      if (ate === undefined || t < ate) primeiraFala.set(m.conversation_id, t);
    }
    // a primeira fala de TODA a história tem de cair no período; história anterior (importada) exclui
    const primeiros = [...primeiraFala.values()].filter((t) => dentroDoPeriodo(new Date(t).toISOString(), periodo));
    totalDePrimeirosContatos = primeiros.length;
    const h = e.horario;
    if (h.estado === "erro") foraDoHorario = naoMedido("erro_ao_ler");
    else if (h.janela) {
      const janela = h.janela;
      foraDoHorario = medido(primeiros.filter((t) => msAteAJanelaAbrir(janela, new Date(t)) !== null).length);
    } else foraDoHorario = naoMedido(h.atravessaMeiaNoite ? "horario_atravessa_meia_noite" : "sem_horario_configurado");
  }

  // 2 · triados (coorte)
  const motivoDosCasos = motivoDoFuso ?? motivoDaLeitura(e.casos.estado);
  const triados = motivoDosCasos ? [] : triadosNoPeriodo(e.casos.linhas, periodo);
  const elegiveis = triados.filter((c) => !foiRecusado(c));
  const desdobramento: Desdobramento | null = motivoDosCasos
    ? null
    : {
        seguiu: triados.filter((c) => campo(c.custom_fields, CAMPO_DA_DECISAO_DA_TRIAGEM) === "seguir").length,
        recusou: triados.length - elegiveis.length,
        passouAoAdvogado: triados.filter((c) => campo(c.custom_fields, CAMPO_DA_DECISAO_DA_TRIAGEM) === "passar_ao_advogado").length,
        semDecisao: elegiveis.filter((c) => {
          const d = campo(c.custom_fields, CAMPO_DA_DECISAO_DA_TRIAGEM);
          return d !== "seguir" && d !== "passar_ao_advogado";
        }).length,
      };
  const mTriados: Medida = motivoDosCasos ? naoMedido(motivoDosCasos) : medido(triados.length);

  // 3 · agendados: consulta VINCULADA ao caso e não cancelada
  const motivoDaAgenda = motivoDosCasos ?? motivoDaLeitura(piorEstado(e.vinculos.estado, e.consultas.estado));
  const consultaPorId = new Map(e.consultas.linhas.map((c) => [c.id, c]));
  const consultasDoCaso = new Map<string, LinhaDeConsulta[]>();
  if (!motivoDaAgenda) {
    for (const v of e.vinculos.linhas) {
      const c = consultaPorId.get(v.target_id);
      if (!c || c.status === "cancelled") continue;
      const lista = consultasDoCaso.get(v.lead_id) ?? [];
      if (!lista.some((x) => x.id === c.id)) lista.push(c);
      consultasDoCaso.set(v.lead_id, lista);
    }
  }
  const doCaso = (c: LinhaDeCaso) => consultasDoCaso.get(c.id) ?? [];
  const agendados = motivoDaAgenda ? [] : elegiveis.filter((c) => doCaso(c).length > 0);
  const mAgendados: Medida = motivoDaAgenda ? naoMedido(motivoDaAgenda) : medido(agendados.length);

  // 4 · compareceram: só com TODO desfecho das consultas passadas registrado
  const jaPassou = (q: LinhaDeConsulta) => new Date(q.starts_at).getTime() < agora.getTime();
  const temDesfecho = (q: LinhaDeConsulta) => q.status === "completed" || q.status === "no_show";
  const comConsultaPassada = agendados.filter((c) => doCaso(c).some(jaPassou));
  const consultasSemDesfecho = new Set(
    agendados.flatMap((c) => doCaso(c).filter((q) => jaPassou(q) && !temDesfecho(q)).map((q) => q.id)),
  );
  const compareceram = comConsultaPassada.filter((c) => doCaso(c).some((q) => q.status === "completed"));
  const aindaPorAcontecer = motivoDaAgenda ? null : agendados.length - comConsultaPassada.length;

  let mCompareceram: Medida;
  if (!mAgendados.medido) mCompareceram = mAgendados;
  else if (agendados.length === 0) mCompareceram = medido(0);
  else if (consultasSemDesfecho.size > 0) mCompareceram = naoMedido("sem_registro_de_comparecimento", { faltam: consultasSemDesfecho.size });
  else if (comConsultaPassada.length === 0) mCompareceram = naoMedido("consultas_ainda_no_futuro");
  else mCompareceram = medido(compareceram.length);

  // 5 · viraram cliente: ganhos ENTRE os que compareceram; os demais ganhos aparecem à parte
  const ganhosTotal = elegiveis.filter((c) => c.status === "won");
  const idsQueCompareceram = new Set(compareceram.map((c) => c.id));
  const clientes = ganhosTotal.filter((c) => idsQueCompareceram.has(c.id));
  let mClientes: Medida;
  if (!mCompareceram.medido) {
    const m = mCompareceram.motivo;
    mClientes = naoMedido(m === "erro_ao_ler" || m === "leitura_parcial" ? m : "etapa_anterior_nao_medida");
  } else mClientes = medido(clientes.length);

  const base = motivoDosCasos ? null : elegiveis.length;
  return {
    periodo,
    totalDePrimeirosContatos,
    desdobramento,
    elegiveis: base,
    aindaPorAcontecer,
    ganhos: motivoDosCasos
      ? null
      : { total: ganhosTotal.length, semConsultaRealizada: mCompareceram.medido ? ganhosTotal.length - clientes.length : null },
    etapas: [
      { id: "fora_do_horario", medida: foraDoHorario, passagem: { tipo: "primeira" }, de: totalDePrimeirosContatos },
      { id: "triados", medida: mTriados, passagem: { tipo: "outra_unidade" }, de: null },
      { id: "agendados", medida: mAgendados, passagem: taxa(base, mAgendados), de: base },
      {
        id: "compareceram",
        medida: mCompareceram,
        passagem: taxa(comConsultaPassada.length, mCompareceram),
        de: mCompareceram.medido ? comConsultaPassada.length : null,
      },
      { id: "clientes", medida: mClientes, passagem: taxa(mCompareceram, mClientes), de: mCompareceram.medido ? compareceram.length : null },
    ],
    avisos,
    fusosDiferem: e.horario.janela !== null && e.horario.janela.timezone !== periodo.fuso,
  };
}
