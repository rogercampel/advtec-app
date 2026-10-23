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
    expect(texto).toMatch(/Só depois de 30 dias em paralelo sem divergência/);
  });

  it("30 dias sem divergência: só então fala em começar a conversa sobre confiar", () => {
    const limpa = confereContagem([pub("a", "2026-10-30", "2026-09-20T15:00:00Z")], "2026-10-23");
    render(<ConferenciaDaContagem conferencia={limpa} />);
    expect(screen.getByTestId("conferencia-da-contagem").textContent).toMatch(/30 dias em paralelo sem divergência: o escritório pode começar a conversa/);
    cleanup();
    // Com divergência, nem depois de 30 dias.
    const suja = confereContagem([pub("a", "2026-10-30", "2026-09-20T15:00:00Z"), pub("b", "2026-11-03", "2026-10-20T15:00:00Z")], "2026-10-23");
    render(<ConferenciaDaContagem conferencia={suja} />);
    expect(screen.getByTestId("conferencia-da-contagem").textContent).not.toMatch(/pode começar a conversa/);
  });
});
