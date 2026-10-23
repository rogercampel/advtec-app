"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { apiClient } from "@/lib/api/client";
import { useT } from "@/hooks/i18n/useT";

/*
 * MINUTA PARA CONFERÊNCIA — spec 0005.E2 (#37). O advogado pede a peça, deixa de
 * fora a peça que ele mesmo escreveu (o gabarito), e lê cada bloco com a origem:
 * documento e página, ou "texto novo". Baixa o arquivo e edita onde já edita.
 * Os campos lidos da rota são declarados aqui, sem importar `lib/acervo/minuta`:
 * quem importa a minuta passa pela trava de releitura da 0005.E5.
 */

type Bloco = { texto: string; fontes: string[]; novo: boolean };
type MinutaDaRota =
  | { situacao: "minuta"; aviso: string; blocos: Bloco[]; faltou: string[]; fontes: Array<{ id: string; citacao: string }> }
  | { situacao: "sem_base"; mensagem: string; faltou: string[] };
type Resposta = { minuta: MinutaDaRota; arquivo: string | null };

type Estado =
  | { fase: "parado" }
  | { fase: "escrevendo" }
  | { fase: "pronto"; pedido: string; resposta: Resposta }
  | { fase: "erro"; mensagem: string };

export function MinutaParaConferencia({ podeEscrever }: { podeEscrever: boolean }) {
  const t = useT();
  const [pedido, setPedido] = useState("");
  const [fora, setFora] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });

  async function escreve(e: FormEvent) {
    e.preventDefault();
    const texto = pedido.trim();
    if (texto.length < 10) return;
    setEstado({ fase: "escrevendo" });
    try {
      const deixar_de_fora = fora.split(",").map((s) => s.trim()).filter((s) => s.length >= 3);
      const r = await apiClient.post<{ data: Resposta }>("/api/v1/acervo/minutas", { pedido: texto, deixar_de_fora });
      setEstado({ fase: "pronto", pedido: texto, resposta: r.data });
    } catch (err) {
      setEstado({ fase: "erro", mensagem: err instanceof Error ? err.message : t("Não foi possível escrever a minuta agora. Tente de novo.") });
    }
  }

  function baixa(arquivo: string) {
    const url = URL.createObjectURL(new Blob([arquivo], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "minuta-rascunho.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="t-minuta" className="mx-auto max-w-3xl space-y-4 px-4 pb-10 sm:px-6">
      <header className="space-y-1">
        <h2 id="t-minuta" className="text-xl font-semibold tracking-tight">
          {t("Minuta para conferência")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("O sistema escreve um rascunho a partir das peças do escritório. Cada bloco mostra de onde veio; o que não tem origem aparece como texto novo. A revisão é do advogado.")}
        </p>
      </header>
      <form onSubmit={escreve} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t("Peça pedida")}</span>
          <textarea
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            maxLength={2000}
            rows={3}
            disabled={!podeEscrever}
            placeholder={t("Ex.: contestação de reclamação trabalhista com pedido de horas extras; o cliente é a empresa")}
            className="w-full rounded-md border bg-card p-3 text-base placeholder:text-muted-foreground"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("Deixar de fora os documentos cujo nome contém (separe por vírgula)")}</span>
          <input
            value={fora}
            onChange={(e) => setFora(e.target.value)}
            maxLength={600}
            disabled={!podeEscrever}
            placeholder={t("Ex.: contestação Silva, inicial Souza")}
            className="h-10 w-full rounded-md border bg-card px-3 text-base placeholder:text-muted-foreground"
          />
        </label>
        <Button type="submit" disabled={!podeEscrever || pedido.trim().length < 10 || estado.fase === "escrevendo"}>
          {estado.fase === "escrevendo" ? t("Escrevendo…") : t("Escrever minuta")}
        </Button>
        {!podeEscrever && <p className="text-sm text-muted-foreground">{t("Seu papel nesta organização pode ver, mas não escrever minuta.")}</p>}
      </form>

      {estado.fase === "erro" && (
        <p role="alert" className="text-sm text-destructive">
          {estado.mensagem}
        </p>
      )}
      {estado.fase === "pronto" && estado.resposta.minuta.situacao === "sem_base" && (
        <div className="space-y-2 rounded-md border bg-card p-4 text-sm" data-testid="minuta-sem-base">
          <p className="font-medium">{estado.resposta.minuta.mensagem}</p>
          {estado.resposta.minuta.faltou.length > 0 && (
            <ul className="list-disc pl-5 text-muted-foreground">
              {estado.resposta.minuta.faltou.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {estado.fase === "pronto" && estado.resposta.minuta.situacao === "minuta" && (
        <MinutaNaTela minuta={estado.resposta.minuta} arquivo={estado.resposta.arquivo} baixa={baixa} />
      )}
    </section>
  );
}

function MinutaNaTela({
  minuta,
  arquivo,
  baixa,
}: {
  minuta: Extract<MinutaDaRota, { situacao: "minuta" }>;
  arquivo: string | null;
  baixa: (arquivo: string) => void;
}) {
  const t = useT();
  const citacaoDe = new Map(minuta.fontes.map((f) => [f.id, f.citacao]));
  return (
    <article className="space-y-4 rounded-md border bg-card p-4" data-testid="minuta">
      <p className="rounded-md border border-dashed p-3 text-sm font-medium">{minuta.aviso}</p>
      {minuta.blocos.map((b, i) => (
        <div key={i} className="space-y-1" data-testid="bloco-da-minuta">
          <p className="whitespace-pre-line">{b.texto}</p>
          <p className={b.novo ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
            {b.novo
              ? t("Texto novo: sem apoio em peça do escritório. Confira com atenção.")
              : t("Origem: {fontes}").replace("{fontes}", b.fontes.map((id) => citacaoDe.get(id) ?? id).join("; "))}
          </p>
        </div>
      ))}
      <div className="space-y-1">
        <h3 className="font-medium">{t("O que faltou")}</h3>
        {minuta.faltou.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nada: todo bloco tem origem no acervo.")}</p>
        ) : (
          <ul className="list-disc pl-5 text-sm" data-testid="o-que-faltou">
            {minuta.faltou.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        )}
      </div>
      {arquivo && (
        <Button type="button" variant="secondary" onClick={() => baixa(arquivo)}>
          {t("Baixar o rascunho (.md)")}
        </Button>
      )}
    </article>
  );
}
