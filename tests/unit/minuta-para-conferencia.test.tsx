import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Buscador } from "@/lib/acervo/busca-por-problema";
import { novoRegistroDoFiltro, semOsDocumentos } from "@/lib/acervo/buscador-da-sessao";
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

  const nomes = (r: Awaited<ReturnType<Buscador>>) => (r.ok ? r.results.map((h) => (h.metadata as { nome: string }).nome) : r);
  const com = (...docs: string[]) => vi.fn<Buscador>(async () => ({ ok: true, results: docs.map(hit) }) as never);

  it.each([
    ["Contestacao_Silva.pdf", "contestação silva"], // sem acento e com _ no arquivo, termo com acento e espaço
    ["Contestação Silva.PDF", "contestacao_silva"], // o contrário
    ["Contestação-Silva (final).docx", "CONTESTAÇÃO  SILVA"], // hífen, espaços duplos, caixa
    ["contestação Silva.pdf", "contestação silva"], // NFD (cedilha e til soltos), como o macOS grava
    ["Contestação Silva.pdf", "contestação silva"], // termo digitado em NFD
    ["Contestacao.Silva.pdf", "silva pdf"], // ponto vira espaço
  ])("o nome %j é achado pelo termo %j (normaliza os dois lados)", async (doc, termo) => {
    const r = await semOsDocumentos(com(doc, "Modelo.pdf"), [termo])(q);
    expect(nomes(r)).toEqual(["Modelo.pdf"]);
  });

  it("termo que não é parte do nome não tira nada", async () => {
    expect(nomes(await semOsDocumentos(com("Contestação Silva.pdf"), ["souza"])(q))).toEqual(["Contestação Silva.pdf"]);
  });

  it("pede o triplo ao buscador e corta para o top-k DEPOIS de filtrar", async () => {
    const muitos = vi.fn<Buscador>(async (consulta) => ({
      ok: true,
      results: [...Array.from({ length: 10 }, () => hit("Peça do advogado.pdf")), ...Array.from({ length: 5 }, (_, i) => hit(`Modelo ${i}.pdf`))].slice(0, consulta.topK),
    }) as never);
    const r = await semOsDocumentos(muitos, ["peça do advogado"])({ ...q, topK: 5 });
    expect(muitos.mock.calls[0]![0].topK).toBe(15);
    // Sem a folga, as 5 vagas seriam todas da peça excluída e a minuta ficaria sem nada.
    expect(nomes(r)).toEqual(["Modelo 0.pdf", "Modelo 1.pdf", "Modelo 2.pdf", "Modelo 3.pdf", "Modelo 4.pdf"]);
  });

  it("se o filtro tirar TODOS os trechos que vieram, é falha própria — não 'sem base no acervo'", async () => {
    const r = await semOsDocumentos(com("Contestação Silva.pdf"), ["silva"])(q);
    expect(r).toMatchObject({ ok: false, error: { code: "tudo_deixado_de_fora" } });
    // Busca que não trouxe nada não é culpa do filtro: continua vazia.
    expect(await semOsDocumentos(com(), ["silva"])(q)).toEqual({ ok: true, results: [] });
  });

  it("o registro diz quais documentos saíram e quais termos tiraram algo", async () => {
    const registro = novoRegistroDoFiltro();
    await semOsDocumentos(com("Contestacao_Silva.pdf", "Modelo.pdf"), ["contestação silva", " souza "], registro)(q);
    expect([...registro.documentos]).toEqual(["Contestacao_Silva.pdf"]);
    expect([...registro.termosComEfeito]).toEqual(["contestação silva"]);
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

  it("mostra o que o filtro deixou de fora e avisa do termo que não casou com nada", async () => {
    post.mockResolvedValue({
      data: { minuta: MINUTA, arquivo: minutaEmTexto(MINUTA, "x"), deixados_de_fora: ["Contestacao_Silva.pdf"], termos_sem_efeito: ["inicial souza"] },
    });
    render(<MinutaParaConferencia podeEscrever />);
    fireEvent.change(screen.getByPlaceholderText(/contestação de reclamação trabalhista/), { target: { value: "Contestação trabalhista de horas extras." } });
    fireEvent.change(screen.getByPlaceholderText(/contestação Silva/), { target: { value: "contestação silva, inicial souza" } });
    fireEvent.click(screen.getByRole("button", { name: "Escrever minuta" }));
    await waitFor(() => expect(screen.getByTestId("filtro-aplicado")).toBeTruthy());
    expect(screen.getByTestId("deixados-de-fora").textContent).toBe("Contestacao_Silva.pdf");
    expect(screen.getByTestId("termo-sem-efeito").textContent).toBe("Nenhum documento com “inicial souza” apareceu nesta busca — confira o nome.");
  });

  it("sem filtro nenhum, a caixa do filtro não aparece", async () => {
    post.mockResolvedValue({ data: { minuta: MINUTA, arquivo: null, deixados_de_fora: [], termos_sem_efeito: [] } });
    render(<MinutaParaConferencia podeEscrever />);
    fireEvent.change(screen.getByPlaceholderText(/contestação de reclamação trabalhista/), { target: { value: "Contestação trabalhista de horas extras." } });
    fireEvent.click(screen.getByRole("button", { name: "Escrever minuta" }));
    await waitFor(() => expect(screen.getByTestId("minuta")).toBeTruthy());
    expect(screen.queryByTestId("filtro-aplicado")).toBeNull();
  });

  it("quem só vê não escreve", () => {
    render(<MinutaParaConferencia podeEscrever={false} />);
    expect((screen.getByRole("button", { name: "Escrever minuta" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
