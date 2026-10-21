/**
 * Consulta do caso pelo WhatsApp — spec 0010 (AdvTec).
 *
 * E1 — contato ↔ caso. O caso é o negócio do funil com o número do processo em
 * `custom_fields.numero_processo` (ADR 0003), e o vínculo com a pessoa já é
 * `crm_leads.contact_id`: um contato, vários casos. Não há tabela nova.
 *
 * Quem chama é o agente, que roda no worker com o pool do Postgres (sem RLS).
 * Então o isolamento é DESTA consulta: organização E contato no `where`, os
 * dois vindos da linha do job, nunca do modelo. Contato sem caso ligado devolve
 * lista vazia — e lista vazia é "não falo de processo nenhum" (critério 1).
 */
import { chaveDeProcesso } from "./amarrar";
import { CAMPO_DO_PROCESSO } from "./caixa";
import { legivel, leTipoDeAto, sombra } from "./ler";

/** O que o pool do `pg` e um `PoolClient` têm em comum — basta para ler. */
export type Consultavel = {
  query<R = Record<string, unknown>>(texto: string, valores?: unknown[]): Promise<{ rows: R[] }>;
};

export type CasoDoContato = {
  id: string;
  titulo: string;
  numeroProcesso: string;
  /** E4: marcado como segredo de justiça no negócio. */
  sigiloso: boolean;
};

/** E4: a chave em `crm_leads.custom_fields` que marca o caso como segredo de justiça. */
export const CAMPO_DO_SIGILO = "segredo_de_justica";

const NAO_SIGILOSO = new Set(["", "false", "nao", "n", "0"]);

/**
 * Falha fechado: só "não" explícito libera. Valor estranho (`"sim"`, `"S"`,
 * `{}`, `1`) conta como sigilo — perguntar ao advogado custa um retorno;
 * descrever processo sigiloso pelo WhatsApp não tem volta.
 */
export function marcadoComoSigiloso(valor: unknown): boolean {
  if (valor === undefined || valor === null || valor === false || valor === 0) return false;
  if (typeof valor === "string") return !NAO_SIGILOSO.has(sombra(valor.trim()));
  return true;
}

/** A publicação que fala em segredo de justiça também fecha a consulta. */
export function textoFalaDeSigilo(texto: string): boolean {
  return /\bsegredo de justica\b|\bsigilos[oa]s?\b/.test(sombra(legivel(texto)));
}

export type QuemPergunta = {
  /** Da linha do job/conversa — nunca do texto do modelo. */
  organizationId: string;
  contactId: string;
};

export async function casosDoContato(db: Consultavel, quem: QuemPergunta): Promise<CasoDoContato[]> {
  const { rows } = await db.query<{ id: string; title: string; numero: string; sigilo: unknown }>(
    `select id, title, btrim(custom_fields->>$3) as numero, custom_fields->$4 as sigilo
       from public.crm_leads
      where organization_id = $1
        and contact_id = $2
        and coalesce(btrim(custom_fields->>$3), '') <> ''
      order by updated_at desc`,
    [quem.organizationId, quem.contactId, CAMPO_DO_PROCESSO, CAMPO_DO_SIGILO],
  );
  return rows.map((r) => ({
    id: r.id,
    titulo: r.title,
    numeroProcesso: r.numero,
    sigiloso: marcadoComoSigiloso(r.sigilo),
  }));
}

/**
 * E2 — o que a ferramenta do agente devolve: as últimas publicações dos casos
 * DESTE contato, com data, tipo de ato e o trecho que o fundamenta. Nada de
 * caso alheio, nada de publicação descartada como "não é nossa", e nunca o teor
 * inteiro — o agente conta o que aconteceu, com a prova ao lado.
 */
export type Andamento = {
  numeroProcesso: string;
  /** `YYYY-MM-DD`, o dia da disponibilização no DJEN. */
  data: string;
  /** `null` = nenhum tipo conhecido no texto; o agente não inventa. */
  tipoDeAto: string | null;
  trecho: string | null;
  siglaTribunal: string | null;
};

export type ConsultaDoCaso = {
  casos: CasoDoContato[];
  andamentos: Andamento[];
  /**
   * E4: algum caso do contato é sigiloso, ou alguma publicação fala em segredo
   * de justiça. Aí `andamentos` vem vazio e o agente passa para humano — sem
   * descrever nada, nem os outros casos (não dá para saber de qual a pessoa
   * está perguntando).
   */
  sigiloso: boolean;
};

/** Quantas publicações a ferramenta devolve, no máximo. */
export const LIMITE_DE_ANDAMENTOS = 5;

export async function consultaDoCaso(
  db: Consultavel,
  quem: QuemPergunta,
  limite = LIMITE_DE_ANDAMENTOS,
): Promise<ConsultaDoCaso> {
  const casos = await casosDoContato(db, quem);
  const chaves = [...new Set(casos.map((c) => chaveDeProcesso(c.numeroProcesso)).filter((c): c is string => c !== null))];
  if (casos.some((c) => c.sigiloso)) return { casos, andamentos: [], sigiloso: true };
  if (chaves.length === 0) return { casos, andamentos: [], sigiloso: false };

  // ponytail: casa pelos dígitos no SQL (sem índice de expressão); basta para dezenas de casos por contato.
  const { rows } = await db.query<{ numero: string; data: string; sigla: string | null; texto: string }>(
    `select numero_processo as numero,
            to_char(data_disponibilizacao, 'YYYY-MM-DD') as data,
            sigla_tribunal as sigla,
            texto
       from public.djen_publicacoes
      where organization_id = $1
        and descartada_em is null
        and regexp_replace(coalesce(numero_processo, ''), '[^0-9]', '', 'g') = any($2::text[])
      order by data_disponibilizacao desc, id
      limit $3`,
    [quem.organizationId, chaves, limite],
  );
  // ponytail: só olha as `limite` mais novas; a marca no negócio é a defesa principal.
  if (rows.some((r) => textoFalaDeSigilo(r.texto))) return { casos, andamentos: [], sigiloso: true };
  const andamentos = rows.map((r) => {
    const ato = leTipoDeAto(r.texto);
    return { numeroProcesso: r.numero, data: r.data, tipoDeAto: ato?.tipo ?? null, trecho: ato?.trecho ?? null, siglaTribunal: r.sigla };
  });
  return { casos, andamentos, sigiloso: false };
}
