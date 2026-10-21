import { readFileSync } from "node:fs";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import type { ProcessoNoEspelho } from "@/lib/acervo/desfecho-das-pecas";
import { pesquisaNoAcervo, type ResultadoDaPesquisa } from "@/lib/acervo/pesquisa";
import { travaDaTese } from "@/lib/acervo/trava-da-tese";

/**
 * Issue #90 — a pesquisa no acervo, da composição à tela.
 *
 * Critério 3 da 0004 (todo trecho com documento e página), critério 4 (matéria
 * ausente → frase fixa), critérios 6 e 7 (o texto do sistema nunca chama tese de
 * jurisprudência nem prevê), e N + data da consulta em todo desfecho (critério 8).
 *
 * Mutações (21/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - passar ao espelho o número formatado em vez dos 20 dígitos;
 *   - esconder as notas de margem (fontes) na tela;
 *   - mostrar o desfecho sem o N ("5 procedentes");
 *   - um rótulo da tela dizendo "jurisprudência do escritório".
 */

const apiPost = vi.fn();
vi.mock("@/lib/api/client", () => ({ apiClient: { post: (...a: unknown[]) => apiPost(...a) } }));

const { PesquisaNoAcervo } = await import("@/app/app/acervo/_components/PesquisaNoAcervo");

const NUM = "1002288-81.2025.8.26.0565";
const PRESCRICAO = "A pretensão do autor está fulminada pela prescrição trienal prevista no artigo 206 do Código Civil, pois a ação foi proposta tarde.";
const hit = (content: string, doc: string, pagina: number, processo?: string) => ({
  chunk_id: content + doc, knowledge_source_id: "f", source_name: "Acervo", content, similarity: 0.8,
  metadata: { documento: doc, nome: `${doc}.pdf`, pagina_inicial: pagina, pagina_final: pagina, ...(processo ? { processo } : {}) },
});

describe("a composição", () => {
  it("busca → teses → desfecho, e o espelho é pedido pelos 20 dígitos", async () => {
    const buscar: Buscador = async () => ({ ok: true, results: [hit(PRESCRICAO, "contestacao-a", 3, NUM), hit(`${PRESCRICAO} `, "contestacao-b", 7)] });
    const espelhoDe = vi.fn(async (): Promise<ProcessoNoEspelho[]> => [
      { numero_processo: NUM.replace(/\D/g, ""), nivel_sigilo: 0, data_ajuizamento: "2024-01-01T00:00:00Z", data_ajuizamento_bruto: "20240101000000",
        movimentos: [{ codigo: 219, nome: "Procedência", dataHora: "2025-01-01T00:00:00.000Z" }], coletado_em: "2026-10-19T08:00:00Z" },
    ]);
    const r = await pesquisaNoAcervo({ buscar, organizationId: "o", fontes: ["f"], problema: "prescrição", espelhoDe });
    expect(espelhoDe).toHaveBeenCalledWith([NUM.replace(/\D/g, "")]);
    expect(r).toMatchObject({ situacao: "encontrado" });
    if (r.situacao !== "encontrado") return;
    expect(r.teses).toHaveLength(1);
    expect(r.teses[0]!.fontes.map((f) => f.citacao)).toEqual(["contestacao-a.pdf, p. 3", "contestacao-b.pdf, p. 7"]);
    expect(r.teses[0]!.desfecho).toMatchObject({ n: 1, procedencia: { n: 1, de: 1 }, fora: { pecasSemProcesso: 1 } });
  });

  it("nada acima do limiar: a frase fixa, sem tese nenhuma", async () => {
    const r = await pesquisaNoAcervo({ buscar: async () => ({ ok: true, results: [] }), organizationId: "o", fontes: ["f"], problema: "usucapião", espelhoDe: async () => [] });
    expect(r).toEqual({ situacao: "nada_no_acervo", mensagem: "Não há nada no acervo do escritório sobre isso." });
  });
});

