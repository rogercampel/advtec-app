import { describe, expect, it } from "vitest";

import {
  DjenIndisponivel,
  buscaPorOab,
  montaUrl,
  normaliza,
  type ComunicacaoBruta,
} from "@/lib/djen/comunica";
import {
  coleta,
  deduplicaLote,
  janela,
  paraLinha,
  type ClienteGravacao,
  type LinhaPublicacao,
} from "@/lib/djen/coletar";

/**
 * A coleta do DJEN tem duas garantias, e ambas existem porque prazo perdido não
 * aceita desculpa:
 *
 *  1. NADA DUPLICA. A janela de busca é sobreposta de propósito (a fonte publica
 *     com atraso), então sem chave estável a lista de prazos encheria de
 *     repetição — e lista repetida é lista que ninguém lê.
 *
 *  2. NADA ENTRA SEM TEOR. Guardar só o link transforma a prova do que foi
 *     publicado numa aposta de que a API do CNJ vai estar no ar no dia em que
 *     alguém precisar. Publicação sem texto é descartada e contada, nunca
 *     gravada pela metade.
 *
 * Critérios de aceite 1 e 2 da spec 0006.
 */

const ITEM: ComunicacaoBruta = {
  id: 696779217,
  data_disponibilizacao: "2026-08-18",
  siglaTribunal: "TJSP",
  tipoComunicacao: "Intimação",
  nomeOrgao: "Vara Cível de Osasco",
  numero_processo: "1234567-89.2026.8.26.0405",
  texto: "<html>Fica intimado o patrono para, no prazo de 15 dias, manifestar-se.</html>",
  link: "https://comunica.pje.jus.br/696779217",
};

function respostaFalsa(itens: ComunicacaoBruta[], count = itens.length): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: "success", count, items: itens }),
  } as unknown as Response;
}

function gravacaoEmMemoria() {
  const banco = new Map<string, LinhaPublicacao>();
  const cliente: ClienteGravacao = {
    async upsertPublicacoes(organizationId, linhas) {
      for (const l of linhas) {
        // simula a constraint `unique (organization_id, djen_id)`
        banco.set(`${organizationId}:${l.djen_id}`, l);
      }
      return { gravadas: linhas.length };
    },
  };
  return { banco, cliente };
}

describe("DJEN — a URL diz o que a gente mediu", () => {
  it("filtra por OAB e UF, que é o caso de uso inteiro", () => {
    const url = montaUrl({ numero: "100000", uf: "sp" });
    expect(url).toContain("numeroOab=100000");
    expect(url).toContain("ufOab=SP");
  });

  it("passa a janela de datas quando ela existe", () => {
    const url = montaUrl({ numero: "1", uf: "BA", de: "2026-08-15", ate: "2026-08-18" });
    expect(url).toContain("dataDisponibilizacaoInicio=2026-08-15");
    expect(url).toContain("dataDisponibilizacaoFim=2026-08-18");
  });
});

describe("nada entra sem inteiro teor", () => {
  it("normaliza uma publicação real", () => {
    const p = normaliza(ITEM);
    expect(p?.djenId).toBe(696779217);
    expect(p?.texto).toContain("prazo de 15 dias");
    expect(p?.numeroProcesso).toBe("1234567-89.2026.8.26.0405");
  });

  it("DESCARTA item sem texto — guardar só o link é apostar na API estar no ar", () => {
    expect(normaliza({ ...ITEM, texto: "" })).toBeNull();
    expect(normaliza({ ...ITEM, texto: null })).toBeNull();
  });

  it("descartado é CONTADO, não engolido", async () => {
    const r = await buscaPorOab(
      { numero: "1", uf: "SP" },
      { fetchImpl: async () => respostaFalsa([ITEM, { ...ITEM, id: 2, texto: "" }]) },
    );
    expect(r.publicacoes).toHaveLength(1);
    expect(r.descartadas).toBe(1);
  });
});

describe("a janela é sobreposta de propósito", () => {
  it("volta alguns dias, porque a fonte publica com atraso", () => {
    const { de, ate } = janela(new Date("2026-08-18T12:00:00Z"), 3);
    expect(ate).toBe("2026-08-18");
    expect(de).toBe("2026-08-15");
  });
});

describe("nada duplica", () => {
  it("a mesma publicação em duas OABs do escritório vira UMA linha", () => {
    const p = normaliza(ITEM)!;
    const duas = [
      paraLinha(p, "org-1", { numero: "100000", uf: "SP" }),
      paraLinha(p, "org-1", { numero: "200000", uf: "SP" }),
    ];
    const [linha] = deduplicaLote(duas);
    expect(linha).toBeDefined();
    // `toHaveLength(1)` sozinho era a asserção que não podia falhar no que
    // importa: a linha existia, e o segundo advogado sumia dela.
    expect(linha!.oabs.map((o) => o.numero).sort()).toEqual(["100000", "200000"]);
  });

  it("coletar duas vezes não cria linha nova — reexecução é segura", async () => {
    const { banco, cliente } = gravacaoEmMemoria();
    const fetchImpl = async () => respostaFalsa([ITEM]);
    const opcoes = { fetchImpl, hoje: new Date("2026-08-18T12:00:00Z") };

    await coleta("org-1", [{ numero: "100000", uf: "SP" }], cliente, opcoes);
    expect(banco.size).toBe(1);

    await coleta("org-1", [{ numero: "100000", uf: "SP" }], cliente, opcoes);
    expect(banco.size).toBe(1);
  });
});

