import { describe, expect, it } from "vitest";

import { DataJudIndisponivel, consulta, montaConsulta, normaliza, paraIso } from "@/lib/datajud/api";
import {
  ANO_MINIMO_PLAUSIVEL,
  dataIlegivel,
  dataImpossivel,
  deduplicaLote,
  espelha,
  paraLinha,
  type ClienteEspelho,
  type LinhaProcesso,
} from "@/lib/datajud/espelho";

/**
 * O espelho existe por um motivo só: **a estatística tem de ser conferível
 * depois**. A base do CNJ muda todo dia, então duas perguntas iguais em datas
 * diferentes devolvem números diferentes. Advogado decide estratégia com esse
 * número e depois não consegue reproduzir o que viu.
 *
 * Daí as duas garantias testadas aqui:
 *
 *  1. A CONSULTA É GRAVADA junto do resultado. Filtro sem registro é número sem
 *     origem, e a spec 0007 reprova número sem origem.
 *
 *  2. O LIXO ENTRA CONTADO, NÃO LIMPO. Existe processo com ajuizamento em 1888 —
 *     medido na fonte. Descartar aqui esconderia o tamanho da sujeira; a E2 é
 *     que descarta, e ela precisa saber quanto é.
 */

const HIT = {
  _id: "abc123",
  _source: {
    tribunal: "TJSP",
    grau: "G1",
    numeroProcesso: "1234567-89.2026.8.26.0405",
    dataAjuizamento: "2026-03-10T00:00:00.000Z",
    nivelSigilo: 0,
    orgaoJulgador: { codigo: 10879, nome: "Vara do Juizado Especial Cível" },
    classe: { codigo: 436, nome: "Procedimento do Juizado Especial Cível" },
    assuntos: [{ codigo: 7768, nome: "Rescisão do contrato" }],
    movimentos: [{ codigo: 219, nome: "Procedência", dataHora: "2026-07-01T10:00:00.000Z" }],
  },
};

function respostaFalsa(hits: unknown[], total?: number): Response {
  const bloco: Record<string, unknown> = { hits };
  if (total !== undefined) bloco.total = { value: total };
  return { ok: true, status: 200, json: async () => ({ hits: bloco }) } as unknown as Response;
}

function espelhoEmMemoria() {
  const banco = new Map<string, LinhaProcesso>();
  const coletas: Array<{ recorteId: string; quando: Date; consulta: Record<string, unknown> }> = [];
  const cliente: ClienteEspelho = {
    async upsertProcessos(linhas) {
      for (const l of linhas) banco.set(`${l.organization_id}:${l.recorte_id}:${l.datajud_id}`, l);
      return { gravados: linhas.length };
    },
    async marcaColeta(recorteId, quando, consultaEnviada) {
      coletas.push({ recorteId, quando, consulta: consultaEnviada });
    },
  };
  return { banco, coletas, cliente };
}

/** Igual ao de cima, mas o upsert falha — para provar o que NÃO acontece. */
function espelhoQueFalhaAoGravar() {
  const coletas: unknown[] = [];
  const cliente: ClienteEspelho = {
    async upsertProcessos() {
      return { gravados: 0, erro: "deadlock detected" };
    },
    async marcaColeta() {
      coletas.push(1);
    },
  };
  return { coletas, cliente };
}

describe("a consulta é parte do resultado", () => {
  it("filtra por classe, assunto e órgão quando o recorte pede", () => {
    const c = montaConsulta({
      tribunal: "tjsp",
      classeCodigo: 436,
      assuntoCodigo: 7768,
      orgaoJulgadorCodigo: 10879,
    }) as { query: { bool: { filter: unknown[] } } };
    expect(c.query.bool.filter).toHaveLength(3);
  });

  it("recorte sem filtro vira match_all — explícito, não acidente", () => {
    const c = montaConsulta({ tribunal: "tjsp" }) as { query: Record<string, unknown> };
    expect(c.query).toHaveProperty("match_all");
  });

  it("a consulta enviada é GRAVADA no recorte — sem ela o número não se confere", async () => {
    const { coletas, cliente } = espelhoEmMemoria();
    const agora = new Date("2026-08-18T18:00:00Z");

    await espelha("org-1", "rec-1", { tribunal: "tjsp", classeCodigo: 436 }, cliente, {
      chave: "chave-de-teste",
      fetchImpl: async () => respostaFalsa([HIT]),
      agora,
    });

    expect(coletas).toHaveLength(1);
    expect(coletas[0]!.quando).toBe(agora);
    expect(JSON.stringify(coletas[0]!.consulta)).toContain("classe.codigo");
  });
});

