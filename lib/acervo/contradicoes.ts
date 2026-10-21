/**
 * Contradições, lacunas e páginas que importam — ticket 0003.E5 (#39).
 *
 * "Onde os autos se contradizem, e o que foi alegado mas não provado. É aqui
 * que está o dinheiro." / "Quais páginas merecem leitura integral pelo
 * advogado, e por quê." (spec 0003, seções 4 e 5)
 *
 * Esta etapa NÃO relê os autos. Ela recebe os itens que já passaram pela âncora
 * (as alegações da 0003.E4 e os eventos da linha do tempo), numerados, e o
 * modelo só aponta RELAÇÕES entre eles pelo número. Duas consequências:
 *   - contradição entre a página 5 e a 200 aparece, mesmo em blocos diferentes;
 *   - o modelo não escreve trecho novo, então não tem citação para inventar.
 *     Número de item que não existe, ou o mesmo item contra ele mesmo, sai e é
 *     contado. Valor ou data na `explicacao`/`falta` que nenhum dos itens traz
 *     também sai: "R$ 100 contra R$ 900" sem item que fale de valor é invenção.
 *
 * O que continua sendo LEITURA DO MODELO, e o documento diz isso:
 *   - a relação em si (dois itens que "não podem ser verdade ao mesmo tempo");
 *   - a lacuna: "nenhum item, entre os trechos lidos, prova isto" — os anexos não
 *     estão nos trechos, então lacuna é "confira", nunca "não há prova".
 *
 * Páginas com DECISÃO do juízo entram sempre na lista do que ler, sem depender
 * do modelo: é onde está o que já vale no processo.
 */
import { z } from "zod";

import type { Alegacao } from "./alegacoes";
import { jsonDoModelo, motivoDaFalha, numerosApoiados, type ChamadaDoModelo } from "./leitura-por-modelo";
import type { Evento } from "./linha-do-tempo";

export type ItemDosAutos = {
  id: string;
  /** "pedido", "defesa"… ou "evento" (linha do tempo). */
  tipo: string;
  lado: string | null;
  texto: string;
  pagina: number;
  trecho: string;
};

export type Contradicao = { a: ItemDosAutos; b: ItemDosAutos; explicacao: string };
export type Lacuna = { item: ItemDosAutos; falta: string };
export type PaginaQueImporta = { pagina: number; motivos: string[] };

export type LeituraDasContradicoes = {
  contradicoes: Contradicao[];
  lacunas: Lacuna[];
  paginasQueImportam: PaginaQueImporta[];
  removidas: { numero_inexistente: number; mesmo_item: number; numero_sem_apoio: number; acima_do_teto: number; repetido: number };
  /** O modelo não respondeu, ou respondeu fora do formato: o documento diz que contradições e lacunas não foram procuradas. */
  naoLido: { motivo: string } | null;
};

/** Numera o que já está ancorado: A1… para alegações, E1… para eventos. */
export function itensDosAutos(alegacoes: Alegacao[], eventos: Evento[]): ItemDosAutos[] {
  return [
    ...alegacoes.map((a, i) => ({ id: `A${i + 1}`, tipo: a.tipo, lado: a.lado, texto: a.texto, pagina: a.pagina, trecho: a.trecho })),
    ...eventos.map((e, i) => ({ id: `E${i + 1}`, tipo: "evento", lado: null, texto: `Em ${e.data}: ${e.trecho}`, pagina: e.pagina, trecho: e.trecho })),
  ];
}

const SISTEMA = `Você ajuda um advogado a achar, num processo, onde os autos se contradizem e o que foi alegado sem prova. Regras inegociáveis:
1. Você recebe ITENS numerados, cada um com página e trecho literal dos autos. Só use esses itens; não use conhecimento de fora.
2. Refira-se aos itens SÓ pelo número (ex.: "A3", "E7"). Não copie trecho, não invente item.
3. Contradição é quando dois itens afirmam coisas que não podem ser verdade ao mesmo tempo (datas, valores, fatos). Versões diferentes de cada lado sobre o mesmo fato também contam. Na explicação, todo valor ou data tem de estar escrito nos dois itens.
4. Lacuna é uma alegação de fato DECISIVA para o resultado que, entre os itens, não tem nenhum outro que a comprove. Os itens são um resumo: os documentos anexados não estão aqui. Aponte só as que mudam o caso, no máximo 5, da mais para a menos importante.
5. Página que importa é a que o advogado precisa ler INTEIRA por causa do caso: onde está uma decisão, uma prova documental citada, um lado de contradição, ou o núcleo do pedido ou da defesa. Nunca aponte página porque o trecho do item parece cortado.
6. Lista vazia é a resposta certa quando não há nada. Responda sempre as três chaves, mesmo vazias.
Responda SÓ com um JSON válido, sem texto antes ou depois.`;

