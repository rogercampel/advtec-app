/**
 * PAINEL DE MEDIÇÃO — spec 0001, etapa E5, critério 12: "o painel mostra os cinco
 * números do funil". É a razão de existir do v1, e a implantação real é medida por
 * 30 dias com ele:
 *
 *   atendimentos fora do horário → triados → agendados → compareceram → viraram cliente
 *
 * Esta função é PURA: recebe as linhas já lidas (com a sessão, recortadas pela RLS e
 * pela organização ativa) e devolve os números. Quem lê o banco é a página.
 *
 * ## Regra de ouro: onde o dado não existe, o número é "não medido" — nunca um palpite
 *
 * `Medida` é `{ medido: true, valor }` ou `{ medido: false, motivo }`. Zero é um valor
 * (medimos e deu zero); "não medido" é outra coisa (não há como saber). Misturar os dois
 * é o jeito de um painel mentir sem errar nenhuma conta.
 *
 * ## As definições (a tela repete cada uma ao lado do número)
 *
 *   1. ATENDIMENTOS FORA DO HORÁRIO — conversas (`conversations`) cuja PRIMEIRA mensagem
 *      do cliente NO PERÍODO caiu fora do horário comercial do escritório. O horário é o
 *      que a tela do agente grava em `ai_agent_versions.trigger_config.filters.business_hours`
 *      (fuso, dias, início, fim) e que o motor lê em `lerJanelaDeAtendimento`; aqui a régua
 *      de "aberto agora?" é a MESMA do motor (`msAteAJanelaAbrir`), para o painel e o
 *      atendimento nunca discordarem sobre o que é "fora". Sem horário configurado: não medido.
 *      O total de atendimentos no período é o denominador.
 *   2. TRIADOS — casos (`crm_leads`, o negócio do funil: ADR 0003) abertos no período com
 *      `custom_fields.area_do_direito` preenchida — a chave que a triagem grava e a ficha lê.
 *   3. AGENDADOS — desses casos, os cujo contato tem consulta em `calendar_appointments`
 *      que não foi cancelada (o mesmo vínculo da ficha: pelo `contact_id`).
 *   4. COMPARECERAM — desses casos, os cujo contato tem consulta com situação `completed`
 *      ("Realizado"). Só é medido quando alguém registra o desfecho (`completed`/`no_show`):
 *      consulta que passou e segue `confirmed` não diz se a pessoa foi.
 *   5. VIRARAM CLIENTE — desses casos, os com `crm_leads.status = 'won'` (vocabulário real:
 *      `open | won | lost`).
 *
 * ## Por que as etapas 2–5 são uma COORTE de casos, e não eventos do período
 *
 * "Casos abertos no período" é um grupo fixo; cada etapa pergunta quantos dele chegaram lá.
 * Assim cada número é comparável ao anterior. Os dados não garantem que cada etapa seja
 * subconjunto da anterior (um caso agendado sem ter sido triado existe), e o painel NÃO
 * força o funil: mostra o número como é e marca "acima da etapa anterior" quando acontece.
 * A etapa 1 conta CONVERSAS e as demais contam CASOS — unidades diferentes —, então não há
 * taxa de passagem entre elas (`outra_unidade`): dividir conversas por casos daria um
 * percentual que não quer dizer nada.
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

export const DIAS_DO_PAINEL = [7, 30, 90] as const;
export const DIAS_PADRAO = 30;
export const FUSO_PADRAO = "America/Sao_Paulo";

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
export type HorarioEscolhido = { janela: JanelaDeAtendimento | null; agente: string | null; divergentes: boolean };

const chaveDaJanela = (j: JanelaDeAtendimento) => JSON.stringify([j.timezone, j.start, j.end, [...j.weekdays].sort()]);

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
  const primeira = comJanela[0];
  if (!primeira) return { janela: null, agente: null, divergentes: false };
  const divergentes = comJanela.some((v) => chaveDaJanela(v.janela) !== chaveDaJanela(primeira.janela));
  return { janela: primeira.janela, agente: primeira.agente, divergentes };
}

// ── os números ──────────────────────────────────────────────────────────────────────────────

export type MotivoNaoMedido =
  | "sem_horario_configurado"
  | "sem_registro_de_comparecimento"
  | "consultas_ainda_no_futuro";

export type Medida = { medido: true; valor: number } | { medido: false; motivo: MotivoNaoMedido };

export type Aviso = "leitura_parcial_mensagens" | "leitura_parcial_casos" | "leitura_parcial_consultas";

export type EtapaId = "fora_do_horario" | "triados" | "agendados" | "compareceram" | "clientes";

export type Passagem =
  | { tipo: "primeira" }
  | { tipo: "outra_unidade" }
  | { tipo: "sem_base" }
  | { tipo: "taxa"; percentual: number; acimaDaAnterior: boolean };

export type Etapa = { id: EtapaId; medida: Medida; passagem: Passagem };

export type Funil = {
  periodo: PeriodoDoFunil;
  /** Conversas cuja primeira mensagem do cliente no período caiu no período — o denominador da etapa 1. */
  totalDeAtendimentos: number;
  /** Casos abertos no período — o denominador das etapas 2 a 5. */
  casosAbertos: number;
  etapas: Etapa[];
  /** Casos agendados cuja consulta já passou e segue sem desfecho registrado. */
  agendadosSemDesfecho: number;
  avisos: Aviso[];
};

