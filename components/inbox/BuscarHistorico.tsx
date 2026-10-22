"use client";

/**
 * AdvTec: "Buscar mensagens anteriores no WhatsApp". Aparece no topo do fio
 * quando já não há página mais antiga no CRM. Chama a importação sob demanda
 * (`POST /api/v1/conversations/[id]/historico`) e recarrega o fio.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export function BuscarHistorico({ conversationId }: { conversationId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () =>
      apiClient.post<{ data: { importadas: number; ja_estavam: number; no_canal: number } }>(`/api/v1/conversations/${conversationId}/historico`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", conversationId] }),
    onError: (err) => showApiError(err),
  });
  const r = m.data?.data;

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <Button size="sm" variant="ghost" onClick={() => m.mutate()} disabled={m.isPending}>
        {m.isPending ? t("Buscando no WhatsApp…") : t("Buscar mensagens anteriores no WhatsApp")}
      </Button>
      {r && (
        <p role="status" className="text-xs text-muted-foreground">
          {/* Três respostas diferentes: "zero" sozinho não diz se o WhatsApp não tinha nada ou se já estava tudo aqui. */}
          {r.no_canal === 0
            ? t("O WhatsApp não tem mensagens guardadas deste contato.")
            : r.importadas === 0
              ? t("Tudo o que o WhatsApp guardou deste contato já está aqui.")
              : `${t("Mensagens trazidas do WhatsApp:")} ${r.importadas}`}
        </p>
      )}
    </div>
  );
}
