import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PautaDeHoje } from "@/app/app/publicacoes/_components/PautaDeHoje";
import { CAMPO_DO_PROCESSO, type PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { montaPauta } from "@/lib/djen/pauta";

/**
 * Ticket 0009.E3 — a pauta de hoje, sem contagem.
 *
 * Critério 3: nenhuma linha mostra prazo como fato — "sugerido" e o trecho em
 * toda linha não confirmada (nesta etapa, todas). Critério 4: prazo não
 * confirmado continua na pauta no dia seguinte, e no outro (relógio adiantado).
 *
 * Mutações feitas em 20/10/2026, cada uma derrubou ao menos um teste daqui:
 *   - `diasNaPauta <= 1` → `<= 0` (ontem sai de "chegou");
 *   - remover o `else if` das pendentes (prazo some no 2º dia);
 *   - corte de idade nas pendentes (`&& diasNaPauta < 3`);
 *   - rótulo sem "sugerido"; trecho não renderizado na linha;
 *   - trocar `caixa.reconhecidas` por todas (outra org / sem caso entra na pauta);
 *   - tirar a ordenação das pendentes; tirar o `<mark>`; esconder o aviso de corte.
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const OUTRA = "bbbbbbbb-0000-4000-8000-000000000002";
const NUM = "0001234-56.2026.8.26.0100";
const COM_PRAZO = "DESPACHO. Manifeste-se a parte autora no prazo de 15 (quinze) dias úteis sobre a contestação.";
const SEM_PRAZO = "Intimação da pauta de julgamento da sessão.";

const pub = (id: string, data: string, texto = COM_PRAZO, extra: Partial<PublicacaoDaCaixa> = {}): PublicacaoDaCaixa => ({
  id,
  organizationId: ORG,
  numeroProcesso: NUM,
  dataDisponibilizacao: data,
  tipoComunicacao: "Intimação",
  siglaTribunal: "TJSP",
  nomeOrgao: "3ª Vara Cível",
  texto,
  descartadaEm: null,
  ...extra,
});
const caso = { id: "n1", organization_id: ORG, title: "Caso", custom_fields: { [CAMPO_DO_PROCESSO]: NUM } };

/** 20/10/2026, 10h em Brasília. */
const HOJE = new Date("2026-10-20T13:00:00Z");
const maisDias = (n: number) => new Date(HOJE.getTime() + n * 86_400_000);

describe("agrupamento", () => {
  it("hoje e ontem entram em 'chegou desde ontem'; anteontem com prazo vai para pendentes", () => {
    const p = montaPauta([pub("hoje", "2026-10-20"), pub("ontem", "2026-10-19"), pub("ante", "2026-10-18")], [caso], HOJE);
    expect(p.hoje).toBe("2026-10-20");
    expect(p.chegouDesdeOntem.map((l) => l.publicacao.id).sort()).toEqual(["hoje", "ontem"]);
    expect(p.pendentes.map((l) => [l.publicacao.id, l.diasNaPauta])).toEqual([["ante", 2]]);
  });

  it("publicação antiga sem prazo não ocupa a pauta", () => {
    const p = montaPauta([pub("velha", "2026-10-10", SEM_PRAZO)], [caso], HOJE);
    expect(p.chegouDesdeOntem).toEqual([]);
    expect(p.pendentes).toEqual([]);
  });

  it("sem caso, de outra org ou descartada não entra na pauta — sem caso fica na caixa", () => {
    const p = montaPauta(
      [
        pub("sem-caso", "2026-10-20", COM_PRAZO, { numeroProcesso: "0009999-99.2026.8.26.0100" }),
        pub("outra-org", "2026-10-20", COM_PRAZO, { organizationId: OUTRA }),
        pub("descartada", "2026-10-20", COM_PRAZO, { descartadaEm: "2026-10-20T11:00:00Z" }),
      ],
      [caso],
      HOJE,
    );
    expect(p.chegouDesdeOntem).toEqual([]);
    expect(p.pendentes).toEqual([]);
    expect(p.naoReconhecidas.map((x) => x.id).sort()).toEqual(["outra-org", "sem-caso"]);
  });

  it("o dia é o do foro: 23h30 em Brasília ainda é o mesmo dia", () => {
    const p = montaPauta([pub("p", "2026-10-18")], [caso], new Date("2026-10-20T02:30:00Z"));
    expect(p.hoje).toBe("2026-10-19");
    expect(p.chegouDesdeOntem.map((l) => l.publicacao.id)).toEqual(["p"]);
  });
});

describe("critério 4 — prazo não confirmado não sai da pauta com o tempo", () => {
  it.each([1, 2, 3, 10, 30])("relógio %i dia(s) adiante: a publicação de hoje com prazo ainda está na pauta", (n) => {
    const p = montaPauta([pub("p", "2026-10-20")], [caso], maisDias(n));
    const todas = [...p.chegouDesdeOntem, ...p.pendentes];
    expect(todas.map((l) => [l.publicacao.id, l.diasNaPauta])).toEqual([["p", n]]);
    expect(todas[0]!.prazosSugeridos[0]).toMatchObject({ dias: 15, contagem: "util" });
  });

  it("quem espera há mais tempo aparece primeiro", () => {
    const p = montaPauta([pub("a", "2026-10-15"), pub("b", "2026-10-05"), pub("c", "2026-10-12")], [caso], HOJE);
    expect(p.pendentes.map((l) => l.publicacao.id)).toEqual(["b", "c", "a"]);
  });
});

describe("critério 3 — na tela, todo prazo diz 'sugerido' e mostra o trecho", () => {
  afterEach(cleanup);

  it("cada linha com prazo traz 'sugerido' e o trecho literal que o fundamenta", () => {
    const p = montaPauta(
      [pub("hoje", "2026-10-20"), pub("ante", "2026-10-17"), pub("so-ato", "2026-10-20", SEM_PRAZO)],
      [caso],
      HOJE,
    );
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={p.pendentes} cortada={false} />);

    const linhas = screen.getAllByTestId("linha-da-pauta");
    expect(linhas).toHaveLength(3);
    const comPrazo = [...p.chegouDesdeOntem, ...p.pendentes].filter((l) => l.prazosSugeridos.length > 0);
    expect(comPrazo).toHaveLength(2);
    for (const l of comPrazo) {
      const li = linhas.find((el) => el.textContent?.includes(l.prazosSugeridos[0]!.trecho));
      expect(li, "linha com o trecho do prazo").toBeDefined();
      expect(within(li!).getByText(/sugerido/i)).toBeTruthy();
      expect(li!.querySelector("q")?.textContent).toBe(l.prazosSugeridos[0]!.trecho);
    }
    // Controle: nenhum texto afirma prazo sem "sugerido" ao lado.
    for (const li of linhas) {
      const t = li.textContent ?? "";
      if (/\d+ dias/.test(t.split("Abrir publicação")[0]!)) expect(t).toMatch(/sugerido/i);
    }
  });

  it("abrir a publicação mostra o texto inteiro com o trecho grifado", () => {
    const p = montaPauta([pub("hoje", "2026-10-20")], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} />);
    const mark = screen.getByTestId("linha-da-pauta").querySelector("details mark");
    expect(mark?.textContent).toBe(p.chegouDesdeOntem[0]!.prazosSugeridos[0]!.trecho);
  });

  it("leitura cortada no teto avisa que há mais publicações", () => {
    render(<PautaDeHoje hoje="2026-10-20" chegouDesdeOntem={[]} pendentes={[]} cortada />);
    expect(screen.getByText(/mais antigas não estão listadas/)).toBeTruthy();
  });
});
