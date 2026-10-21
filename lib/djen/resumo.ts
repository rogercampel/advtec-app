/**
 * Resumo da manhã — spec 0009.E5 (AdvTec).
 *
 * Às 7h (horário de Brasília), a pauta de hoje vai por e-mail para os usuários
 * do escritório. **Nunca para cliente** (critério 6): os destinatários vêm só de
 * `destinatarios(org)` — membros ativos do escritório — e este módulo não lê
 * contato nenhum. Um envio por dia, e o dia vazio diz "nada novo" em vez de
 * sumir (risco da spec: resumo que some deixa de ser lido).
 *
 * A regra mora aqui; banco e e-mail entram pela `PortaDoResumo`.
 */
import type { NegocioDoFunil, PublicacaoDaCaixa } from "./caixa";
import { JANELA_DO_VENCIDO, montaPauta, type LinhaDaPauta, type Pauta } from "./pauta";

export type Mensagem = { to: string; subject: string; text: string; html: string };

export type PortaDoResumo = {
  /** Escritórios com OAB monitorada e operantes (régua de org parada). */
  escritorios(): Promise<Array<{ organizationId: string; nome: string }>>;
  leituraDaPauta(organizationId: string): Promise<{ publicacoes: PublicacaoDaCaixa[]; negocios: NegocioDoFunil[] }>;
  /** E-mails dos usuários do escritório — a ÚNICA fonte de destinatário. */
  destinatarios(organizationId: string): Promise<string[]>;
  enviar(m: Mensagem): Promise<{ ok: boolean }>;
};

function linha(l: LinhaDaPauta): string {
  const ato = l.tipoDeAto?.tipo ?? "ato não identificado";
  const prazos = l.prazosSugeridos.map((p) =>
    p.dias === null
      ? `   prazo sugerido, sem número no texto: "${p.trecho}"`
      : `   prazo sugerido de ${p.dias} dias${p.contagem === "util" ? " úteis" : p.contagem === "corrido" ? " corridos" : ""}, a confirmar: "${p.trecho}"`,
  );
  return [`- ${l.publicacao.numeroProcesso} · ${ato} · ${l.publicacao.dataDisponibilizacao}`, ...prazos].join("\n");
}

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Só prazo CONFIRMADO tem data: é a que alguém do escritório digitou (0006.E5). */
function vencimento(l: LinhaDaPauta): string {
  const c = l.publicacao.prazoConfirmado!;
  const obs = c.observacao ? ` · ${c.observacao}` : "";
  return `- ${l.publicacao.numeroProcesso} · vence em ${dataBr(c.venceEm)} (data confirmada pelo escritório)${obs}`;
}

export function montaResumo(pauta: Pauta, nome: string, url: string): { subject: string; text: string } {
  const novas = pauta.chegouDesdeOntem.length;
  const pendentes = pauta.pendentes.length;
  const caixa = pauta.naoReconhecidas.length;
  const hoje = pauta.venceHoje.length;
  const semana = pauta.venceNaSemana.length;
  const depois = pauta.venceDepois.length;
  const venceu = pauta.venceu.length;
  const vazio = novas + pendentes + caixa + hoje + semana + depois + venceu === 0;
  const prefixo = [venceu ? `${venceu} venceu(ram)` : "", hoje ? `${hoje} vence(m) hoje` : ""]
    .filter(Boolean)
    .map((x) => `${x}, `)
    .join("");
  const subject = vazio
    ? `Pauta de ${pauta.hoje} · ${nome}: nada novo`
    : `Pauta de ${pauta.hoje} · ${nome}: ${prefixo}${novas} nova(s), ${pendentes} pendente(s), ${caixa} sem caso`;
  const vencimentos =
    hoje + semana + depois + venceu === 0
      ? []
      : [
          ...(venceu ? [`Venceu nos últimos ${JANELA_DO_VENCIDO} dias (${venceu}):`, ...pauta.venceu.map(vencimento), ""] : []),
          `Vence hoje (${hoje}):`,
          ...(hoje ? pauta.venceHoje.map(vencimento) : ["- nada"]),
          "",
          `Vence nos próximos 7 dias (${semana}):`,
          ...(semana ? pauta.venceNaSemana.map(vencimento) : ["- nada"]),
          "",
          ...(depois ? [`Confirmados que vencem depois (${depois}):`, ...pauta.venceDepois.map(vencimento), ""] : []),
        ];
  const partes = vazio
    ? ["Nada novo hoje: nenhuma publicação desde ontem, nenhum prazo esperando confirmação, caixa vazia."]
    : [
        ...vencimentos,
        `Chegou desde ontem (${novas}):`,
        ...(novas ? pauta.chegouDesdeOntem.map(linha) : ["- nada"]),
        "",
        `Pendente de confirmação (${pendentes}):`,
        ...(pendentes ? pauta.pendentes.map((l) => `${linha(l)}\n   há ${l.diasNaPauta} dias na pauta`) : ["- nada"]),
        "",
        `Não reconhecidas, esperando decisão: ${caixa}.`,
      ];
  const text = [
    `Pauta de hoje do escritório ${nome}.`,
    "",
    ...partes,
    "",
    "Os prazos sugeridos são lidos do texto, sem contagem. Só a data confirmada por alguém do escritório aparece como vencimento. Continue com o seu controle atual.",
    `Abrir a pauta: ${url}`,
  ].join("\n");
  return { subject, text };
}

const escapa = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type ResultadoDoResumo = { organizationId: string; enviados: number; falhas: number; vazio: boolean };

export async function rodaResumo(porta: PortaDoResumo, opts: { agora: Date; url: string }): Promise<ResultadoDoResumo[]> {
  const resultado: ResultadoDoResumo[] = [];
  for (const e of await porta.escritorios()) {
    const { publicacoes, negocios } = await porta.leituraDaPauta(e.organizationId);
    const pauta = montaPauta(publicacoes, negocios, opts.agora);
    const { subject, text } = montaResumo(pauta, e.nome, opts.url);
    const html = `<pre style="font-family:inherit;white-space:pre-wrap">${escapa(text)}</pre>`;
    let enviados = 0;
    let falhas = 0;
    // Um e-mail por pessoa: ninguém vê o endereço do colega no "Para".
    for (const to of await porta.destinatarios(e.organizationId)) {
      const r = await porta.enviar({ to, subject, text, html }).catch(() => ({ ok: false }));
      if (r.ok) enviados += 1;
      else falhas += 1;
    }
    resultado.push({ organizationId: e.organizationId, enviados, falhas, vazio: subject.endsWith("nada novo") });
  }
  return resultado;
}
