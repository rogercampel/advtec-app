"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiClient } from "@/lib/api/client";
import { diaNoForo } from "@/lib/djen/coletar";
import { contaPrazo } from "@/lib/djen/contagem";
import { legivel, type PrazoLido } from "@/lib/djen/ler";
import { JANELA_DO_VENCIDO, type LinhaDaPauta } from "@/lib/djen/pauta";
import { useT } from "@/hooks/i18n/useT";

type Props = {
  hoje: string;
  venceHoje?: LinhaDaPauta[];
  venceNaSemana?: LinhaDaPauta[];
  venceDepois?: LinhaDaPauta[];
  venceu?: LinhaDaPauta[];
  chegouDesdeOntem: LinhaDaPauta[];
  pendentes: LinhaDaPauta[];
  /** A leitura bateu no teto: pode haver publicação mais antiga fora da tela. */
  cortada: boolean;
  /** `agent` ou acima: mostra "Confirmar prazo". A rota cobra o papel de novo. */
  podeAgir?: boolean;
};

/** `YYYY-MM-DD` → `dd/mm/aaaa`, sem passar por fuso. */
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Momento (timestamptz) → dia no foro: 22h30 de 21/10 em Brasília é 21/10, não o 22/10 do UTC. */
const diaBr = (momento: string) => dataBr(diaNoForo(new Date(momento)));

/**
 * A pauta de hoje (spec 0009.E3 e 0006.E5). Prazo lido do texto diz "sugerido"
 * e mostra o trecho que o fundamenta (critério 3). Só a data que alguém do
 * escritório DIGITOU e confirmou aparece como data — nos grupos de vencimento.
 */
export function PautaDeHoje({
  hoje,
  venceHoje = [],
  venceNaSemana = [],
  venceDepois = [],
  venceu = [],
  chegouDesdeOntem,
  pendentes,
  cortada,
  podeAgir = false,
}: Props) {
  const t = useT();
  const temConfirmado = venceHoje.length + venceNaSemana.length + venceDepois.length + venceu.length > 0;
  return (
    <section aria-labelledby="t-pauta" className="space-y-4">
      <div className="space-y-1">
        <h2 id="t-pauta" className="text-lg font-medium">
          {t("Pauta de hoje ({dia})").replace("{dia}", hoje)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "A contagem sugerida é uma conta do sistema, com feriados e suspensões do tribunal fora dela. Só a data confirmada por alguém do escritório aparece como vencimento. Continue com o seu controle atual enquanto o escritório confere a pauta.",
          )}
        </p>
        {cortada && (
          <p className="text-sm text-muted-foreground">
            {t("Há mais publicações do que cabem nesta tela; as mais antigas não estão listadas.")}
          </p>
        )}
      </div>

      {temConfirmado && (
        <>
          {venceu.length > 0 && (
            <Grupo
              id="t-venceu"
              titulo={t("Venceu nos últimos {d} dias ({n})")
                .replace("{d}", String(JANELA_DO_VENCIDO))
                .replace("{n}", String(venceu.length))}
              vazio=""
              linhas={venceu}
              podeAgir={podeAgir}
            />
          )}
          <Grupo
            id="t-vence-hoje"
            titulo={t("Vence hoje ({n})").replace("{n}", String(venceHoje.length))}
            vazio={t("Nenhum prazo confirmado vence hoje.")}
            linhas={venceHoje}
            podeAgir={podeAgir}
          />
          <Grupo
            id="t-vence-semana"
            titulo={t("Vence nos próximos 7 dias ({n})").replace("{n}", String(venceNaSemana.length))}
            vazio={t("Nenhum prazo confirmado vence nos próximos 7 dias.")}
            linhas={venceNaSemana}
            podeAgir={podeAgir}
          />
          {venceDepois.length > 0 && (
            <Grupo
              id="t-vence-depois"
              titulo={t("Confirmados que vencem depois ({n})").replace("{n}", String(venceDepois.length))}
              vazio=""
              linhas={venceDepois}
              podeAgir={podeAgir}
            />
          )}
        </>
      )}
      <Grupo
        id="t-chegou"
        titulo={t("Chegou desde ontem ({n})").replace("{n}", String(chegouDesdeOntem.length))}
        vazio={t("Nada novo desde ontem nos casos do escritório.")}
        linhas={chegouDesdeOntem}
        podeAgir={podeAgir}
      />
      <Grupo
        id="t-pendentes"
        titulo={t("Pendente de confirmação ({n})").replace("{n}", String(pendentes.length))}
        vazio={t("Nenhum prazo sugerido esperando confirmação.")}
        linhas={pendentes}
        podeAgir={podeAgir}
      />
    </section>
  );
}

