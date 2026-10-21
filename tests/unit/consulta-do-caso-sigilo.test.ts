import { describe, expect, it } from "vitest";

import { marcadoComoSigiloso, textoFalaDeSigilo } from "@/lib/djen/consulta-do-caso";

/**
 * Spec 0010.E4: a marca de sigilo falha fechado, e só o "não" explícito libera.
 * Mutação (20/10/2026): fazer `marcadoComoSigiloso` devolver `valor === true`
 * derruba os casos "sim", "S", 1 e {}.
 */
describe("marcadoComoSigiloso", () => {
  it.each([true, "true", "sim", "S", "Sim", 1, {}, "segredo"])("%j conta como sigilo", (v) => {
    expect(marcadoComoSigiloso(v)).toBe(true);
  });
  it.each([undefined, null, false, 0, "", "  ", "false", "não", "Nao", "N", "0"])("%j não é sigilo", (v) => {
    expect(marcadoComoSigiloso(v)).toBe(false);
  });
});

describe("textoFalaDeSigilo", () => {
  it.each([
    "Processo em SEGREDO DE JUSTIÇA.",
    "tramita em segredo de justi&ccedil;a",
    "Autos sigilosos. Intime-se.",
  ])("%s", (t) => expect(textoFalaDeSigilo(t)).toBe(true));

  it("controle: despacho comum não fecha", () => {
    expect(textoFalaDeSigilo("DESPACHO. Cite-se a parte ré.")).toBe(false);
  });
});
