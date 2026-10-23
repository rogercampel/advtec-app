import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

/*
 * 0006.E4 (#21), critério 5 — "Contagem sugerida sempre aparece rotulada como
 * sugestão, com o raciocínio visível. Nenhuma tela apresenta prazo como fato
 * confirmado antes de alguém confirmar." Teste de interface, não de intenção.
 * Datas contadas à mão: disponibilizada ter 20/10 → publicada qua 21/10 → começa
 * qui 22/10 → 15 dias úteis vencem qua 11/11 (Finados, 02/11, no caminho).
 */
describe("critério 5 da 0006 — a contagem sugerida na pauta", () => {
  afterEach(cleanup);
  const REMISSAO = "DESPACHO. Decorreu o prazo previsto no §2º do art. 903 do CPC; intime-se.";

  it("mostra o vencimento sugerido, rotulado como sugestão, com o feriado e o aviso geral à mostra", () => {
    const p = montaPauta([pub("hoje", "2026-10-20")], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} />);
    const bloco = screen.getByTestId("contagem-sugerida");
    const texto = bloco.textContent ?? "";
    expect(texto).toContain("Contagem sugerida: vence em 11/11/2026 (qua)");
    expect(texto).toMatch(/sugestão do sistema, confira antes de confirmar/);
    expect(texto).toContain("02/11/2026 é feriado nacional (Finados) e NÃO foi descontado.");
    expect(texto).toMatch(/Feriados locais e móveis, suspensões de expediente e prazo em dobro não entram na conta/);
  });

  it("a conta passo a passo está na tela, do DJEN ao vencimento", () => {
    const p = montaPauta([pub("hoje", "2026-10-20")], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} />);
    const passos = [...screen.getByTestId("contagem-sugerida").querySelectorAll("details li")].map((li) => li.textContent);
    expect(passos).toEqual([
      "Disponibilizada no DJEN em 20/10/2026 (ter).",
      "Considerada publicada no 1º dia útil seguinte: 21/10/2026 (qua).",
      "O prazo começa no 1º dia útil depois da publicação: 22/10/2026 (qui).",
      "15 dias úteis, contando o dia do início: o último é 11/11/2026 (qua).",
    ]);
  });

  it("prazo sem número no texto: nenhuma data, só o pedido de conferência", () => {
    const p = montaPauta([pub("hoje", "2026-10-20", REMISSAO)], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} />);
    const bloco = screen.getByTestId("contagem-sugerida");
    expect(bloco.textContent).toMatch(/Sem contagem sugerida/);
    expect(bloco.textContent).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("a sugestão não vira vencimento: nenhum grupo de 'vence' aparece, e o campo de confirmação nasce vazio", () => {
    const p = montaPauta([pub("hoje", "2026-10-20")], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} podeAgir />);
    expect(screen.queryByText(/^Vence hoje/)).toBeNull();
    expect(screen.queryByText(/^Vence em/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar prazo" }));
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe("");
  });
});

describe("critério 5 da 0006 — corrido que termina no fim de semana", () => {
  afterEach(cleanup);

  it("a tela diz que caiu no fim de semana e passou para o dia útil seguinte", () => {
    // ter 20/10 → publicada qua 21/10 → começa qui 22/10 → 3 corridos: 22, 23, sáb 24 → seg 26/10.
    const p = montaPauta([pub("hoje", "2026-10-20", "DESPACHO. Manifeste-se no prazo de 3 dias corridos.")], [caso], HOJE);
    render(<PautaDeHoje hoje={p.hoje} chegouDesdeOntem={p.chegouDesdeOntem} pendentes={[]} cortada={false} />);
    const bloco = screen.getByTestId("contagem-sugerida");
    expect(bloco.textContent).toContain("Contagem sugerida: vence em 26/10/2026 (seg)");
    const passos = [...bloco.querySelectorAll("details li")].map((li) => li.textContent);
    expect(passos.slice(-2)).toEqual([
      "3 dias corridos, contando o dia do início: o último é 24/10/2026 (sáb).",
      "Caiu em fim de semana: passa para o próximo dia útil, 26/10/2026 (seg).",
    ]);
  });
});
