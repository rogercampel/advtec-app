/**
 * A FICHA DO CASO — spec 0001.E4 (#18), com o que existe antes da triagem jurídica.
 *
 * O caso é o negócio do funil (ADR 0003, `crm_leads`). A ficha junta, para o
 * advogado ler sem abrir a conversa (critério 10): quem, área, urgência, resumo,
 * histórico, documentos enviados e compromissos.
 *
 * O que ela NÃO inventa. Área, resumo e urgência jurídica (prazo correndo,
 * audiência marcada, preso) são trabalho da triagem jurídica (0001.E3, #10), que
 * ainda não existe. Até lá:
 *   - área e resumo vêm de `custom_fields` do caso se alguém os gravou, e senão
 *     a ficha diz "a definir pela triagem" — nunca um palpite;
 *   - urgência NUNCA aparece como "sem urgência": o detector da base
 *     (`detectUrgencySignal`) só conhece palavras genéricas de risco ("urgente",
 *     "socorro"), não "audiência amanhã". Quando ele acende, a ficha mostra a
 *     mensagem literal, com a data; quando não acende, não conclui nada.
 *
 * Depois da triagem (#10), a ficha mostra a urgência que ela gravou (o trecho literal do cliente).
 * Triagem rodada sem urgência gravada NÃO vira "sem urgência": o léxico não achou, e é só isso que se diz.
 */
import { detectUrgencySignal } from "@/lib/agent-engine/guardrails/sinal-de-urgencia";
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";
import { detectaUrgenciasJuridicas, ROTULO_DA_URGENCIA } from "@/lib/triagem/urgencia-juridica";

/** Onde a triagem jurídica vai gravar a área e o resumo no caso. Contrato: renomear esconde o que já foi gravado. */
export const CAMPO_DA_AREA = "area_do_direito";
export const CAMPO_DO_RESUMO = "resumo_do_caso";
/** A triagem (`lib/triagem/registrar-triagem.ts`, `CAMPOS_DA_TRIAGEM`) grava estas duas; um teste cobra que os nomes não divergem. */
export const CAMPO_DA_URGENCIA = "urgencia_juridica";
export const CAMPO_DA_DECISAO_DA_TRIAGEM = "triagem_decisao";
/** Teto do histórico na ficha: a conversa inteira continua na caixa de entrada. */
export const MENSAGENS_NA_FICHA = 200;
const TAMANHO_DO_TRECHO = 240;

export type CasoDaFicha = { id: string; title: string | null; custom_fields: unknown; created_at: string; contact_id: string | null };
export type ContatoDaFicha = { id: string; name: string | null; display_name: string | null; phone_number: string | null };
export type MensagemDaFicha = {
  id: string;
  conversation_id: string;
  direction: string;
  body: string | null;
  media_mime: string | null;
  media_size_bytes: number | null;
  created_at: string;
  /** `messages.type`. Reação e aviso de sistema não são fala de ninguém e ficam fora da ficha. */
  type?: string | null;
};
export type CompromissoDaFicha = { id: string; title: string; starts_at: string; status: string };

export type Ficha = {
  caso: { id: string; titulo: string; abertoEm: string };
  quem: { nome: string; telefone: string | null } | null;
  area: string | null;
  resumo: string | null;
  /** O que a triagem gravou como urgência (trecho literal do cliente, rotulado). `null` = a triagem não gravou nenhuma. */
  urgenciaDaTriagem: string | null;
  /**
   * Urgência jurídica que o léxico da triagem acha no que o CLIENTE escreveu, lida do histórico na hora de
   * montar a ficha. É o que cobre a passagem por urgência antes do modelo (que não grava no caso): a ficha
   * nunca afirma "não encontrou" diante de uma urgência que o próprio histórico mostra.
   */
  urgenciasNoHistorico: Array<{ id: string; em: string; rotulo: string; trecho: string }>;
  /** A triagem já rodou neste caso (há decisão gravada). Sem urgência gravada, quer dizer "o léxico não achou", não "sem urgência". */
  triagemRodou: boolean;
  /** Mensagens do cliente em que o detector genérico da base acendeu — literais. Vazio NÃO quer dizer "sem urgência". */
  palavrasDeUrgencia: Array<{ id: string; em: string; trecho: string }>;
  historico: Array<{ id: string; em: string; de: "cliente" | "escritorio"; texto: string; conversa: string }>;
  /** Quantas mensagens ficaram fora do histórico por causa do teto. */
  historicoCortado: number;
  documentos: Array<{ id: string; em: string; tipo: string; tamanhoKb: number | null; conversa: string }>;
  compromissos: { proximos: CompromissoDaFicha[]; passados: CompromissoDaFicha[] };
  /** O que espera a triagem jurídica (0001.E3). */
  daTriagem: Array<"area" | "resumo" | "urgencia">;
};

