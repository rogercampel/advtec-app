/**
 * Spec 0001.E3, critério 8 — a regra pura do nome (a parte de banco está em
 * `tests/invariants/triagem-juridica.test.ts`).
 *
 * MUTAÇÕES (23/10/2026; aplicadas, acusadas, desfeitas):
 *   - trocar a comparação de igualdade por `includes` → "Ana" × "Mariana" acusa;
 *   - tirar a exigência do mesmo último nome → "João Carlos Silva" × "João Pedro Souza" acusa;
 *   - não descartar partículas → "Maria da Silva" × "Maria Silva" deixa de combinar e acusa.
 */
import { describe, expect, it } from "vitest";

import { nomesCombinam, palavrasDoNome } from "./conflito";

describe("nomesCombinam", () => {
  it.each([
    ["Maria da Silva Souza", "MARIA DA SILVA SOUZA", "igual"],
    ["José d'Ávila", "jose davila", null], // pontuação cola a palavra: não é o mesmo nome escrito
    ["João  Pereira", "joao pereira", "igual"],
    ["Conceição Alves", "Conceicao Alves", "igual"],
    ["Maria da Silva", "Maria Silva", "igual"], // partícula não conta
    ["João Silva", "João Carlos Silva", "parecido"],
    ["João Carlos Silva", "João Silva", "parecido"],
    ["Ana Paula de Souza Lima", "Ana Lima", "parecido"],
    ["João Carlos", "João Carlos Silva", "parecido"],
  ] as const)("%s × %s = %s", (a, b, esperado) => {
    expect(nomesCombinam(a, b)).toBe(esperado);
  });

  it.each([
    ["Ana", "Mariana"],
    ["Ana", "Ana Paula Souza"], // nome solto não identifica ninguém
    ["Silva", "Maria Silva"],
    ["João Carlos Silva", "João Pedro Souza"],
    ["João Carlos Silva", "Pedro Carlos Silva"],
    ["Maria Souza", "Maria Silva"],
    ["Ana Paula", "Paula Ana"],
    ["João Carlos", "João Pedro Carlos Silva"], // Carlos no meio de um lado e sobrenome do outro: não dá para afirmar
    ["", "Maria"],
    ["???", "Maria"],
  ])("%s × %s não combinam", (a, b) => {
    expect(nomesCombinam(a, b)).toBeNull();
  });
});

describe("palavrasDoNome", () => {
  it("sem acento, caixa, pontuação e partículas", () => {
    expect(palavrasDoNome("  José DE Souza-Lima, Jr. ")).toEqual(["jose", "souza", "lima", "jr"]);
  });
});
