import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { perfilDoRecorte, type LinhaDoRecorte } from "@/lib/datajud/recorte";
import { textoDoPerfil, travaDaJurimetria } from "@/lib/datajud/trava";

/**
 * Issue #91 — o laudo do perfil do juízo na tela.
 *
 * A tela não escreve frase com número: mostra o texto de `textoDoPerfil`, que a
 * trava da 0007.E6 aprova, só destacando os números (critério 1: N ao lado de
 * todo número; critério 8: filtro e data da coleta; critério 6: sem magistrado).
 *
 * Mutações (21/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - a tela reescrever o texto (perder "de N processos" ao destacar o número);
 *   - não separar os dois lados (órgão e demais) em blocos;
 *   - trocar de recorte sem mudar a URL.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/app/juizo" }));

const { LaudoDoJuizo } = await import("@/app/app/juizo/_components/LaudoDoJuizo");

const linha = (orgao: number, codigo: number, nome: string): LinhaDoRecorte => ({
  data_ajuizamento: "2025-01-01T00:00:00.000Z",
  data_ajuizamento_bruto: "20250101000000",
  nivel_sigilo: 0,
  orgao_julgador_codigo: orgao,
  orgao_julgador_nome: nome,
  classe_codigo: 7,
  movimentos: [{ codigo, nome: "x", dataHora: "2025-07-01T00:00:00.000Z" }],
});
const RECORTES = [
  { id: "r1", rotulo: "Cível TJSP · 1ª Vara", tribunal: "tjsp", classe_codigo: 7, assunto_codigo: null, orgao_julgador_codigo: 1, ultima_coleta_em: "2026-10-19T08:00:00Z" },
  { id: "r2", rotulo: "Cível TJSP · 2ª Vara", tribunal: "tjsp", classe_codigo: 7, assunto_codigo: null, orgao_julgador_codigo: 2, ultima_coleta_em: "2026-10-19T08:00:00Z" },
];
const TEXTO = textoDoPerfil(
  perfilDoRecorte({
    filtro: { rotulo: "Cível TJSP · 1ª Vara", tribunal: "tjsp", classe_codigo: 7, assunto_codigo: null, orgao_julgador_codigo: 1 },
    coletadoEm: "2026-10-19T08:00:00Z",
    linhas: [
      ...Array.from({ length: 40 }, (_, i) => linha(1, i < 20 ? 219 : 220, "1ª Vara Cível")),
      ...Array.from({ length: 35 }, () => linha(2, 220, "2ª Vara Cível")),
    ],
    hoje: new Date("2026-10-20T12:00:00Z"),
  }),
);

describe("o laudo", () => {
  afterEach(cleanup);

  it("mostra o texto aprovado pela trava, inteiro, com os dois lados em blocos", () => {
    render(<LaudoDoJuizo recortes={RECORTES} escolhido="r1" texto={TEXTO} aviso={null} erroDeLeitura={false} />);
    const laudo = screen.getByTestId("laudo");
    // Nenhuma palavra do texto se perde: o título é o que vem antes de ": ", e o resto
    // da linha de abertura vira a primeira medida (com a inicial maiúscula).
    const nu = (x: string) => x.replace(/[:\s]/g, "").toLowerCase();
    const [cabecalho, ...resto] = TEXTO.split("\n");
    for (const l of resto) expect(nu(laudo.textContent ?? "")).toContain(nu(l));
    // Rótulo e data já estão no título da folha: aparecem UMA vez, e o resto do cabeçalho fica.
    expect(laudo.textContent?.split("Cível TJSP · 1ª Vara").length).toBe(2);
    expect(laudo.textContent?.split("19/10/2026").length).toBe(2);
    expect(cabecalho).toContain("tribunal TJSP");
    expect(laudo.textContent).toContain("Tribunal TJSP");
    expect(travaDaJurimetria(laudo.textContent ?? "").liberado).toBe(true);
    const blocos = laudo.querySelectorAll("section h3");
    expect([...blocos].map((h) => h.textContent)).toEqual(["Órgão 1ª Vara Cível", "Demais 1 órgãos do tribunal, mesma classe"]);
    // O ordinal não é medida: o "1" de "1ª Vara" não ganha destaque.
    const destaques = [...laudo.querySelectorAll("strong")].map((x) => x.textContent);
    expect(destaques).not.toContain("1");
    // O intervalo sai inteiro: os dois extremos de "entre X e Y dias" em destaque.
    expect(destaques.filter((x) => x === "181").length).toBeGreaterThanOrEqual(3);
    expect(laudo.textContent).toContain("Coleta do DataJud de 19/10/2026");
    expect(laudo.querySelectorAll("strong").length).toBeGreaterThan(5);
  });

  it("trocar de recorte muda a URL (a página relê no servidor)", () => {
    render(<LaudoDoJuizo recortes={RECORTES} escolhido="r1" texto={TEXTO} aviso={null} erroDeLeitura={false} />);
    fireEvent.change(screen.getByLabelText("Recorte"), { target: { value: "r2" } });
    expect(push).toHaveBeenCalledWith("/app/juizo?recorte=r2");
  });

  it("sem recorte coletado, diz o que é um recorte em vez de tela vazia", () => {
    render(<LaudoDoJuizo recortes={[]} escolhido={null} texto={null} aviso={null} erroDeLeitura={false} />);
    expect(screen.getByTestId("sem-recortes").textContent).toContain("Nenhum recorte do DataJud foi coletado ainda.");
  });

  it("recorte sem órgão julgador avisa que não há o que comparar", () => {
    render(<LaudoDoJuizo recortes={RECORTES} escolhido="r1" texto={null} aviso="sem_orgao" erroDeLeitura={false} />);
    expect(screen.getByText(/não fixa um órgão julgador/)).toBeTruthy();
  });
});