describe("a publicação sobrevive à fonte cair", () => {
  it("o teor fica no banco, não um ponteiro para o CNJ", async () => {
    const { banco, cliente } = gravacaoEmMemoria();
    await coleta("org-1", [{ numero: "100000", uf: "SP" }], cliente, {
      fetchImpl: async () => respostaFalsa([ITEM]),
      hoje: new Date("2026-08-18T12:00:00Z"),
    });

    const guardada = banco.get("org-1:696779217")!;
    expect(guardada.texto).toContain("prazo de 15 dias");
    expect(guardada.data_disponibilizacao).toBe("2026-08-18");
  });

  it("API fora do ar não derruba a coleta: vira falha contada", async () => {
    const { cliente } = gravacaoEmMemoria();
    const r = await coleta("org-1", [{ numero: "100000", uf: "SP" }], cliente, {
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      hoje: new Date("2026-08-18T12:00:00Z"),
    });

    expect(r.gravadas).toBe(0);
    expect(r.falhas).toHaveLength(1);
    expect(r.falhas[0]!.motivo).toContain("ECONNREFUSED");
  });

  it("uma OAB que falha não impede as outras de serem coletadas", async () => {
    const { banco, cliente } = gravacaoEmMemoria();
    const r = await coleta(
      "org-1",
      [
        { numero: "111", uf: "SP" },
        { numero: "222", uf: "SP" },
      ],
      cliente,
      {
        fetchImpl: async (url: string) => {
          if (url.includes("numeroOab=111")) throw new Error("timeout");
          return respostaFalsa([ITEM]);
        },
        hoje: new Date("2026-08-18T12:00:00Z"),
      },
    );

    expect(r.falhas).toHaveLength(1);
    expect(banco.size).toBe(1);
  });

  it("HTTP não-ok também é indisponibilidade, não silêncio", async () => {
    await expect(
      buscaPorOab(
        { numero: "1", uf: "SP" },
        { fetchImpl: async () => ({ ok: false, status: 503 }) as Response },
      ),
    ).rejects.toBeInstanceOf(DjenIndisponivel);
  });
});

/**
 * Os três defeitos abaixo passaram por 12 testes verdes. Cada bloco existe
 * porque a suíte anterior NÃO podia acusá-los — não por descuido, por escolha
 * de fixture.
 *
 * Achados por revisor sem contexto em 18/08/2026, consertados em 19/08.
 */
describe("a segunda OAB intimada não se perde", () => {
  it("a mesma publicação para dois advogados guarda os DOIS", () => {
    const p = { ...normaliza(ITEM)!, djenId: 900 };
    const linhas = [
      paraLinha(p, "org-1", { numero: "1111", uf: "ce" }),
      paraLinha(p, "org-1", { numero: "2222", uf: "CE" }),
    ];
    const [unica] = deduplicaLote(linhas);
    expect(unica!.oabs).toHaveLength(2);
    expect(unica!.oabs.map((o) => o.numero).sort()).toEqual(["1111", "2222"]);
    // A UF entra normalizada, senão "ce" e "CE" viram dois advogados.
    expect(unica!.oabs.every((o) => o.uf === "CE")).toBe(true);
  });

  it("a mesma OAB duas vezes não duplica dentro da linha", () => {
    const p = { ...normaliza(ITEM)!, djenId: 901 };
    const linhas = [
      paraLinha(p, "org-1", { numero: "1111", uf: "CE" }),
      paraLinha(p, "org-1", { numero: "1111", uf: "CE" }),
    ];
    expect(deduplicaLote(linhas)[0]!.oabs).toHaveLength(1);
  });

  it("a chave da deduplicação inclui a organização", () => {
    // `deduplicaLote` é exportada. Hoje `coleta` passa um escritório só, mas
    // chave sem inquilino descarta linha alheia no dia em que alguém não passar.
    const p = { ...normaliza(ITEM)!, djenId: 902 };
    const linhas = [
      paraLinha(p, "org-1", { numero: "1111", uf: "CE" }),
      paraLinha(p, "org-2", { numero: "2222", uf: "CE" }),
    ];
    expect(deduplicaLote(linhas)).toHaveLength(2);
  });
});

describe("a janela é do fuso do foro, não de Greenwich", () => {
  it("23h de Brasília ainda é HOJE, e não amanhã", () => {
    // 2026-08-20T02:00Z = 2026-08-19 23:00 em São Paulo. Em UTC a data já virou,
    // e a janela inteira deslizaria um dia — que é a publicação que ninguém vê.
    const j = janela(new Date("2026-08-20T02:00:00.000Z"), 3);
    expect(j.ate).toBe("2026-08-19");
    expect(j.de).toBe("2026-08-16");
  });

  it("meio-dia UTC dá o mesmo dia nos dois fusos — por isso não servia de teste", () => {
    const j = janela(new Date("2026-08-19T12:00:00.000Z"), 3);
    expect(j.ate).toBe("2026-08-19");
  });

  it("a janela cobre a folga inteira, incluindo a virada de mês", () => {
    const j = janela(new Date("2026-09-01T02:00:00.000Z"), 3);
    expect(j.ate).toBe("2026-08-31");
    expect(j.de).toBe("2026-08-28");
  });
});
