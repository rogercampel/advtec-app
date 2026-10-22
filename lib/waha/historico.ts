import type { SupabaseClient } from "@supabase/supabase-js";

import type { WahaClient } from "@/lib/waha/client";
import { wahaPayloadSchema, type WahaPayload } from "@/lib/waha/envelope";
import { bodyOf, dataDoTimestamp, mediaFilenameOf, mediaMimeOf, resolveMessageType } from "@/lib/waha/ingest";
import { bareWaMessageId } from "@/lib/waha/message-id";
import { ackToStatus } from "@/lib/types/messaging";

/**
 * AdvTec: IMPORTAR SOB DEMANDA o histórico de UMA conversa do WhatsApp.
 *
 * O canal guarda o histórico (store do NOWEB com `fullSync`, que só sincroniza no
 * pareamento; no WAHA local medido em 22/10/2026 a mais antiga era de 24/07/2026),
 * mas nada o trazia para o CRM: só entrava o que chegava pelo webhook depois de
 * conectar. Aqui, quem abre a conversa pede, e o que o canal tem daquele contato
 * entra na conversa, na ordem do tempo.
 *
 * ─── Por que a mensagem importada não dispara nada ─────────────────────────
 *
 * Toda linha nasce com `metadata.historico_importado = true`, e três portas a leem:
 *   - a migration 9008: os gatilhos de `messages` saem cedo (sem ela, a recebida
 *     de julho emitia `message.received` e o agente, a push e o follow-up agiriam
 *     AGORA);
 *   - `shouldNotifyInbound`: o navegador de cada atendente escuta o INSERT por
 *     Realtime, e sem o corte cada recebida antiga virava toast e som;
 *   - este módulo NÃO chama `fn_mark_conversation_message`: passado não muda a
 *     "última mensagem", não volta a conversa para o topo e não conta como não lida.
 * O que a marca NÃO muda: as importadas passam a fazer parte da conversa, então
 * entram no contexto que o agente de IA lê das últimas mensagens quando a conversa
 * tem poucas recentes. É o histórico do cliente; é o que se quer.
 *
 * ─── O endereço do chat (medido em 22/10/2026, WAHA local NOWEB) ───────────
 *
 * O banco guarda o celular com o nono dígito (`+5586 9 ...`, `canonicalPhoneBR`),
 * mas o WhatsApp guarda chat de conta antiga SEM ele: num contato real, com o
 * nono dígito o canal devolveu 0 mensagens, sem ele 27. A forma sem o 9 só é
 * tentada quando as do cadastro não trazem nada (ver `chatIdSemNonoDigito`).
 * `@c.us` e `@s.whatsapp.net` devolveram o mesmo.
 *
 * ─── Sem duplicar ──────────────────────────────────────────────────────────
 *
 * O webhook grava a RECEBIDA com o id completo (`false_<chat>_<id>`) e o envio/eco
 * grava a ENVIADA com a cauda (`<id>`); e o `<chat>` do id completo pode ser `@lid`
 * num dia e `@c.us` no outro. Por isso a comparação é SEMPRE pela cauda, contra as
 * caudas do que a conversa já tem. A corrida com o webhook (ele grava entre a
 * leitura e a escrita) é coberta pela unique, em `inserirSemDuplicar`.
 */

/** Página pedida ao canal, e o teto por endereço (a maior conversa medida tinha 111). */
export const PAGINA_DO_CANAL = 500;
export const TETO_POR_ENDERECO = 5000;

export type ContatoDoChat = { phone_number: string | null; wa_lid: string | null };

/** Os endereços em que o canal guarda o chat deste contato: o lid e o número como está no cadastro. */
export function chatIdsDoContato(c: ContatoDoChat): string[] {
  const ids: string[] = [];
  if (c.wa_lid) ids.push(`${c.wa_lid.replace(/@.*$/, "")}@lid`);
  const d = (c.phone_number ?? "").replace(/\D/g, "");
  if (d.length >= 10) ids.push(`${d}@c.us`);
  return ids;
}

/**
 * Celular BR com nono dígito (55 + DDD + 9 + 8 dígitos) → a forma antiga, sem o 9.
 * Só é tentada quando os endereços do cadastro não trouxeram NADA: tirar o 9 pode,
 * em tese, cair no número fixo de outra pessoa, e o cadastro tem a palavra final.
 */