function Grupo({
  id,
  titulo,
  vazio,
  linhas,
  podeAgir,
}: {
  id: string;
  titulo: string;
  vazio: string;
  linhas: LinhaDaPauta[];
  podeAgir: boolean;
}) {
  return (
    <div aria-labelledby={id} role="group" className="space-y-2">
      <h3 id={id} className="font-medium">
        {titulo}
      </h3>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <ul className="space-y-2">
          {linhas.map((l) => (
            <LinhaDaPautaItem key={l.publicacao.id} linha={l} podeAgir={podeAgir} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LinhaDaPautaItem({ linha, podeAgir }: { linha: LinhaDaPauta; podeAgir: boolean }) {
  const t = useT();
  const p = linha.publicacao;
  const confirmado = p.prazoConfirmado ?? null;
  const grifo = linha.prazosSugeridos[0]?.trecho ?? linha.tipoDeAto?.trecho ?? null;
  return (
    <li className="space-y-1 rounded-md border p-3 text-sm" data-testid="linha-da-pauta">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{p.numeroProcesso}</span>
        <span className="text-muted-foreground">
          {[
            linha.tipoDeAto?.tipo ?? t("ato não identificado"),
            p.siglaTribunal,
            p.dataDisponibilizacao,
            linha.diasNaPauta === 0
              ? t("hoje")
              : linha.diasNaPauta === 1
                ? t("há 1 dia")
                : t("há {n} dias").replace("{n}", String(linha.diasNaPauta)),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      {confirmado ? (
        <p data-testid="prazo-confirmado">
          <span className="font-medium">{t("Vence em {data}").replace("{data}", dataBr(confirmado.venceEm))}</span>{" "}
          <span className="text-muted-foreground">
            {t("· data confirmada pelo escritório em {data}").replace("{data}", diaBr(confirmado.confirmadoEm))}
            {confirmado.observacao ? ` · ${confirmado.observacao}` : ""}
          </span>
        </p>
      ) : (
        linha.prazosSugeridos.map((prazo, i) => (
          <div key={i} className="space-y-1">
            <p>
              <span className="font-medium">{rotuloDoPrazo(prazo, t)}</span>{" "}
              <q className="italic text-muted-foreground">{prazo.trecho}</q>
            </p>
            <ContagemDoPrazo disponibilizada={p.dataDisponibilizacao} prazo={prazo} />
          </div>
        ))
      )}
      {podeAgir && (confirmado || linha.prazosSugeridos.length > 0) && (
        <ConfirmarPrazo id={p.id} corrigir={Boolean(confirmado)} />
      )}
      <details>
        <summary className="cursor-pointer text-muted-foreground">{t("Abrir publicação")}</summary>
        <p className="mt-2 whitespace-pre-line">
          <TextoGrifado texto={legivel(p.texto)} grifo={grifo} />
        </p>
      </details>
    </li>
  );
}

/**
 * A data final é DIGITADA por quem conferiu no próprio controle. A contagem
 * sugerida (0006.E4) NÃO pré-preenche o campo: copiar a sugestão não é conferir.
 */
function ConfirmarPrazo({ id, corrigir }: { id: string; corrigir: boolean }) {
  const t = useT();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [venceEm, setVenceEm] = useState("");
  const [observacao, setObservacao] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!aberto) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setAberto(true)}>
        {corrigir ? t("Corrigir a data") : t("Confirmar prazo")}
      </Button>
    );
  }

  async function confirma() {
    setOcupado(true);
    setErro(null);
    try {
      await apiClient.post(`/api/v1/djen/publicacoes/${id}/confirmar-prazo`, {
        vence_em: venceEm,
        observacao: observacao.trim() || undefined,
      });
      setAberto(false);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : t("Não deu certo. Tente de novo."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-sm">
        <span className="block">{t("Data final, conferida no seu controle")}</span>
        <Input type="date" value={venceEm} onChange={(e) => setVenceEm(e.target.value)} className="w-44" />
      </label>
      <label className="min-w-48 flex-1 space-y-1 text-sm">
        <span className="block">{t("Observação (opcional)")}</span>
        <Input value={observacao} maxLength={300} onChange={(e) => setObservacao(e.target.value)} />
      </label>
      <Button size="sm" disabled={!venceEm || ocupado} onClick={confirma}>
        {t("Confirmar")}
      </Button>
      <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => setAberto(false)}>
        {t("Cancelar")}
      </Button>
      {erro && (
        <p role="alert" className="w-full text-sm text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}

const diaDaSemana = (iso: string, t: (s: string) => string) =>
  [t("dom"), t("seg"), t("ter"), t("qua"), t("qui"), t("sex"), t("sáb")][new Date(`${iso}T12:00:00Z`).getUTCDay()];
const dataComDia = (iso: string, t: (s: string) => string) => `${dataBr(iso)} (${diaDaSemana(iso, t)})`;

/**
 * Contagem SUGERIDA (0006.E4, critério 5): rotulada como sugestão, os avisos
 * sempre à mostra, e a conta passo a passo em "Como foi contada".
 */
function ContagemDoPrazo({ disponibilizada, prazo }: { disponibilizada: string; prazo: PrazoLido }) {
  const t = useT();
  const c = contaPrazo(disponibilizada, prazo);
  if (c.situacao === "sem_data") {
    return (
      <p className="text-muted-foreground" data-testid="contagem-sugerida">
        {t("Sem contagem sugerida: o texto não diz quantos dias. Confira no processo.")}
      </p>
    );
  }
  const avisos = [
    ...(c.declarada ? [] : [t("O texto não diz se são dias úteis ou corridos: contado em dias úteis, a regra geral do CPC.")]),
    ...c.feriados.map((f) =>
      t("{data} é feriado nacional ({nome}) e NÃO foi descontado.").replace("{data}", dataBr(f.data)).replace("{nome}", f.nome),
    ),
    ...(c.recesso ? [t("O prazo passa pelo recesso de 20/12 a 20/01, que NÃO foi descontado.")] : []),
    t("Feriados locais e móveis, suspensões de expediente e prazo em dobro não entram na conta."),
  ];
  const passos = [
    t("Disponibilizada no DJEN em {data}.").replace("{data}", dataComDia(c.disponibilizada, t)),
    t("Considerada publicada no 1º dia útil seguinte: {data}.").replace("{data}", dataComDia(c.publicada, t)),
    t("O prazo começa no 1º dia útil depois da publicação: {data}.").replace("{data}", dataComDia(c.inicio, t)),
    (c.contagem === "util"
      ? t("{n} dias úteis, contando o dia do início: o último é {data}.")
      : t("{n} dias corridos, contando o dia do início: o último é {data}.")
    )
      .replace("{n}", String(c.dias))
      .replace("{data}", dataComDia(c.ultimoDia, t)),
    ...(c.vence !== c.ultimoDia
      ? [t("Caiu em fim de semana: passa para o próximo dia útil, {data}.").replace("{data}", dataComDia(c.vence, t))]
      : []),
  ];
  return (
    <div className="space-y-1 rounded-md border border-dashed p-2" data-testid="contagem-sugerida">
      <p>
        <span className="font-medium">{t("Contagem sugerida: vence em {data}").replace("{data}", dataComDia(c.vence, t))}</span>{" "}
        <span className="text-muted-foreground">{t("· sugestão do sistema, confira antes de confirmar")}</span>
      </p>
      <ul className="list-disc pl-5 text-muted-foreground">
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-muted-foreground">{t("Como foi contada")}</summary>
        <ol className="mt-1 list-decimal pl-5">
          {passos.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function rotuloDoPrazo(prazo: PrazoLido, t: (s: string) => string): string {
  if (prazo.dias === null) return t("Prazo sugerido, sem número no texto:");
  const modelo =
    prazo.contagem === "util"
      ? t("Prazo sugerido: {n} dias úteis, a confirmar:")
      : prazo.contagem === "corrido"
        ? t("Prazo sugerido: {n} dias corridos, a confirmar:")
        : t("Prazo sugerido: {n} dias, a confirmar:");
  return modelo.replace("{n}", String(prazo.dias));
}

/** O trecho é substring do texto legível (contrato de `lib/djen/ler.ts`). */
function TextoGrifado({ texto, grifo }: { texto: string; grifo: string | null }) {
  const i = grifo ? texto.indexOf(grifo) : -1;
  if (!grifo || i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark>{grifo}</mark>
      {texto.slice(i + grifo.length)}
    </>
  );
}