function campoDeTexto(campos: unknown, chave: string): string | null {
  if (!campos || typeof campos !== "object") return null;
  const v = (campos as Record<string, unknown>)[chave];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** O tipo do arquivo em palavra de gente, a partir do MIME. */
export function tipoDoArquivo(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return "PDF";
  if (m.startsWith("image/")) return "Imagem";
  if (m.startsWith("audio/")) return "Áudio";
  if (m.startsWith("video/")) return "Vídeo";
  if (m.includes("word") || m.includes("opendocument.text")) return "Documento de texto";
  if (m.includes("sheet") || m.includes("excel")) return "Planilha";
  return "Arquivo";
}

export function montaFicha(args: {
  caso: CasoDaFicha;
  contato: ContatoDaFicha | null;
  mensagens: MensagemDaFicha[];
  compromissos: CompromissoDaFicha[];
  agora: Date;
}): Ficha {
  const { caso, contato, agora } = args;
  const area = campoDeTexto(caso.custom_fields, CAMPO_DA_AREA);
  const resumo = campoDeTexto(caso.custom_fields, CAMPO_DO_RESUMO);
  const urgenciaDaTriagem = campoDeTexto(caso.custom_fields, CAMPO_DA_URGENCIA);
  const triagemRodou = campoDeTexto(caso.custom_fields, CAMPO_DA_DECISAO_DA_TRIAGEM) !== null;

  const ordenadas = args.mensagens
    .filter((m) => m.type !== "reaction" && m.type !== "system")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const noHistorico = ordenadas.slice(-MENSAGENS_NA_FICHA);
  const deCliente = (m: MensagemDaFicha) => m.direction === "inbound";

  const nome = nomeDoContato(contato);
  const ativos = args.compromissos.filter((c) => c.status !== "cancelled");

  const urgenciasNoHistorico = ordenadas
    .filter((m) => deCliente(m) && m.body)
    .flatMap((m) =>
      detectaUrgenciasJuridicas(m.body!).map((u) => ({ id: m.id, em: m.created_at, rotulo: ROTULO_DA_URGENCIA[u.tipo], trecho: u.trecho })),
    );

  return {
    caso: { id: caso.id, titulo: caso.title?.trim() || "Caso sem título", abertoEm: caso.created_at },
    quem: contato ? { nome: nome ?? "Contato sem nome", telefone: contato.phone_number } : null,
    area,
    resumo,
    urgenciaDaTriagem,
    urgenciasNoHistorico,
    triagemRodou,
    palavrasDeUrgencia: ordenadas
      .filter((m) => deCliente(m) && m.body && detectUrgencySignal(m.body))
      .map((m) => ({ id: m.id, em: m.created_at, trecho: m.body!.trim().slice(0, TAMANHO_DO_TRECHO) })),
    historico: noHistorico.map((m) => ({
      id: m.id,
      em: m.created_at,
      de: deCliente(m) ? "cliente" : "escritorio",
      texto: m.body?.trim() || (m.media_mime ? `[${tipoDoArquivo(m.media_mime)}]` : "[mensagem sem texto]"),
      conversa: m.conversation_id,
    })),
    historicoCortado: ordenadas.length - noHistorico.length,
    // "Documentos enviados" são os que o CLIENTE mandou; o que o escritório mandou fica no histórico.
    documentos: ordenadas
      .filter((m) => deCliente(m) && m.media_mime)
      .map((m) => ({
        id: m.id,
        em: m.created_at,
        tipo: tipoDoArquivo(m.media_mime!),
        tamanhoKb: m.media_size_bytes == null ? null : Math.max(1, Math.round(m.media_size_bytes / 1024)),
        conversa: m.conversation_id,
      })),
    compromissos: {
      proximos: ativos.filter((c) => new Date(c.starts_at) >= agora).sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
      passados: ativos.filter((c) => new Date(c.starts_at) < agora).sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
    },
    daTriagem: [...(area ? [] : (["area"] as const)), ...(resumo ? [] : (["resumo"] as const)), ...(urgenciaDaTriagem || (triagemRodou && urgenciasNoHistorico.length === 0) ? [] : (["urgencia"] as const))],
  };
}