export function chatIdSemNonoDigito(c: ContatoDoChat): string | null {
  const d = (c.phone_number ?? "").replace(/\D/g, "");
  return d.length === 13 && d.startsWith("55") && d[4] === "9" ? `${d.slice(0, 4)}${d.slice(5)}@c.us` : null;
}

/**
 * A identidade de uma mensagem do canal: a CAUDA do id. O mesmo recado chega como
 * `false_<n>@lid_<id>` num dia e `false_<n>@c.us_<id>` no outro, e o webhook pode
 * ter gravado qualquer das duas formas; a cauda é a mesma.
 */
const identidade = (id: string) => bareWaMessageId(id);

export type Destino = { organizationId: string; conversationId: string; contactId: string; channelSessionId: string };

/** Uma linha de `messages` a partir de uma mensagem do histórico, ou `null` quando não é fala. */
export function linhaDoHistorico(p: WahaPayload, d: Destino, agora: string): Record<string, unknown> | null {
  if (!p.id || typeof p.id !== "string") return null;
  const type = resolveMessageType(p);
  if (type === "reaction") return null;
  const body = bodyOf(p);
  // Sem texto e sem tipo de arquivo não é fala: modelo de mensagem comercial, aviso de protocolo.
  if (!body && type === "text") return null;
  const quando = dataDoTimestamp(p.timestamp, agora);
  const enviada = p.fromMe === true;
  const nomeDoArquivo = mediaFilenameOf(p);
  return {
    organization_id: d.organizationId,
    conversation_id: d.conversationId,
    channel_session_id: d.channelSessionId,
    contact_id: d.contactId,
    external_id: enviada ? bareWaMessageId(p.id) : p.id,
    type,
    direction: enviada ? "outbound" : "inbound",
    status: enviada ? ackToStatus(p.ack ?? null) : "delivered",
    ack: p.ack ?? null,
    body,
    media_url: null,
    media_mime: mediaMimeOf(p),
    sent_via: "external_device",
    sent_at: quando,
    created_at: quando,
    delivered_at: enviada ? null : quando,
    metadata: {
      historico_importado: true,
      raw_type: p.type ?? null,
      ...(nomeDoArquivo ? { media_filename: nomeDoArquivo } : {}),
    },
  };
}

/**
 * As linhas novas: valida o que veio de fora e descarta, PELA CAUDA, o que já está
 * gravado e o que veio repetido de dois endereços. `caudasGravadas` são as caudas
 * dos `external_id` que a conversa já tem.
 */
export function linhasNovas(brutos: unknown[], d: Destino, caudasGravadas: Set<string>, agora: string): Record<string, unknown>[] {
  const vistos = new Set<string>();
  const linhas: Record<string, unknown>[] = [];
  for (const bruto of brutos) {
    const lido = wahaPayloadSchema.safeParse(bruto);
    if (!lido.success) continue;
    const p = lido.data;
    if (typeof p.id !== "string") continue;
    const chave = identidade(p.id);
    if (vistos.has(chave) || caudasGravadas.has(chave)) continue;
    vistos.add(chave);
    const linha = linhaDoHistorico(p, d, agora);
    if (linha) linhas.push(linha);
  }
  return linhas;
}

/** Quantas mensagens distintas o canal devolveu (pela cauda). */
export function contarNoCanal(brutos: unknown[]): number {
  const ids = brutos.map((b) => (b as { id?: unknown } | null)?.id).filter((x): x is string => typeof x === "string");
  return new Set(ids.map(identidade)).size;
}

/** Todas as páginas de um endereço, até o teto. */
async function tudoDoEndereco(waha: Pick<WahaClient, "listarMensagensDoChat">, sessao: string, chatId: string): Promise<unknown[]> {
  let tudo: unknown[] = [];
  for (let offset = 0; offset < TETO_POR_ENDERECO; offset += PAGINA_DO_CANAL) {
    const pagina = await waha.listarMensagensDoChat(sessao, chatId, PAGINA_DO_CANAL, offset);
    tudo = tudo.concat(pagina);
    if (pagina.length < PAGINA_DO_CANAL) break;
  }
  return tudo;
}

