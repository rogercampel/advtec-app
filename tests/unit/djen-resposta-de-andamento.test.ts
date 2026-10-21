import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import type { Andamento, ConsultaDoCaso } from "@/lib/djen/consulta-do-caso";
import { decideAndamento, montaTexto } from "@/lib/djen/resposta-de-andamento";

/**
 * Spec 0010.E3 — a resposta sobre andamento, assistida por padrão.
 *
 * Mutações (20/10/2026), cada uma derrubou ao menos um teste daqui:
 *   - tirar a linha da `perguntaDeMerito` (a resposta defere ao advogado e a
 *     trava deixaria sair);
 *   - tirar o `if (!data || !ato)` (linha sem data vira frase);
 *   - tirar a checagem de `sigiloso`; tirar a de mensagem vazia;
 *   - devolver `acao: "enviar"` em vez de "sugerir";
 *   - um chamador falso em `lib/followup/` (a varredura do critério 6 acusou).
 */

const CONTINUACAO = { primeiraResposta: false };
const NUM = "0001234-56.2026.8.26.0100";
const andamento = (extra: Partial<Andamento> = {}): Andamento => ({
  numeroProcesso: NUM,
  data: "2026-10-15",
  tipoDeAto: "despacho",
  trecho: "DESPACHO. Intime-se a parte autora",
  siglaTribunal: "TJSP",
  ...extra,
});
const consulta = (extra: Partial<ConsultaDoCaso> = {}): ConsultaDoCaso => ({
  casos: [{ id: "c1", titulo: "Caso", numeroProcesso: NUM, sigiloso: false }],
  andamentos: [andamento()],
  sigiloso: false,
  ...extra,
});

describe("critério 3: toda resposta sobre andamento cita data e tipo de ato", () => {
  it("a sugestão traz a data em DD/MM/AAAA, o ato e o processo", () => {
    const d = decideAndamento("Como está meu processo?", consulta(), CONTINUACAO);
    expect(d.acao).toBe("sugerir");
    if (d.acao !== "sugerir") return;
    expect(d.texto).toContain("15/10/2026: saiu um despacho no TJSP no processo 0001234-56.2026.8.26.0100.");
    expect(d.fundamentos).toEqual([andamento()]);
  });

  it("toda linha de movimentação tem data e ato", () => {
    const texto = montaTexto([andamento(), andamento({ data: "2026-10-01", tipoDeAto: "sentença" })])!;
    const linhas = texto.split("\n").filter((l) => l.startsWith("•"));
    expect(linhas).toHaveLength(2);
    for (const l of linhas) expect(l).toMatch(/^• \d{2}\/\d{2}\/\d{4}: saiu (um|uma) \S+/);
  });

  it("andamento sem data legível ou sem tipo de ato não vira frase", () => {
    expect(montaTexto([andamento({ data: "15/10/2026" }), andamento({ tipoDeAto: null })])).toBeNull();
    const d = decideAndamento("Como está meu processo?", consulta({ andamentos: [andamento({ tipoDeAto: null })] }), CONTINUACAO);
    expect(d).toEqual({ acao: "passar_para_humano", motivo: "sem_publicacao" });
  });

  it("a frase não interpreta nem prevê: só conta e manda ao advogado", () => {
    const texto = montaTexto([andamento({ tipoDeAto: "sentença" })])!;
    expect(texto).not.toMatch(/ganh|perd|favor|bem|mal|vai receber|chance/i);
    expect(texto).toMatch(/advogado responsável/);
  });
});

