/**
 * O que o pool do `pg` e um `PoolClient` têm em comum — basta para a triagem.
 * O agente roda no worker, com o pool do Postgres (sem RLS): o isolamento entre
 * escritórios é do `where organization_id = $1` de cada consulta deste módulo,
 * e o id da organização vem da linha do job, nunca do modelo.
 */
export type Consultavel = {
  query<R = Record<string, unknown>>(texto: string, valores?: unknown[]): Promise<{ rows: R[] }>;
};

/** Quem está no turno. Os três vêm da linha do job. */
export type QuemEstaNoTurno = { organizationId: string; contactId: string; conversationId: string };
