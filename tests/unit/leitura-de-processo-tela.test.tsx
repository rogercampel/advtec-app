import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { LeituraDeProcesso, type LeituraNaLista } from "@/app/app/leitura/_components/LeituraDeProcesso";

/**
 * Ticket 0003.E6 (#41) — a tela da leitura.
 *
 * Critério 7 na tela: a estimativa (páginas, minutos, custo) aparece ANTES de
 * qualquer leitura, e "Ler o processo" só existe depois dela. Critério 5: o PDF
 * escaneado mostra o motivo da recusa. E a lista: "lendo" se atualiza sozinha;
 * "falhou" diz o motivo; só "pronta" abre o documento.
 */

const estimativa = { paginas: 34, minutos: 2, dolaresPelaChave: 0.004, paginasSemTexto: [] as number[] };
const respostas: Array<{ status: number; corpo: unknown }> = [];
const enviados: FormData[] = [];

beforeEach(() => {
  respostas.length = 0;
  enviados.length = 0;
  refresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: FormData }) => {
      enviados.push(init.body);
      const r = respostas.shift() ?? { status: 500, corpo: {} };
      return { ok: r.status < 400, status: r.status, json: async () => r.corpo } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const pdf = () => new File(["%PDF-1.7"], "processo.pdf", { type: "application/pdf" });
const escolhe = () => fireEvent.change(screen.getByLabelText(/PDF do processo/), { target: { files: [pdf()] } });

describe("critério 7: a estimativa vem antes da leitura", () => {
  it("escolher o PDF só estima — o primeiro envio não confirma — e o botão aparece depois", async () => {
    respostas.push({ status: 200, corpo: { data: { estimativa } } });
    render(<LeituraDeProcesso podeLer leituras={[]} />);
    expect(screen.queryByRole("button", { name: "Ler o processo" })).toBeNull();
    escolhe();
    await waitFor(() => expect(screen.getByTestId("estimativa").textContent).toMatch(/34 páginas · cerca de 2 min/));
    expect(screen.getByTestId("estimativa").textContent).toMatch(/US\$ 0\.00 pela chave de API/);
    expect(enviados[0]!.get("confirmar")).toBeNull();
    expect(screen.getByRole("button", { name: "Ler o processo" })).toBeTruthy();
  });

  it("confirmar envia com confirmar=1 e atualiza a lista", async () => {
    respostas.push({ status: 200, corpo: { data: { estimativa } } }, { status: 200, corpo: { data: { id: "x", estimativa } } });
    render(<LeituraDeProcesso podeLer leituras={[]} />);
    escolhe();
    fireEvent.click(await screen.findByRole("button", { name: "Ler o processo" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(enviados[1]!.get("confirmar")).toBe("1");
  });

  it("folhas digitalizadas aparecem na estimativa como 'não serão lidas'", async () => {
    respostas.push({ status: 200, corpo: { data: { estimativa: { ...estimativa, paginasSemTexto: [7, 8] } } } });
    render(<LeituraDeProcesso podeLer leituras={[]} />);
    escolhe();
    expect(await screen.findByText("Folhas digitalizadas sem texto não serão lidas: 7, 8.")).toBeTruthy();
  });
});

describe("critério 5: PDF escaneado mostra o motivo", () => {
  it("a recusa da rota aparece como alerta, e não há botão de ler", async () => {
    respostas.push({ status: 422, corpo: { error: { message: "o PDF não tem camada de texto (provavelmente é digitalização)" } } });
    render(<LeituraDeProcesso podeLer leituras={[]} />);
    escolhe();
    expect((await screen.findByRole("alert")).textContent).toMatch(/camada de texto/);
    expect(screen.queryByRole("button", { name: "Ler o processo" })).toBeNull();
  });
});

describe("a lista de leituras", () => {
  const leituras: LeituraNaLista[] = [
    { id: "a", arquivo: "pronto.pdf", paginas: 34, estado: "pronta", motivo: null, criadaEm: "2026-10-21T12:00:00Z" },
    { id: "b", arquivo: "lendo.pdf", paginas: 400, estado: "lendo", motivo: null, criadaEm: "2026-10-21T12:00:00Z" },
    { id: "c", arquivo: "falhou.pdf", paginas: 12, estado: "falhou", motivo: "Error: 429", criadaEm: "2026-10-21T12:00:00Z" },
  ];

  it("só a pronta abre o documento; a que falhou diz o motivo", () => {
    render(<LeituraDeProcesso podeLer leituras={leituras} />);
    expect(screen.getByRole("link", { name: "pronto.pdf" }).getAttribute("href")).toBe("/app/leitura/a");
    expect(screen.queryByRole("link", { name: "lendo.pdf" })).toBeNull();
    expect(screen.getByText(/falhou: Error: 429/)).toBeTruthy();
  });

  it("enquanto houver leitura 'lendo', a lista se atualiza sozinha; sem nenhuma, não", () => {
    vi.useFakeTimers();
    const { unmount } = render(<LeituraDeProcesso podeLer leituras={leituras} />);
    act(() => vi.advanceTimersByTime(10_000));
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    refresh.mockClear();
    render(<LeituraDeProcesso podeLer leituras={[leituras[0]!]} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("quem só vê não envia processo", () => {
    render(<LeituraDeProcesso podeLer={false} leituras={[]} />);
    expect((screen.getByLabelText(/PDF do processo/) as HTMLInputElement).disabled).toBe(true);
  });
});
