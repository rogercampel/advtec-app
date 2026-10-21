/**
 * O documento de saída da leitura — ticket 0003.E6 (#41), a parte pura.
 *
 * "Uma página só, legível, imprimível." E a regra que rege tudo: "Nenhuma
 * afirmação sai sem página." (spec 0003) Este módulo junta as etapas E2 a E5 num
 * documento e é o último filtro: o que chegar aqui sem página é retirado e
 * contado (`retiradasSemPagina`), e `afirmacoesDo` lista TUDO o que o documento
 * afirma, para o teste varrer (critério 2).
 *
 * O que o documento diz sobre si mesmo, antes de qualquer conteúdo:
 *   - que aponta onde ler e não substitui a leitura (spec, riscos);
 *   - o que NÃO foi lido: folhas sem texto e trechos que o modelo não respondeu,
 *     com o motivo. Se parte não foi lida, as contradições dizem que foram
 *     procuradas só no que foi lido.
 * E sobre o que é leitura do modelo: frase e trecho sempre juntos; contradição e
 * lacuna marcadas como "confira".
 */
import type { Alegacao, LeituraDasAlegacoes, TipoDeAlegacao } from "./alegacoes";
import type { LeituraDasContradicoes } from "./contradicoes";
import type { LinhaDoTempo } from "./linha-do-tempo";
import type { Campo, QuemEQuem } from "./quem-e-quem";

export const AVISO_DO_DOCUMENTO =
  "Este documento aponta ONDE ler; não substitui a leitura. Toda afirmação traz a página dos autos — confira lá antes de usar numa peça.";

/** Uma afirmação do documento: o que se diz, e a página (com o trecho literal, quando há). */
export type Afirmacao = { texto: string; pagina: number; trecho: string | null };

export type SecaoDeAlegacoes = {
  tipo: TipoDeAlegacao;
  rotulo: string;
  /** `itens`: há o que mostrar. `nao_consta`: o modelo não apontou nada. `descartado`: apontou sem trecho que prove. */
  estado: "itens" | "nao_consta" | "descartado";
  itens: Array<Afirmacao & { lado: Alegacao["lado"] }>;
};

export type DocumentoDeLeitura = {
  aviso: string;
  naoLido: { paginasSemTexto: number[]; trechos: Array<{ primeira: number; ultima: number; motivo: string }> };
  quemEQuem: Array<{ rotulo: string; afirmacao: Afirmacao | null }>;
  advogados: Afirmacao[];
  linhaDoTempo: Array<Afirmacao & { data: string }>;
  alegacoes: SecaoDeAlegacoes[];
  contradicoes: {
    /** `procurado`, `parcial` (parte dos autos não foi lida) ou `nao_procurado` (o modelo não respondeu). */
    estado: "procurado" | "parcial" | "nao_procurado";
    motivo: string | null;
    itens: Array<{ explicacao: string; lados: [Afirmacao, Afirmacao] }>;
    lacunas: Array<{ falta: string; afirmacao: Afirmacao }>;
  };
  paginasQueImportam: Array<{ pagina: number; motivos: string[] }>;
  retiradasSemPagina: number;
};

const ROTULOS: Record<TipoDeAlegacao, string> = {
  pedido: "O que se pede",
  causa_de_pedir: "Por que se pede (fatos e fundamentos)",
  defesa: "O que a outra parte responde",
  decisao: "O que já foi decidido",
};

const temPagina = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