describe("a data vem no formato do CNJ, não em ISO", () => {
  /**
   * Medido contra a API real em 18/08/2026, TJSP: `dataAjuizamento` vem como
   * `"20260629120145"`. A fixture usava ISO e os testes passavam — a coluna é
   * `timestamptz`, e essa string quebraria o insert na primeira coleta real.
   */
  it("converte YYYYMMDDHHMMSS, que é o que a fonte manda de verdade", () => {
    expect(paraIso("20260629120145")).toBe("2026-06-29T12:01:45.000Z");
  });

  it("aceita só a data, sem hora", () => {
    expect(paraIso("20260629")).toBe("2026-06-29T00:00:00.000Z");
  });

  it("ISO passa intacto — tribunal que já manda certo não é penalizado", () => {
    expect(paraIso("2026-03-10T00:00:00.000Z")).toBe("2026-03-10T00:00:00.000Z");
  });

  it("vazio é nulo, e o que não dá para interpretar também", () => {
    expect(paraIso(null)).toBeNull();
    expect(paraIso("")).toBeNull();
    // Mudou de propósito: a versão anterior devolvia a string crua "para o
    // defeito aparecer no dado". Aparecia — como erro de `timestamptz` que
    // derrubava o INSERT DO LOTE INTEIRO. Agora a linha entra com data nula e
    // o original fica em `data_ajuizamento_bruto`.
    expect(paraIso("data estranha")).toBeNull();
  });

  it("data fora de faixa NÃO vira timestamp inválido — ela vira nulo", () => {
    // "2026-13-45T99:99:99.000Z" é o que a versão anterior produzia. O Postgres
    // recusa, e recusa o lote junto: uma linha podre perdia a coleta toda.
    expect(paraIso("20261345999999")).toBeNull();
    expect(paraIso("20260001120000")).toBeNull();  // mês 00
    expect(paraIso("20260632120000")).toBeNull();  // dia 32
    expect(paraIso("20260629250000")).toBeNull();  // hora 25
  });

  it("data ilegível é CONTADA, não some — o critério 2 exige a contagem", async () => {
    // Regressão achada na convergência, 19/08/2026. Ao fazer `paraIso` devolver
    // null (em vez da string crua, que envenenava o insert), "data estranha",
    // "N/A" e "sem data" pararam de ser contadas como sujeira. Elas eram, antes.
    const { cliente } = espelhoEmMemoria();
    const sujos = ["data estranha", "N/A", "sem data"].map((d, i) => ({
      _id: `sujo-${i}`,
      _source: { ...HIT._source, dataAjuizamento: d },
    }));
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa(sujos, 3),
    });
    expect(r.comDataIlegivel).toBe(3);
  });

  it("ilegível e impossível são contagens SEPARADAS — problemas diferentes", async () => {
    // 1888 é dado velho do CNJ. Ilegível é formato que mudou. Somar os dois
    // esconderia uma troca de layout dentro da sujeira normal.
    const { cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () =>
        respostaFalsa(
          [
            { _id: "velho", _source: { ...HIT._source, dataAjuizamento: "18880101000000" } },
            { _id: "ilegivel", _source: { ...HIT._source, dataAjuizamento: "sem data" } },
          ],
          2,
        ),
    });
    expect(r.comDataImpossivel).toBe(1);
    expect(r.comDataIlegivel).toBe(1);
  });

  it("data ausente de verdade não conta como ilegível", () => {
    // Campo vazio é ausência, não defeito de formato. Contar inflaria o alarme.
    expect(dataIlegivel(null, null)).toBe(false);
    expect(dataIlegivel(null, "   ")).toBe(false);
    expect(dataIlegivel(null, "N/A")).toBe(true);
    expect(dataIlegivel("2026-01-01T00:00:00.000Z", "20260101000000")).toBe(false);
  });

  it("o bruto é preservado ao lado do interpretado", () => {
    const p = normaliza({ _id: "x", _source: { dataAjuizamento: "20261345999999" } })!;
    expect(p.dataAjuizamento).toBeNull();
    expect(p.dataAjuizamentoBruto).toBe("20261345999999");
  });

  it("o processo real do CNJ chega ao banco com data parseável", () => {
    const real = { _id: "x", _source: { ...HIT._source, dataAjuizamento: "20260629120145" } };
    expect(normaliza(real)!.dataAjuizamento).toBe("2026-06-29T12:01:45.000Z");
  });

  it("data impossível continua reconhecida no formato compacto", () => {
    expect(dataImpossivel(paraIso("18880920000000"))).toBe(true);
  });
});