export type ResultadoDaImportacao =
  | { ok: true; importadas: number; jaEstavam: number; noCanal: number }
  | { ok: false; motivo: "conversa_nao_encontrada" | "conversa_de_grupo" | "sem_canal" | "contato_sem_endereco" | "canal_indisponivel" };

/**
 * Importa. `admin` é o client de serviço: quem chama JÁ conferiu, com a sessão do
 * usuário, que a conversa é da organização e visível para ele.
 */
export async function importarHistoricoDaConversa(
  admin: SupabaseClient,
  waha: Pick<WahaClient, "listarMensagensDoChat">,
  organizationId: string,
  conversationId: string,
): Promise<ResultadoDaImportacao> {
  const { data: conversa } = await admin
    .from("conversations")
    .select("id, contact_id, channel_session_id, is_group")
    .eq("organization_id", organizationId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conversa?.contact_id) return { ok: false, motivo: "conversa_nao_encontrada" };
  if (conversa.is_group) return { ok: false, motivo: "conversa_de_grupo" };
  if (!conversa.channel_session_id) return { ok: false, motivo: "sem_canal" };

  const [{ data: contato }, { data: canal }] = await Promise.all([
    admin.from("contacts").select("phone_number, wa_lid").eq("organization_id", organizationId).eq("id", conversa.contact_id).maybeSingle(),
    admin.from("channel_sessions").select("waha_session_name").eq("organization_id", organizationId).eq("id", conversa.channel_session_id).maybeSingle(),
  ]);
  const sessao = canal?.waha_session_name;
  if (!sessao) return { ok: false, motivo: "sem_canal" };
  const doCadastro = contato ?? { phone_number: null, wa_lid: null };
  const enderecos = chatIdsDoContato(doCadastro);
  if (enderecos.length === 0) return { ok: false, motivo: "contato_sem_endereco" };

  let brutos: unknown[] = [];
  try {
    for (const chatId of enderecos) brutos = brutos.concat(await tudoDoEndereco(waha, sessao, chatId));
    const semNove = chatIdSemNonoDigito(doCadastro);
    if (brutos.length === 0 && semNove) brutos = await tudoDoEndereco(waha, sessao, semNove);
  } catch {
    return { ok: false, motivo: "canal_indisponivel" };
  }

  const { data: gravadas } = await admin
    .from("messages")
    .select("external_id")
    .eq("organization_id", organizationId)
    .eq("conversation_id", conversationId)
    .not("external_id", "is", null)
    .limit(20000);
  const caudasGravadas = new Set((gravadas ?? []).map((m) => identidade(m.external_id as string)));

  const destino: Destino = { organizationId, conversationId, contactId: conversa.contact_id, channelSessionId: conversa.channel_session_id };
  const linhas = linhasNovas(brutos, destino, caudasGravadas, new Date().toISOString());
  const noCanal = contarNoCanal(brutos);
  if (linhas.length === 0) return { ok: true, importadas: 0, jaEstavam: noCanal, noCanal };

  const importadas = await inserirSemDuplicar(admin, linhas);
  return { ok: true, importadas, jaEstavam: noCanal - importadas, noCanal };
}

/**
 * Lote primeiro; se o lote bate no `unique (organization_id, external_id)` (o
 * webhook gravou uma delas entre a leitura e a escrita), linha a linha, pulando a
 * repetida. Não dá para usar `on conflict`: medido em 22/10/2026, a constraint é
 * DEFERRABLE e o Postgres recusa ("ON CONFLICT does not support deferrable
 * unique constraints") — o lote inteiro falha e nada é gravado.
 */
async function inserirSemDuplicar(admin: SupabaseClient, linhas: Record<string, unknown>[]): Promise<number> {
  const lote = await admin.from("messages").insert(linhas).select("id");
  if (!lote.error) return lote.data?.length ?? 0;
  if (lote.error.code !== "23505") throw new Error(`historico_insert_falhou: ${lote.error.message}`);
  let gravadas = 0;
  for (const linha of linhas) {
    const { error } = await admin.from("messages").insert(linha);
    if (!error) gravadas++;
    else if (error.code !== "23505") throw new Error(`historico_insert_falhou: ${error.message}`);
  }
  return gravadas;
}
