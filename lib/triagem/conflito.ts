/**
 * CONFLITO DE INTERESSES — spec 0001.E3, critério 8.
 *
 * Antes de coletar a história, confere se a PARTE CONTRÁRIA que o cliente citou
 * já é cliente do escritório. Se pode ser, a coleta para e o advogado decide:
 * quem ouviu os dois lados não pode mais representar nenhum (Código de Ética da
 * OAB). Esta checagem NÃO decide que há conflito — diz que pode haver.
 *
 * ═══ O QUE É "CLIENTE" AQUI (escolha declarada) ═══
 *
 * Contato da MESMA organização que tem pelo menos um negócio (`crm_leads`), em
 * qualquer status (aberto, ganho ou perdido). Razões:
 *   - o caso é o negócio do funil (ADR 0003); contato sem negócio é só alguém
 *     que mandou mensagem — a própria parte contrária costuma estar nessa
 *     situação, e tratá-la como cliente travaria triagem à toa;
 *   - negócio PERDIDO conta: quem consultou o escritório e não contratou ainda
 *     tem dever de sigilo à frente do escritório (consulente).
 * Ficam de fora: o próprio contato do turno (não é parte contrária de si mesmo)
 * e contato já fundido em outro (`is_merged_into`; o destino da fusão conta).
 *
 * ═══ COMO O NOME CASA ═══
 *
 * Normaliza (sem acento, caixa, pontuação, espaços, partículas "de/da/do/dos/das/e")
 * e compara o nome INTEIRO:
 *   - igual → `igual`;
 *   - os dois com 2+ palavras, mesmo primeiro nome, as palavras do menor em ordem
 *     no maior, e (mesmo último nome: "João Silva" × "João Carlos Silva") ou (o menor
 *     é o começo do maior: "João Carlos" × "João Carlos Silva") → `parecido`.
 *     Ambíguo é POSSÍVEL conflito.
 * Nunca substring: "Ana" não casa com "Mariana" nem com "Ana Paula Souza" (um
 * nome solto não identifica ninguém — o custo é deixar passar "Ana" quando o
 * escritório só conhece "Ana Paula Souza", e fica dito no relatório da etapa).
 * Compara com `name` e com `display_name` (o perfil do canal) do contato.
 *
 * O filtro SQL é só um pré-corte por primeiro nome e `limit`; a decisão é a
 * função pura `nomesCombinam`. Toda consulta filtra `organization_id`, vindo da
 * linha do job — nunca do modelo.
 */
import { nomeDoContato } from "@/lib/contacts/rotulo-do-contato";

import type { Consultavel } from "./banco";
import { soAlfanumerico } from "./texto";

const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

export type ComoCombinou = "igual" | "parecido";

export function palavrasDoNome(nome: string): string[] {
  return soAlfanumerico(nome)
    .split(" ")
    .filter((p) => p !== "" && !PARTICULAS.has(p));
}

function ehSubsequencia(menor: string[], maior: string[]): boolean {
  let i = 0;
  for (const p of maior) if (p === menor[i]) i++;
  return i === menor.length;
}

/** Os dois nomes podem ser da mesma pessoa? Pura. */
export function nomesCombinam(a: string, b: string): ComoCombinou | null {
  const pa = palavrasDoNome(a);
  const pb = palavrasDoNome(b);
  if (pa.length === 0 || pb.length === 0) return null;
  if (pa.length === pb.length && pa.every((p, i) => p === pb[i])) return "igual";
  if (pa.length < 2 || pb.length < 2) return null;
  const [menor, maior] = pa.length <= pb.length ? [pa, pb] : [pb, pa];
  if (menor[0] !== maior[0] || !ehSubsequencia(menor, maior)) return null;
  // mesmo último nome ("João Silva" × "João Carlos Silva") ou o nome menor é o começo do maior
  // ("João Carlos" × "João Carlos Silva"): quem só deu os primeiros nomes pode ser a mesma pessoa.
  const mesmoUltimo = menor[menor.length - 1] === maior[maior.length - 1];
  const comecoDoMaior = menor.every((p, i) => p === maior[i]);
  return mesmoUltimo || comecoDoMaior ? "parecido" : null;
}

export type ContatoEmConflito = {
  contactId: string;
  /** Como o escritório conhece a pessoa (`name`, senão `display_name`). */
  nome: string;
  casos: number;
  como: ComoCombinou;
};

export type ResultadoDeConflito =
  | {
      resultado: "sem_conflito";
      /** `false` = o nome era vazio ou não tinha letra: nada foi conferido, e isso NÃO é "limpo". */
      verificado: boolean;
    }
  | { resultado: "possivel_conflito"; contatos: ContatoEmConflito[] };

/** Acentos que o `translate` do SQL sabe tirar — o mesmo pré-corte de `soAlfanumerico` para o português. */
const COM_ACENTO = "áàâãäåéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ";
const SEM_ACENTO = "aaaaaaeeeeiiiiooooouuuucnAAAAAAEEEEIIIIOOOOOUUUUCN";

/** Primeira palavra do nome já normalizada, como expressão SQL sobre a coluna `col`. */
const primeiroNomeSql = (col: string) =>
  `(string_to_array(btrim(regexp_replace(lower(translate(coalesce(${col}, ''), '${COM_ACENTO}', '${SEM_ACENTO}')), '[^a-z0-9]+', ' ', 'g')), ' '))[1]`;

const LIMITE_DE_CANDIDATOS = 200;

export async function checaConflito(
  db: Consultavel,
  args: {
    /** Da linha do job. */
    organizationId: string;
    /** O contato do turno — fora da conta. */
    contatoDoTurno: string | null;
    /** O que o modelo trouxe do cliente. */
    nomeDaParteContraria: string;
  },
): Promise<ResultadoDeConflito> {
  const palavras = palavrasDoNome(args.nomeDaParteContraria);
  const primeiro = palavras[0];
  // "não sei", "" ou "???" sem letra útil: não há o que conferir.
  if (!primeiro || primeiro.length < 2) return { resultado: "sem_conflito", verificado: false };

  const { rows } = await db.query<{ id: string; name: string | null; display_name: string | null; casos: number }>(
    `select c.id, c.name, c.display_name, count(l.id)::int as casos
       from public.contacts c
       join public.crm_leads l
         on l.organization_id = c.organization_id and l.contact_id = c.id
      where c.organization_id = $1
        and ($2::uuid is null or c.id <> $2::uuid)
        and c.is_merged_into is null
        and ($3 = ${primeiroNomeSql("c.name")} or $3 = ${primeiroNomeSql("c.display_name")})
      group by c.id, c.name, c.display_name
      order by count(l.id) desc, c.id
      limit ${LIMITE_DE_CANDIDATOS}`,
    [args.organizationId, args.contatoDoTurno, primeiro],
  );

  const contatos: ContatoEmConflito[] = [];
  for (const r of rows) {
    const comoNome = r.name ? nomesCombinam(args.nomeDaParteContraria, r.name) : null;
    const comoPerfil = r.display_name ? nomesCombinam(args.nomeDaParteContraria, r.display_name) : null;
    const como = comoNome === "igual" || comoPerfil === "igual" ? "igual" : (comoNome ?? comoPerfil);
    if (!como) continue;
    contatos.push({ contactId: r.id, nome: nomeDoContato({ name: r.name, display_name: r.display_name }) ?? "(sem nome)", casos: r.casos, como });
  }
  return contatos.length > 0 ? { resultado: "possivel_conflito", contatos } : { resultado: "sem_conflito", verificado: true };
}