describe("o processo entra como veio", () => {
  it("normaliza mantendo movimentos e órgão julgador", () => {
    const p = normaliza(HIT)!;
    expect(p.datajudId).toBe("abc123");
    expect(p.orgaoJulgadorCodigo).toBe(10879);
    expect(p.movimentos).toHaveLength(1);
    expect(p.nivelSigilo).toBe(0);
  });

  it("hit sem _id é descartado e CONTADO", async () => {
    const r = await consulta(
      { tribunal: "tjsp" },
      { chave: "k", fetchImpl: async () => respostaFalsa([HIT, { _source: HIT._source }]) },
    );
    expect(r.processos).toHaveLength(1);
    expect(r.descartados).toBe(1);
  });

  it("guarda nivelSigilo — a spec exige filtrar por ele mais tarde", async () => {
    const { banco, cliente } = espelhoEmMemoria();
    await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () =>
        respostaFalsa([{ ...HIT, _source: { ...HIT._source, nivelSigilo: 1 } }]),
    });
    expect(banco.get("org-1:rec-1:abc123")!.nivel_sigilo).toBe(1);
  });
});

describe("o lixo entra contado, não limpo", () => {
  it("reconhece data impossível", () => {
    expect(dataImpossivel("1888-09-20T00:00:00Z")).toBe(true);
    expect(dataImpossivel("1980-03-18T00:00:00Z")).toBe(true);
    expect(dataImpossivel("2026-03-10T00:00:00Z")).toBe(false);
    expect(dataImpossivel(null)).toBe(false);
    expect(ANO_MINIMO_PLAUSIVEL).toBe(1990);
  });

  it("processo de 1888 é GRAVADO, e aparece na contagem", async () => {
    const { banco, cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () =>
        respostaFalsa([
          HIT,
          { _id: "velho", _source: { ...HIT._source, dataAjuizamento: "1888-09-20T00:00:00Z" } },
        ]),
    });

    expect(r.gravados).toBe(2);
    expect(r.comDataImpossivel).toBe(1);
    expect(banco.get("org-1:rec-1:velho")!.data_ajuizamento).toBe("1888-09-20T00:00:00Z");
  });
});

describe("nada duplica e a falha não some", () => {
  it("o mesmo _id duas vezes no lote vira uma linha", () => {
    const p = normaliza(HIT)!;
    expect(deduplicaLote([paraLinha(p, "o", "r"), paraLinha(p, "o", "r")])).toHaveLength(1);
  });

  it("espelhar duas vezes não cria linha nova", async () => {
    const { banco, cliente } = espelhoEmMemoria();
    const o = { chave: "k", fetchImpl: async () => respostaFalsa([HIT]) };
    await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, o);
    await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, o);
    expect(banco.size).toBe(1);
  });

  it("sem chave configurada é falha declarada, não consulta silenciosa", async () => {
    await expect(
      consulta({ tribunal: "tjsp" }, { chave: "", fetchImpl: async () => respostaFalsa([]) }),
    ).rejects.toBeInstanceOf(DataJudIndisponivel);
  });

  it("401 do CNJ vira falha no resultado, não exceção solta", async () => {
    const { cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => ({ ok: false, status: 401 }) as Response,
    });
    expect(r.gravados).toBe(0);
    expect(r.falha).toContain("401");
  });
});

/**
 * Os dois números que faltavam, e que mudam o significado de `vistos`.
 *
 * `vistos` não é "quantos processos o órgão tem": é o tamanho da página. A spec
 * 0007 cita órgão com 2.653.656 processos, e o recorte padrão pede 500. Sem
 * `total` e `truncado`, toda estatística construída em cima disso está
 * enviesada e ninguém tem como saber.
 */
describe("truncagem não fica escondida", () => {
  it("total do CNJ e a marca de truncado chegam ao resultado", async () => {
    const { cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa([HIT], 2_653_656),
    });
    expect(r.total).toBe(2_653_656);
    expect(r.truncado).toBe(true);
    expect(r.vistos).toBe(1);
  });

  it("quando veio tudo, não marca truncado", async () => {
    const { cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa([HIT], 1),
    });
    expect(r.truncado).toBe(false);
  });

  it("resposta sem `total` devolve null, não zero — buraco declarado", async () => {
    const { cliente } = espelhoEmMemoria();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa([HIT]),
    });
    expect(r.total).toBeNull();
    expect(r.truncado).toBe(false);
  });
});

/**
 * `ultima_coleta_em` é a data que o advogado vê como "atualizado até". Gravá-la
 * quando o upsert falhou é pior que não gravar nada, porque parece verdade.
 */
describe("a data da coleta não mente", () => {
  it("upsert que falha NÃO marca a coleta", async () => {
    const { coletas, cliente } = espelhoQueFalhaAoGravar();
    const r = await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa([HIT], 1),
    });
    expect(r.falha).toContain("deadlock");
    expect(coletas).toHaveLength(0);
  });

  it("upsert que dá certo marca a coleta", async () => {
    const { coletas, cliente } = espelhoEmMemoria();
    await espelha("org-1", "rec-1", { tribunal: "tjsp" }, cliente, {
      chave: "k",
      fetchImpl: async () => respostaFalsa([HIT], 1),
    });
    expect(coletas).toHaveLength(1);
  });
});
