import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { semOsDocumentos } from "@/lib/acervo/buscador-da-sessao";
import { AVISO_DA_MINUTA, FALTOU_TEXTO_NOVO, type Minuta } from "@/lib/acervo/minuta";
import { minutaEmTexto, SEM_ORIGEM } from "@/lib/acervo/minuta-em-texto";

/**
 * 0005.E2 (#37) — a minuta para o advogado CONFERIR: o arquivo que ele baixa, o
 * filtro que deixa a peça dele fora do acervo, e a tela com a origem de cada bloco.
 */

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiClient: { post } }));

import { MinutaParaConferencia } from "@/app/app/acervo/_components/MinutaParaConferencia";

const MINUTA: Extract<Minuta, { situacao: "minuta" }> = {
  situacao: "minuta",
  aviso: AVISO_DA_MINUTA,
  blocos: [
    { texto: "DOS FATOS", fontes: ["T1"], novo: false },
    { texto: "Dos pedidos finais.", fontes: [], novo: true },
  ],
  faltou: [FALTOU_TEXTO_NOVO, "qualificação do autor"],
  fontes: [{ id: "T1", citacao: "Contestação Lima.pdf, p. 3", processo: null }],
  removidas: { fonte_inexistente: 0, numero_no_texto: 0, cara_de_citacao: 0, cita_invalida: 0, bloco_vazio: 0 },
};

describe("o arquivo da minuta", () => {
  const texto = minutaEmTexto(MINUTA, "Contestação trabalhista.");

  it("abre com RASCUNHO e o aviso de que a revisão é do advogado (critério 7)", () => {
    expect(texto.split("\n\n").slice(0, 2)).toEqual(["# MINUTA — RASCUNHO", `> ${AVISO_DA_MINUTA}`]);
  });

  it("cada bloco leva a origem, ou TEXTO NOVO (critério 2)", () => {
    expect(texto).toContain("DOS FATOS\n\n> Origem: Contestação Lima.pdf, p. 3");
    expect(texto).toContain(`Dos pedidos finais.\n\n> ${SEM_ORIGEM}`);
  });

  it("termina com o que faltou (critério 5); lista vazia diz que tudo tem origem", () => {
    expect(texto.trimEnd().endsWith(`## O que faltou\n\n- ${FALTOU_TEXTO_NOVO}\n- qualificação do autor`)).toBe(true);
    expect(minutaEmTexto({ ...MINUTA, faltou: [] }, "x")).toContain("- Nada: todo bloco tem origem no acervo.");
  });
});

describe("deixar de fora a peça do advogado", () => {
  const hit = (nome: string) => ({ content: "x", similarity: 0.9, metadata: { nome } });
  const busca = vi.fn<Buscador>(async () => ({ ok: true, results: [hit("Contestação Lima.pdf"), hit("Inicial SOUZA.pdf"), hit("Modelo.pdf")] }) as never);
  const q = { organizationId: "o", fontes: ["f"], query: "q", topK: 5, threshold: 0.5 };

  it("tira os trechos dos documentos cujo nome contém algum termo, sem caixa", async () => {
    const r = await semOsDocumentos(busca, ["lima", " souza "])(q);
    expect(r.ok && r.results.map((h) => (h.metadata as { nome: string }).nome)).toEqual(["Modelo.pdf"]);
  });

  it("sem termo, é a mesma busca; falha da busca passa como falha", async () => {
    expect(semOsDocumentos(busca, ["", " "])).toBe(busca);
    const caiu = vi.fn<Buscador>(async () => ({ ok: false, error: { code: "busca_falhou", message: "x" } }) as never);
    expect(await semOsDocumentos(caiu, ["lima"])(q)).toEqual({ ok: false, error: { code: "busca_falhou", message: "x" } });
  });
});

describe("a tela da minuta para conferência", () => {
  afterEach(() => {
    cleanup();
    post.mockReset();
  });

  it("pede com os documentos a deixar de fora e mostra aviso, origem, texto novo e o que faltou", async () => {
    post.mockResolvedValue({ data: { minuta: MINUTA, arquivo: minutaEmTexto(MINUTA, "x") } });
    render(<MinutaParaConferencia podeEscrever />);
    fireEvent.change(screen.getByPlaceholderText(/contestação de reclamação trabalhista/), { target: { value: "Contestação trabalhista de horas extras." } });
    fireEvent.change(screen.getByPlaceholderText(/contestação Silva/), { target: { value: "Lima, ab, Souza" } });
    fireEvent.click(screen.getByRole("button", { name: "Escrever minuta" }));
    await waitFor(() => expect(screen.getByTestId("minuta")).toBeTruthy());

    expect(post).toHaveBeenCalledWith("/api/v1/acervo/minutas", { pedido: "Contestação trabalhista de horas extras.", deixar_de_fora: ["Lima", "Souza"] });
    const minuta = screen.getByTestId("minuta").textContent ?? "";
    expect(minuta).toContain(AVISO_DA_MINUTA);
    const blocos = screen.getAllByTestId("bloco-da-minuta").map((b) => b.textContent);
    expect(blocos).toEqual(["DOS FATOSOrigem: Contestação Lima.pdf, p. 3", "Dos pedidos finais.Texto novo: sem apoio em peça do escritório. Confira com atenção."]);
    expect(screen.getByTestId("o-que-faltou").textContent).toContain("qualificação do autor");
    expect(screen.getByRole("button", { name: "Baixar o rascunho (.md)" })).toBeTruthy();
  });

  it("sem base no acervo: diz que não há base, e nenhuma minuta aparece (critério 3)", async () => {
    post.mockResolvedValue({ data: { minuta: { situacao: "sem_base", mensagem: "Não há base no acervo.", faltou: [] }, arquivo: null } });
    render(<MinutaParaConferencia podeEscrever />);
    fireEvent.change(screen.getByPlaceholderText(/contestação de reclamação trabalhista/), { target: { value: "Habeas corpus em matéria penal." } });
    fireEvent.click(screen.getByRole("button", { name: "Escrever minuta" }));
    await waitFor(() => expect(screen.getByTestId("minuta-sem-base")).toBeTruthy());
    expect(screen.queryByTestId("minuta")).toBeNull();
  });

  it("quem só vê não escreve", () => {
    render(<MinutaParaConferencia podeEscrever={false} />);
    expect((screen.getByRole("button", { name: "Escrever minuta" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