/** Medido em 21/10/2026: sem o teto, uma inicial sozinha teve 8 "lacunas" — toda causa de pedir, porque a prova mora nos anexos. */
export const MAXIMO_DE_LACUNAS = 5;

const PEDIDO = `{
 "contradicoes": [{"a": "A1", "b": "E4", "explicacao": "uma frase"}],
 "lacunas": [{"item": "A2", "falta": "o que precisaria ser provado, uma frase"}],
 "paginas": [{"item": "A5", "motivo": "por que o advogado precisa ler esta página inteira, por causa do caso, uma frase"}]
}

ITENS:
`;

const frase = z.string().trim().min(3).max(400);
/** As três chaves são obrigatórias: `{}` ou uma chave com acento não é "nada encontrado", é resposta que não deu para ler. */
const resposta = z.object({
  contradicoes: z.array(z.object({ a: z.string(), b: z.string(), explicacao: frase })),
  lacunas: z.array(z.object({ item: z.string(), falta: frase })),
  paginas: z.array(z.object({ item: z.string(), motivo: frase })),
});

const MOTIVO_DA_DECISAO = "decisão do juízo — o que já vale no processo";
const fontesDe = (...itens: ItemDosAutos[]) => itens.flatMap((i) => [i.texto, i.trecho]);

export async function leContradicoes(itens: ItemDosAutos[], chamar: ChamadaDoModelo): Promise<LeituraDasContradicoes> {
  const removidas = { numero_inexistente: 0, mesmo_item: 0, numero_sem_apoio: 0, acima_do_teto: 0, repetido: 0 };
  const porId = new Map(itens.map((i) => [i.id, i]));
  const paginas = new Map<number, string[]>();
  const marca = (pagina: number, motivo: string) => {
    const motivos = paginas.get(pagina) ?? [];
    if (!motivos.includes(motivo)) motivos.push(motivo);
    paginas.set(pagina, motivos);
  };
  for (const i of itens) if (i.tipo === "decisao") marca(i.pagina, MOTIVO_DA_DECISAO);

  const contradicoes: Contradicao[] = [];
  const lacunas: Lacuna[] = [];
  let naoLido: LeituraDasContradicoes["naoLido"] = null;

  if (itens.length > 1) {
    let lido: z.infer<typeof resposta> | null = null;
    try {
      const lista = itens.map((i) => `${i.id} [${i.tipo}${i.lado ? `, ${i.lado}` : ""}, p. ${i.pagina}] ${i.texto} — "${i.trecho}"`).join("\n");
      const { texto } = await chamar({ system: SISTEMA, user: PEDIDO + lista });
      const r = resposta.safeParse(jsonDoModelo(texto));
      if (r.success) lido = r.data;
      else naoLido = { motivo: "resposta do modelo fora do formato" };
    } catch (e) {
      naoLido = { motivo: motivoDaFalha(e) };
    }
    if (lido) {
      const vistas = new Set<string>();
      for (const c of lido.contradicoes) {
        const a = porId.get(c.a);
        const b = porId.get(c.b);
        if (!a || !b) {
          removidas.numero_inexistente += 1;
          continue;
        }
        if (a.id === b.id) {
          removidas.mesmo_item += 1;
          continue;
        }
        if (!numerosApoiados(c.explicacao, ...fontesDe(a, b))) {
          removidas.numero_sem_apoio += 1;
          continue;
        }
        const chave = [a.id, b.id].sort().join("|");
        if (vistas.has(chave)) {
          removidas.repetido += 1;
          continue;
        }
        vistas.add(chave);
        contradicoes.push({ a, b, explicacao: c.explicacao });
        marca(a.pagina, "um lado de uma contradição");
        marca(b.pagina, "um lado de uma contradição");
      }
      // O teto vale sobre as lacunas VÁLIDAS: número inventado no topo não come vaga.
      for (const l of lido.lacunas) {
        const item = porId.get(l.item);
        if (!item) {
          removidas.numero_inexistente += 1;
          continue;
        }
        if (!numerosApoiados(l.falta, ...fontesDe(item))) {
          removidas.numero_sem_apoio += 1;
          continue;
        }
        if (lacunas.length >= MAXIMO_DE_LACUNAS) {
          removidas.acima_do_teto += 1;
          continue;
        }
        lacunas.push({ item, falta: l.falta });
      }
      for (const p of lido.paginas) {
        const item = porId.get(p.item);
        if (!item) {
          removidas.numero_inexistente += 1;
          continue;
        }
        marca(item.pagina, p.motivo);
      }
    }
  }

  return {
    contradicoes,
    lacunas,
    paginasQueImportam: [...paginas].sort(([a], [b]) => a - b).map(([pagina, motivos]) => ({ pagina, motivos })),
    removidas,
    naoLido,
  };
}