export type LinhaDeMensagem = { conversation_id: string; created_at: string; direction?: string | null; type?: string | null };
export type LinhaDeCaso = { id: string; status: string; custom_fields: unknown; contact_id: string | null; created_at: string };
export type LinhaDeConsulta = { contact_id: string | null; status: string; starts_at: string };

export type EntradaDoFunil = {
  periodo: PeriodoDoFunil;
  janela: JanelaDeAtendimento | null;
  mensagens: LinhaDeMensagem[];
  casos: LinhaDeCaso[];
  consultas: LinhaDeConsulta[];
  /** Quando a leitura bateu no teto de linhas: a contagem é parcial e o painel avisa. */
  truncado?: { mensagens?: boolean; casos?: boolean; consultas?: boolean };
  agora: Date;
};

const SEM_FALA = new Set(["reaction", "system"]);

function areaPreenchida(campos: unknown): boolean {
  if (!campos || typeof campos !== "object") return false;
  const v = (campos as Record<string, unknown>)[CAMPO_DA_AREA];
  return typeof v === "string" && v.trim() !== "";
}

const medido = (valor: number): Medida => ({ medido: true, valor });

function passagem(anterior: Medida, atual: Medida): Passagem {
  if (!anterior.medido || !atual.medido || anterior.valor === 0) return { tipo: "sem_base" };
  return {
    tipo: "taxa",
    percentual: Math.round((atual.valor / anterior.valor) * 1000) / 10,
    acimaDaAnterior: atual.valor > anterior.valor,
  };
}

export function calculaFunil(e: EntradaDoFunil): Funil {
  const { inicio, fim } = e.periodo;
  const dentro = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= inicio.getTime() && t <= fim.getTime();
  };

  // 1 · atendimentos: a PRIMEIRA fala do cliente de cada conversa dentro do período.
  const primeiraFala = new Map<string, number>();
  for (const m of e.mensagens) {
    if (m.direction !== undefined && m.direction !== null && m.direction !== "inbound") continue;
    if (m.type && SEM_FALA.has(m.type)) continue;
    if (!dentro(m.created_at)) continue;
    const t = new Date(m.created_at).getTime();
    const ate = primeiraFala.get(m.conversation_id);
    if (ate === undefined || t < ate) primeiraFala.set(m.conversation_id, t);
  }
  const totalDeAtendimentos = primeiraFala.size;
  const foraDoHorario: Medida = e.janela
    ? medido([...primeiraFala.values()].filter((t) => msAteAJanelaAbrir(e.janela!, new Date(t)) !== null).length)
    : { medido: false, motivo: "sem_horario_configurado" };

  // 2–5 · a coorte de casos abertos no período.
  const casos = e.casos.filter((c) => dentro(c.created_at));
  const triados = casos.filter((c) => areaPreenchida(c.custom_fields));

  const consultasPorContato = new Map<string, LinhaDeConsulta[]>();
  for (const c of e.consultas) {
    if (!c.contact_id || c.status === "cancelled") continue;
    const lista = consultasPorContato.get(c.contact_id) ?? [];
    lista.push(c);
    consultasPorContato.set(c.contact_id, lista);
  }
  const consultasDoCaso = (c: LinhaDeCaso) => (c.contact_id ? (consultasPorContato.get(c.contact_id) ?? []) : []);

  const agendados = casos.filter((c) => consultasDoCaso(c).length > 0);
  const compareceram = agendados.filter((c) => consultasDoCaso(c).some((q) => q.status === "completed"));
  const temDesfecho = (c: LinhaDeCaso) => consultasDoCaso(c).some((q) => q.status === "completed" || q.status === "no_show");
  const jaPassou = (q: LinhaDeConsulta) => new Date(q.starts_at).getTime() < e.agora.getTime();
  const semDesfecho = agendados.filter((c) => !temDesfecho(c) && consultasDoCaso(c).some(jaPassou));

  let medidaComparecimento: Medida;
  if (agendados.length === 0) medidaComparecimento = medido(0);
  else if (agendados.some(temDesfecho)) medidaComparecimento = medido(compareceram.length);
  else if (semDesfecho.length > 0) medidaComparecimento = { medido: false, motivo: "sem_registro_de_comparecimento" };
  else medidaComparecimento = { medido: false, motivo: "consultas_ainda_no_futuro" };

  const clientes = casos.filter((c) => c.status === "won");

  const mTriados = medido(triados.length);
  const mAgendados = medido(agendados.length);
  const mClientes = medido(clientes.length);

  const avisos: Aviso[] = [];
  if (e.truncado?.mensagens) avisos.push("leitura_parcial_mensagens");
  if (e.truncado?.casos) avisos.push("leitura_parcial_casos");
  if (e.truncado?.consultas) avisos.push("leitura_parcial_consultas");

  return {
    periodo: e.periodo,
    totalDeAtendimentos,
    casosAbertos: casos.length,
    etapas: [
      { id: "fora_do_horario", medida: foraDoHorario, passagem: { tipo: "primeira" } },
      { id: "triados", medida: mTriados, passagem: { tipo: "outra_unidade" } },
      { id: "agendados", medida: mAgendados, passagem: passagem(mTriados, mAgendados) },
      { id: "compareceram", medida: medidaComparecimento, passagem: passagem(mAgendados, medidaComparecimento) },
      { id: "clientes", medida: mClientes, passagem: passagem(medidaComparecimento, mClientes) },
    ],
    agendadosSemDesfecho: semDesfecho.length,
    avisos,
  };
}
