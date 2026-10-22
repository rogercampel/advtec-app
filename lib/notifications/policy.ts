export function shouldNotifyInbound(input: {
  direction?: string | null;
  conversationId?: string | null;
  openConversationId?: string | null;
  tabFocused: boolean;
  tipo?: unknown;
  /** `messages.metadata` da linha. AdvTec: histórico importado é passado, não "nova mensagem". */
  metadata?: unknown;
}): boolean {
  if (input.tipo === "reassinado") return false;
  if ((input.metadata as { historico_importado?: unknown } | null | undefined)?.historico_importado === true) return false;
  if (input.direction !== "inbound") return false;
  if (!input.conversationId) return false;
  if (input.tabFocused && input.openConversationId === input.conversationId) return false;
  return true;
}