describe("critério 4: pergunta de mérito vai para humano, mesmo com publicação", () => {
  // As mesmas perguntas do corpus das travas (tests/unit/oab-travas.test.ts).
  it.each([
    "Eu ganho essa causa?",
    "Quanto eu vou receber?",
    "Tenho direito a alguma coisa?",
    "vale a pena entrar com processo?",
    "tenho chance nesse caso?",
    "quanto tempo demora pra receber?",
    "qual o valor da indenização?",
  ])("%s", (pergunta) => {
    expect(decideAndamento(pergunta, consulta(), CONTINUACAO)).toEqual({
      acao: "passar_para_humano",
      motivo: "pergunta_de_merito",
    });
  });

  it("quem pede humano é passado, sem frase", () => {
    expect(decideAndamento("quero falar com o advogado", consulta(), CONTINUACAO)).toMatchObject({
      motivo: "pediu_humano",
    });
  });
});

describe("os outros caminhos para humano", () => {
  it("critério 5: caso sigiloso", () => {
    expect(decideAndamento("Como está meu processo?", consulta({ sigiloso: true, andamentos: [] }), CONTINUACAO)).toEqual({
      acao: "passar_para_humano",
      motivo: "sigilo",
    });
  });

  it("critério 1: contato sem caso", () => {
    expect(decideAndamento("Como está meu processo?", consulta({ casos: [], andamentos: [] }), CONTINUACAO)).toEqual({
      acao: "passar_para_humano",
      motivo: "sem_caso",
    });
  });

  it("primeira resposta sem se identificar como máquina: a trava segura", () => {
    expect(decideAndamento("Como está meu processo?", consulta(), { primeiraResposta: true })).toEqual({
      acao: "passar_para_humano",
      motivo: "trava_da_oab",
    });
  });
});

describe("critério 6: sem mensagem do cliente, nenhum andamento sai", () => {
  it.each(["", "   ", "\n"])("mensagem %j vai para humano", (m) => {
    expect(decideAndamento(m, consulta(), CONTINUACAO)).toEqual({ acao: "passar_para_humano", motivo: "sem_mensagem" });
  });

  /**
   * Varredura: nenhum arquivo de produção chama a consulta ou a resposta, exceto
   * os da lista. Quem ligar ao agente acrescenta o caminho aqui, e o revisor vê
   * que ele é receptivo (turno de mensagem recebida), nunca follow-up ou campanha.
   */
  const PERMITIDOS: string[] = [
    // A ferramenta do agente: roda no turno de MENSAGEM RECEBIDA (inbound-turn) e
    // lê a pergunta do cliente desta conversa no banco — receptiva por construção.
    "lib/djen/ferramenta-do-agente.ts",
  ];
  const importa = (conteudo: string) => /@\/lib\/djen\/(consulta-do-caso|resposta-de-andamento)|\.\/(consulta-do-caso|resposta-de-andamento)/.test(conteudo);

  it("controle negativo: a varredura reconhece um import", () => {
    expect(importa('import { consultaDoCaso } from "@/lib/djen/consulta-do-caso";')).toBe(true);
    expect(importa('import { coleta } from "@/lib/djen/coletar";')).toBe(false);
  });

  it("ninguém fora da lista chama a consulta ou a resposta", () => {
    let saida = "";
    try {
      saida = execFileSync(
        "git",
        ["grep", "--untracked", "-lE", "(consulta-do-caso|resposta-de-andamento)\"", "--", "app", "lib", "workers", "scripts"],
        { encoding: "utf8" },
      ).trim();
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = nenhum arquivo casou
    }
    const chamadores = saida
      .split("\n")
      .filter(Boolean)
      .filter((f) => !/\.test\.tsx?$/.test(f) && !/^lib\/djen\/(consulta-do-caso|resposta-de-andamento)\.ts$/.test(f));
    expect(chamadores.sort()).toEqual(PERMITIDOS);
  });
});

describe("modo assistido: a decisão nunca é envio", () => {
  it("o único desfecho com texto é 'sugerir'", () => {
    const d = decideAndamento("Teve alguma novidade no meu processo?", consulta(), CONTINUACAO);
    expect(["sugerir", "passar_para_humano"]).toContain(d.acao);
    expect(d.acao).not.toBe("enviar");
  });
});
