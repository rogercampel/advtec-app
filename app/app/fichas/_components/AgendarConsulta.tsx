"use client";

/**
 * Agendar a consulta a partir da ficha do caso (0001.E4). Usa a MESMA rota da
 * agenda (`POST /api/v1/agenda/agendamentos`), com o contato do caso: as regras de
 * horário, conflito e lembrete continuam todas lá, nenhuma é refeita aqui.
 */
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

export type TipoDeConsulta = { id: string; name: string };

export function AgendarConsulta({
  contatoId,
  conversaId,
  titulo,
  tipos,
}: {
  contatoId: string;
  conversaId: string | null;
  titulo: string;
  tipos: TipoDeConsulta[];
}) {
  const t = useT();
  const router = useRouter();
  const [tipo, setTipo] = useState(tipos[0]?.id ?? "");
  const [quando, setQuando] = useState("");
  const [estado, setEstado] = useState<{ fase: "parado" | "enviando" | "feito" } | { fase: "erro"; mensagem: string }>({ fase: "parado" });

  if (tipos.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("Cadastre um tipo de compromisso na Agenda para agendar a consulta por aqui.")}</p>;
  }

  async function agendar(e: FormEvent) {
    e.preventDefault();
    if (!tipo || !quando) return;
    setEstado({ fase: "enviando" });
    const res = await fetch("/api/v1/agenda/agendamentos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type_id: tipo,
        // `datetime-local` vem no fuso do navegador; `toISOString` leva o instante certo.
        starts_at: new Date(quando).toISOString(),
        contact_id: contatoId,
        ...(conversaId ? { conversation_id: conversaId } : {}),
        title: titulo,
      }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      setEstado({ fase: "erro", mensagem: json.error?.message || t("Não foi possível agendar.") });
      return;
    }
    setEstado({ fase: "feito" });
    setQuando("");
    router.refresh();
  }

  return (
    <form onSubmit={agendar} className="flex flex-wrap items-end gap-3" aria-label={t("Agendar consulta")}>
      <label className="space-y-1 text-sm">
        <span className="block">{t("Tipo")}</span>
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-md border bg-background px-2 py-1.5">
          {tipos.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span className="block">{t("Data e hora")}</span>
        <input type="datetime-local" required value={quando} onChange={(e) => setQuando(e.target.value)} className="rounded-md border bg-background px-2 py-1.5" />
      </label>
      <Button type="submit" disabled={estado.fase === "enviando"}>
        {estado.fase === "enviando" ? t("Agendando…") : t("Agendar consulta")}
      </Button>
      {estado.fase === "feito" && <p className="w-full text-sm text-muted-foreground">{t("Consulta agendada.")}</p>}
      {estado.fase === "erro" && (
        <p role="alert" className="w-full text-sm text-destructive">
          {estado.mensagem}
        </p>
      )}
    </form>
  );
}