describe("a tela", () => {
  beforeEach(() => apiPost.mockReset());
  afterEach(cleanup);

  const resposta = (data: ResultadoDaPesquisa) => apiPost.mockResolvedValueOnce({ data });
  const pergunta = async (texto: string) => {
    fireEvent.change(screen.getByLabelText("Problema do caso"), { target: { value: texto } });
    fireEvent.click(screen.getByRole("button", { name: "Pesquisar" }));
  };

  it("a folha mostra o trecho literal, as fontes numeradas na margem e o desfecho com N e data", async () => {
    resposta({
      situacao: "encontrado",
      teses: [
        {
          trecho: PRESCRICAO,
          fontes: [{ citacao: "contestacao-a.pdf, p. 3", processo: NUM }, { citacao: "contestacao-b.pdf, p. 7", processo: null }],
          desfecho: {
            n: 7, procedencia: { n: 5, de: 7, percentual: null }, improcedencia: { n: 1, de: 7, percentual: null },
            procedencia_parcial: { n: 1, de: 7, percentual: null }, casosInsuficientes: true,
            consultadoEm: { de: "2026-10-19T08:00:00Z", ate: "2026-10-19T08:00:00Z" },
            fora: { pecasSemProcesso: 1, semEspelho: 0, descartados: 0, semDesfecho: 0 },
          },
        },
        { trecho: "Não houve dano moral.", fontes: [{ citacao: "replica.pdf, p. 2", processo: null }],
          desfecho: { n: 0, procedencia: { n: 0, de: 0, percentual: null }, improcedencia: { n: 0, de: 0, percentual: null },
            procedencia_parcial: { n: 0, de: 0, percentual: null }, casosInsuficientes: true, consultadoEm: null,
            fora: { pecasSemProcesso: 1, semEspelho: 0, descartados: 0, semDesfecho: 0 } } },
      ],
    });
    render(<PesquisaNoAcervo podePesquisar />);
    await pergunta("prescrição da cobrança");

    const folha = await screen.findByTestId("folha-da-tese");
    expect(folha.textContent).toContain(PRESCRICAO);
    const notas = screen.getAllByTestId("nota-de-margem");
    expect(notas.map((n) => n.textContent)).toEqual([`1contestacao-a.pdf, p. 3${NUM}`, "2contestacao-b.pdf, p. 7"]);
    const desfecho = screen.getByTestId("desfecho");
    expect(desfecho.textContent).toContain("5 de 7 terminaram em procedência.");
    expect(desfecho.querySelector("[role=img]")).toBeNull(); // amostra pequena: sem barra de proporção
    expect(desfecho.textContent).toContain("Consulta ao DataJud de 19/10/2026.");
    expect(desfecho.textContent).toContain("Casos insuficientes para percentual");
    expect(screen.getByText("Tese 1 de 2")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("navigation", { name: "Outras teses" })).getByRole("button", { name: "2" }));
    await waitFor(() => expect(screen.getByTestId("folha-da-tese").textContent).toContain("Não houve dano moral."), { timeout: 5000 });
    expect(screen.getByTestId("desfecho").textContent).toContain("Nenhum processo destas peças com desfecho");
  });

  it("critério 4: matéria ausente mostra a frase fixa", async () => {
    resposta({ situacao: "nada_no_acervo", mensagem: "Não há nada no acervo do escritório sobre isso." });
    render(<PesquisaNoAcervo podePesquisar />);
    await pergunta("usucapião de imóvel rural");
    expect((await screen.findByTestId("nada-no-acervo")).textContent).toBe("Não há nada no acervo do escritório sobre isso.");
  });

  it("erro da rota aparece como alerta, com a mensagem", async () => {
    apiPost.mockRejectedValueOnce(new Error("A pesquisa precisa de uma chave de embedding em Credenciais."));
    render(<PesquisaNoAcervo podePesquisar />);
    await pergunta("qualquer problema");
    expect((await screen.findByRole("alert")).textContent).toContain("chave de embedding");
  });

  it("sem papel para pesquisar, o botão fica desligado e a tela diz por quê", () => {
    render(<PesquisaNoAcervo podePesquisar={false} />);
    expect((screen.getByRole("button", { name: "Pesquisar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/pode ver, mas não pesquisar/)).toBeTruthy();
  });
});

describe("critérios 6 e 7: todo texto fixo da tela passa pelas travas da tese", () => {
  it("varredura dos rótulos de PesquisaNoAcervo", () => {
    const fonte = readFileSync("app/app/acervo/_components/PesquisaNoAcervo.tsx", "utf8");
    const rotulos = [...fonte.matchAll(/\bt\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]!);
    expect(rotulos.length).toBeGreaterThan(20);
    const recusados = rotulos.filter((r) => !travaDaTese(r).liberado);
    expect(recusados).toEqual([]);
  });

  it("controle negativo: a varredura pega um rótulo proibido", () => {
    expect(travaDaTese("Jurisprudência do escritório").liberado).toBe(false);
  });
});
