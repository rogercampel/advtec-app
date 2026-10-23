import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConferenciaDaContagem } from "@/app/app/publicacoes/_components/ConferenciaDaContagem";
import type { PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { confereContagem } from "@/lib/djen/conferencia";

/**
 * 0006.E5 (#27) — a conferência da contagem na tela. A tela mostra o número; ela
 * só fala em "confiar" depois de 30 dias em paralelo SEM divergência.
 * Sugestão contada à mão: disp. qui 22/10/2026, 5 dias úteis → vence sex 30/10.
 */

const TEXTO = "Manifeste-se no prazo de 5 (cinco) dias úteis.";
const pub = (id: string, venceEm: string, confirmadoEm: string): PublicacaoDaCaixa => ({
  id,
  organizationId: "org",
  numeroProcesso: `proc-${id}`,
  dataDisponibilizacao: "2026-10-22",
  tipoComunicacao: "Intimação",
  siglaTribunal: "TJSP",
  nomeOrgao: null,
  texto: TEXTO,
  descartadaEm: null,
  prazoConfirmado: { venceEm, confirmadoEm, observacao: null },
});

describe("conferência da contagem na tela", () => {
  afterEach(cleanup);

  it("sem confirmação: diz que a conferência começa na primeira", () => {
    render(<ConferenciaDaContagem conferencia={confereContagem([], "2026-10-23")} />);
    expect(screen.getByTestId("conferencia-da-contagem").textContent).toMatch(/Nenhum prazo confirmado ainda/);
  });

  it("mostra os dias de paralelo, o placar e a divergência sem aviso marcada como data errada", () => {
    const c = confereContagem([pub("a", "2026-10-30", "2026-10-13T15:00:00Z"), pub("b", "2026-11-03", "2026-10-20T15:00:00Z")], "2026-10-23");
    render(<ConferenciaDaContagem conferencia={c} />);
    const texto = screen.getByTestId("conferencia-da-contagem").textContent ?? "";
    expect(texto).toContain("10 de 30 dias em paralelo ao controle do escritório, desde 13/10/2026.");
    expect(texto).toContain("2 prazos confirmados: 1 iguais à sugestão, 1 com data errada sem aviso, 0 diferentes com aviso, 0 sem contagem possível.");
    expect(screen.getByTestId("divergencia").textContent).toBe("proc-b · sugerida 30/10/2026, confirmada 03/11/2026 (+4 dias) · data errada sem aviso");
    expect(texto).toMatch(/Só depois de 30 dias em paralelo, com ao menos 20 prazos comparados e nenhuma divergência/);
    expect(screen.getByTestId("comparados").textContent).toBe("2 comparados (mínimo 20).");
  });

  const limpas = (n: number, desde: string) => Array.from({ length: n }, (_, i) => pub(`l${i}`, "2026-10-30", i === 0 ? `${desde}T15:00:00Z` : "2026-10-21T15:00:00Z"));
  const texto = () => screen.getByTestId("conferencia-da-contagem").textContent ?? "";

  it("30 dias, 20 comparados e nenhuma divergência: só então fala em começar a conversa sobre confiar", () => {
    render(<ConferenciaDaContagem conferencia={confereContagem(limpas(20, "2026-09-20"), "2026-10-23")} />);
    expect(texto()).toMatch(/30 dias em paralelo, 20 prazos comparados ou mais e nenhuma divergência: o escritório pode começar a conversa/);
    expect(screen.getByTestId("comparados").textContent).toBe("20 comparados (mínimo 20).");
  });

  it("um prazo só há 31 dias NÃO basta: a frase de confiar não aparece", () => {
    render(<ConferenciaDaContagem conferencia={confereContagem(limpas(1, "2026-09-22"), "2026-10-23")} />);
    expect(texto()).toContain("30 de 30 dias em paralelo");
    expect(texto()).not.toMatch(/pode começar a conversa/);
    expect(screen.getByTestId("comparados").textContent).toBe("1 comparados (mínimo 20).");
  });

  it("só 'sem contagem possível': nada comparado, nada de confiar", () => {
    const REMISSAO = "DESPACHO. Decorreu o prazo previsto no §2º do art. 903 do CPC; intime-se.";
    const sem = Array.from({ length: 25 }, (_, i) => ({ ...pub(`s${i}`, "2026-11-05", i === 0 ? "2026-09-22T15:00:00Z" : "2026-10-21T15:00:00Z"), texto: REMISSAO }));
    render(<ConferenciaDaContagem conferencia={confereContagem(sem, "2026-10-23")} />);
    expect(texto()).toContain("25 sem contagem possível");
    expect(screen.getByTestId("comparados").textContent).toBe("0 comparados (mínimo 20).");
    expect(texto()).not.toMatch(/pode começar a conversa/);
  });

  it("com divergência, nem depois de 30 dias e 20 comparados", () => {
    const suja = [...limpas(20, "2026-09-20"), pub("b", "2026-11-03", "2026-10-20T15:00:00Z")];
    render(<ConferenciaDaContagem conferencia={confereContagem(suja, "2026-10-23")} />);
    expect(texto()).not.toMatch(/pode começar a conversa/);
  });

  it("leitura cortada pelo teto: avisa que é parcial e nunca fala em confiar", () => {
    render(<ConferenciaDaContagem conferencia={confereContagem(limpas(20, "2026-09-20"), "2026-10-23", { cortada: true })} />);
    expect(screen.getByTestId("conferencia-cortada").textContent).toBe("Leitura parcial: só as 20 confirmações mais recentes.");
    expect(texto()).not.toMatch(/pode começar a conversa/);
    cleanup();
    render(<ConferenciaDaContagem conferencia={confereContagem(limpas(20, "2026-09-20"), "2026-10-23")} />);
    expect(screen.queryByTestId("conferencia-cortada")).toBeNull();
  });
});