export function montaDocumento(entrada: {
  quemEQuem: QuemEQuem;
  linhaDoTempo: LinhaDoTempo;
  alegacoes: LeituraDasAlegacoes;
  contradicoes: LeituraDasContradicoes;
}): DocumentoDeLeitura {
  let retiradasSemPagina = 0;
  /** O último filtro: sem página, não entra. */
  const so = <T extends { pagina: unknown }>(xs: T[]): T[] =>
    xs.filter((x) => {
      if (temPagina(x.pagina)) return true;
      retiradasSemPagina += 1;
      return false;
    });
  const doCampo = (c: Campo | null): Afirmacao | null => {
    if (!c) return null;
    if (!temPagina(c.pagina)) {
      retiradasSemPagina += 1;
      return null;
    }
    return { texto: c.valor, pagina: c.pagina, trecho: c.trecho };
  };

  const { alegacoes, contradicoes } = entrada;
  const q = entrada.quemEQuem;
  const parcial = alegacoes.blocosNaoLidos.length > 0 || alegacoes.paginasSemTexto.length > 0;

  return {
    aviso: AVISO_DO_DOCUMENTO,
    naoLido: { paginasSemTexto: alegacoes.paginasSemTexto, trechos: alegacoes.blocosNaoLidos },
    quemEQuem: [
      { rotulo: "Juízo", afirmacao: doCampo(q.juizo) },
      { rotulo: "Autor", afirmacao: doCampo(q.autor) },
      { rotulo: "Réu", afirmacao: doCampo(q.reu) },
      { rotulo: "Ação", afirmacao: doCampo(q.classe) },
      { rotulo: "Valor da causa", afirmacao: doCampo(q.valor_da_causa) },
    ],
    advogados: so(q.advogados).map((a) => ({ texto: `${a.valor} (${a.oab})`, pagina: a.pagina, trecho: a.trecho })),
    linhaDoTempo: so(entrada.linhaDoTempo.eventos).map((e) => ({ data: e.data, texto: e.trecho, pagina: e.pagina, trecho: e.trecho })),
    alegacoes: (Object.keys(ROTULOS) as TipoDeAlegacao[]).map((tipo) => {
      const itens = so(alegacoes.alegacoes.filter((a) => a.tipo === tipo)).map((a) => ({ texto: a.texto, pagina: a.pagina, trecho: a.trecho, lado: a.lado }));
      const estado = itens.length > 0 ? "itens" : alegacoes.descartados.includes(tipo) ? "descartado" : "nao_consta";
      return { tipo, rotulo: ROTULOS[tipo], estado, itens };
    }),
    contradicoes: {
      estado: contradicoes.naoLido ? "nao_procurado" : parcial ? "parcial" : "procurado",
      motivo: contradicoes.naoLido?.motivo ?? (parcial ? "procuradas só nas páginas que foram lidas" : null),
      itens: contradicoes.contradicoes
        .filter((c) => {
          if (temPagina(c.a.pagina) && temPagina(c.b.pagina)) return true;
          retiradasSemPagina += 1;
          return false;
        })
        .map((c) => ({
          explicacao: c.explicacao,
          lados: [
            { texto: c.a.texto, pagina: c.a.pagina, trecho: c.a.trecho },
            { texto: c.b.texto, pagina: c.b.pagina, trecho: c.b.trecho },
          ],
        })),
      lacunas: so(contradicoes.lacunas.map((l) => ({ ...l, pagina: l.item.pagina }))).map((l) => ({
        falta: `Não achamos, nos trechos lidos, prova disto — os anexos podem ter: ${l.falta}`,
        afirmacao: { texto: l.item.texto, pagina: l.item.pagina, trecho: l.item.trecho },
      })),
    },
    paginasQueImportam: so(contradicoes.paginasQueImportam),
    retiradasSemPagina,
  };
}

/** Tudo o que o documento AFIRMA, para o teste varrer (spec 0003, critério 2). */
export function afirmacoesDo(d: DocumentoDeLeitura): Afirmacao[] {
  return [
    ...d.quemEQuem.flatMap((c) => (c.afirmacao ? [c.afirmacao] : [])),
    ...d.advogados,
    ...d.linhaDoTempo,
    ...d.alegacoes.flatMap((s) => s.itens),
    ...d.contradicoes.itens.flatMap((c) => c.lados),
    ...d.contradicoes.lacunas.map((l) => l.afirmacao),
    ...d.paginasQueImportam.map((p) => ({ texto: p.motivos.join("; "), pagina: p.pagina, trecho: null })),
  ];
}
