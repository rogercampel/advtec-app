"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiClient } from "@/lib/api/client";
import type { PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { CAMPO_DO_PROCESSO } from "@/lib/djen/caixa";
import { legivel } from "@/lib/djen/ler";
import { useT } from "@/hooks/i18n/useT";

export type NegocioParaLigar = { id: string; titulo: string; numeroProcesso: string | null };
export type FunilParaCriar = { id: string; nome: string; etapas: Array<{ id: string; nome: string }> };

type Props = {
  podeAgir: boolean;
  naoReconhecidas: PublicacaoDaCaixa[];
  totalReconhecidas: number;
  descartadas: number;
  erroDeLeitura: boolean;
  negocios: NegocioParaLigar[];
  funis: FunilParaCriar[];
  /** A pauta de hoje (E3), entre o cabeçalho e a caixa. */
  children?: ReactNode;
};

const TRECHO = 360;

export function PublicacoesClient(props: Props) {
  const t = useT();
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("Publicações")}</h1>
        <p className="text-sm text-muted-foreground">
          {t(
            "Intimações do DJEN das OABs monitoradas. As que não casam com nenhum caso do escritório ficam aqui até alguém decidir — nada é descartado sozinho.",
          )}
        </p>
      </header>

      {props.erroDeLeitura && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {t("Não foi possível ler as publicações agora. Recarregue a página; se continuar, avise o administrador.")}
        </p>
      )}

      {props.children}

      <section aria-labelledby="t-caixa" className="space-y-3">
        <h2 id="t-caixa" className="text-lg font-medium">
          {t("Não reconhecidas ({n})").replace("{n}", String(props.naoReconhecidas.length))}
        </h2>
        {props.naoReconhecidas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {(props.descartadas > 0
              ? t('Nenhuma publicação esperando decisão. {n} já estão ligadas a casos e {d} foram marcadas como "não é nossa".')
              : t("Nenhuma publicação esperando decisão. {n} já estão ligadas a casos.")
            )
              .replace("{n}", String(props.totalReconhecidas))
              .replace("{d}", String(props.descartadas))}
          </p>
        ) : (
          <ul className="space-y-3">
            {props.naoReconhecidas.map((p) => (
              <ItemDaCaixa key={p.id} pub={p} {...props} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Acao = "ligar" | "criar" | "descartar" | null;

function ItemDaCaixa({ pub, podeAgir, negocios, funis }: Props & { pub: PublicacaoDaCaixa }) {
  const t = useT();
  const router = useRouter();
  const [acao, setAcao] = useState<Acao>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [negocioId, setNegocioId] = useState("");
  const [funilId, setFunilId] = useState(funis[0]?.id ?? "");
  const [motivo, setMotivo] = useState("");

  const texto = legivel(pub.texto);
  const numero = pub.numeroProcesso ?? "";

  async function executa(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      setAcao(null);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não deu certo. Tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  const anotaNumero = (leadId: string) =>
    apiClient.patch(`/api/v1/leads/${leadId}`, { custom_fields: { [CAMPO_DO_PROCESSO]: numero } });

  return (
    <li className="space-y-2 rounded-md border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{pub.numeroProcesso ?? t("Sem número de processo")}</span>
        <span className="text-muted-foreground">
          {[pub.siglaTribunal, pub.nomeOrgao, pub.tipoComunicacao, pub.dataDisponibilizacao].filter(Boolean).join(" · ")}
        </span>
      </div>
      <p className="whitespace-pre-line text-sm">
        {texto.length > TRECHO ? `${texto.slice(0, TRECHO)}…` : texto}
      </p>

      {podeAgir && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={!numero || ocupado} onClick={() => setAcao("ligar")}>
            {t("Ligar a um caso")}
          </Button>
          <Button size="sm" variant="secondary" disabled={!numero || ocupado || funis.length === 0} onClick={() => setAcao("criar")}>
            {t("Criar caso")}
          </Button>
          <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setAcao("descartar")}>
            {t("Não é nossa")}
          </Button>
        </div>
      )}
      {podeAgir && !numero && (
        <p className="text-xs text-muted-foreground">
          {t('Sem número de processo, a publicação não liga a caso: abra o texto completo no DJEN ou marque como "não é nossa".')}
        </p>
      )}

      {acao === "ligar" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor={`negocio-${pub.id}`}>
            {t("Caso")}
          </label>
          <select
            id={`negocio-${pub.id}`}
            className="rounded-md border px-2 py-1 text-sm"
            value={negocioId}
            onChange={(e) => setNegocioId(e.target.value)}
          >
            <option value="">{t("Escolha o negócio…")}</option>
            {negocios.map((n) => (
              <option key={n.id} value={n.id}>
                {n.numeroProcesso
                  ? t("{titulo} — já tem {numero}").replace("{titulo}", n.titulo).replace("{numero}", n.numeroProcesso)
                  : n.titulo}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!negocioId || ocupado} onClick={() => executa(() => anotaNumero(negocioId))}>
            {t("Vincular ao caso")}
          </Button>
        </div>
      )}

      {acao === "criar" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm" htmlFor={`funil-${pub.id}`}>
            {t("Funil")}
          </label>
          <select
            id={`funil-${pub.id}`}
            className="rounded-md border px-2 py-1 text-sm"
            value={funilId}
            onChange={(e) => setFunilId(e.target.value)}
          >
            {funis.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={ocupado || !funis.find((f) => f.id === funilId)?.etapas[0]}
            onClick={() =>
              executa(async () => {
                const etapa = funis.find((f) => f.id === funilId)?.etapas[0];
                if (!etapa) throw new Error(t("Esse funil não tem etapa aberta."));
                const criado = await apiClient.post<{ data: { id: string } }>("/api/v1/leads", {
                  pipeline_id: funilId,
                  stage_id: etapa.id,
                  title: t("Processo {n}").replace("{n}", numero),
                  source: "djen",
                });
                await anotaNumero(criado.data.id);
              })
            }
          >
            {t("Criar caso com este número")}
          </Button>
        </div>
      )}

      {acao === "descartar" && (
        <div className="space-y-2">
          <label className="block text-sm" htmlFor={`motivo-${pub.id}`}>
            {t("Por que não é do escritório?")}
          </label>
          <Textarea
            id={`motivo-${pub.id}`}
            value={motivo}
            maxLength={300}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={t("Ex.: homônimo da OAB, processo de outro escritório")}
          />
          <Button
            size="sm"
            disabled={motivo.trim().length < 3 || ocupado}
            onClick={() => executa(() => apiClient.post(`/api/v1/djen/publicacoes/${pub.id}/descartar`, { motivo }))}
          >
            {t("Marcar como não é nossa")}
          </Button>
        </div>
      )}

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
    </li>
  );
}
