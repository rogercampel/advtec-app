/**
 * Spec 0001.E3 (critérios 7, 8, 9 e a gravação do resumo) — num Postgres real.
 *
 *   7  área que o escritório não atende → recusa educada, sem guardar a história;
 *   8  parte contrária já cadastrada → para antes da coleta (e isolada por escritório);
 *   9  urgência (prazo/audiência/preso) → passa ao advogado, lida do banco, não do modelo;
 *   +  `custom_fields` do caso é MESCLADO (nunca apagado) e a nota na timeline não se repete.
 *
 * 24/10/2026: sem config a área só é registrada; o conflito grava ids e não o nome; `registraUrgenciaNoCaso`.
 * Os testes de banco novos NÃO foram rodados (Docker fora); a mesma lógica está coberta sem banco em
 * `lib/triagem/registrar-triagem.test.ts`.
 *
 * MUTAÇÕES (23/10/2026; cada uma aplicada, acusada pelo teste citado, e desfeita):
 *   - tirar `c.organization_id = $1` de `checaConflito` → "o cliente de OUTRO escritório não é conflito" acusa;
 *   - tirar `c.id <> $2` → "o próprio contato do turno não é a parte contrária" acusa;
 *   - tirar `c.is_merged_into is null` → "contato fundido em outro não conta" acusa;
 *   - tirar o `join crm_leads` (qualquer contato vira cliente) → "contato sem caso não é cliente" acusa;
 *   - em `executaRegistrarTriagem`, trocar a precedência (área antes de urgência) → "preso em área recusada" acusa;
 *   - gravar `resumo_do_caso` também na recusa → "recusa não guarda a história" acusa;
 *   - trocar `fn_lead_anotar_campos` por `set custom_fields = $campos` → "mescla sem apagar" acusa;
 *   - tirar `m.direction = 'inbound'` de `mensagensDoCliente` → "a fala do escritório não é urgência" acusa.
 *
 * Roda em `pnpm test:db`.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checaConflito, nomesDosContatosEmConflito } from "@/lib/triagem/conflito";
import { executaRegistrarTriagem, registraUrgenciaNoCaso } from "@/lib/triagem/registrar-triagem";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 3,
});
afterAll(() => pool.end());

const orgA = randomUUID();
const orgB = randomUUID();
const sessaoA = randomUUID();
const sessaoB = randomUUID();
const pipeA = randomUUID();
const stageA = randomUUID();
const pipeB = randomUUID();
const stageB = randomUUID();

const contatoMaria = randomUUID(); // cliente da org A: "Maria da Silva Souza"
const contatoSemCaso = randomUUID(); // org A, sem negócio: "João Pereira"
const contatoPerfil = randomUUID(); // org A, só display_name: "Pedro Alves Lima"
const contatoFundido = randomUUID(); // org A, fundido: "Rita Campos"
const contatoCarlosB = randomUUID(); // cliente da org B: "Carlos Andrade"

async function contato(org: string, id: string, name: string | null, display: string | null, extra: Record<string, unknown> = {}) {
  await pool.query("insert into contacts(id,organization_id,name,display_name,is_merged_into) values($1,$2,$3,$4,$5)", [
    id,
    org,
    name,
    display,
    extra.fundidoEm ?? null,
  ]);
}

async function caso(org: string, pipe: string, stage: string, contactId: string, campos: Record<string, unknown> = {}, status = "open") {
  const id = randomUUID();
  await pool.query(
    `insert into crm_leads(id,organization_id,pipeline_id,stage_id,contact_id,title,custom_fields,status,closed_at,lost_reason)
     values($1,$2,$3,$4,$5,'Caso',$6,$7, case when $7 = 'open' then null else now() end, case when $7 = 'lost' then 'no_response' else null end)`,
    [id, org, pipe, stage, contactId, campos, status],
  );
  return id;
}

/** Um cliente novo (contato + conversa + caso aberto) na org A, que escreve as `falas`. */
async function clienteNovo(falas: string[], opcoes: { org?: string; casos?: number } = {}) {
  const org = opcoes.org ?? orgA;
  const [pipe, stage, sessao] = org === orgA ? [pipeA, stageA, sessaoA] : [pipeB, stageB, sessaoB];
  const contactId = randomUUID();
  const conversationId = randomUUID();
  await contato(org, contactId, "Cliente de Teste", null);
  await pool.query("insert into conversations(id,organization_id,contact_id,channel_session_id,status) values($1,$2,$3,$4,'open')", [
    conversationId,
    org,
    contactId,
    sessao,
  ]);
  const casos: string[] = [];
  for (let i = 0; i < (opcoes.casos ?? 1); i++) casos.push(await caso(org, pipe, stage, contactId, { numero_processo: "0001234-56.2026.8.26.0100" }));
  for (const [i, fala] of falas.entries()) await fala_(org, conversationId, contactId, "inbound", fala, 1000 - i, sessao);
  return { quem: { organizationId: org, contactId, conversationId }, casos };
}

async function fala_(org: string, conversa: string, contactId: string, direcao: "inbound" | "outbound", corpo: string, segundos: number, sessao = sessaoA) {
  await pool.query(
    `insert into messages(organization_id,conversation_id,channel_session_id,contact_id,type,direction,body,created_at)
     values($1,$2,$3,$4,'text',$5,$6, now() - make_interval(secs => $7))`,
    [org, conversa, sessao, contactId, direcao, corpo, segundos],
  );
}

const camposDo = async (casoId: string) =>
  (await pool.query<{ custom_fields: Record<string, unknown> }>("select custom_fields from crm_leads where id = $1", [casoId])).rows[0]!.custom_fields;

beforeAll(async () => {
  for (const [org, pipe, stage] of [
    [orgA, pipeA, stageA],
    [orgB, pipeB, stageB],
  ] as const) {
    await pool.query("insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'Esc','Esc')", [org]);
    await pool.query("insert into crm_pipelines(id,organization_id,name,slug) values($1::uuid,$2,'Casos',$1::text)", [pipe, org]);
    await pool.query(
      "insert into crm_stages(id,organization_id,pipeline_id,name,slug,position) values($1,$2,$3,'Novo','novo',1)",
      [stage, org, pipe],
    );
  }
  await pool.query(
    `insert into channel_sessions(id,organization_id,provider,waha_session_name,status,webhook_secret_encrypted)
     values($1,$2,'waha',$3,'WORKING','\\x00'::bytea)`,
    [sessaoA, orgA, `triagem-${sessaoA}`],
  );
  await pool.query(
    `insert into channel_sessions(id,organization_id,provider,waha_session_name,status,webhook_secret_encrypted)
     values($1,$2,'waha',$3,'WORKING','\\x00'::bytea)`,
    [sessaoB, orgB, `triagem-${sessaoB}`],
  );
  // O escritório A é o piloto: atende trabalhista e família, recusa criminal. O B não configurou nada.
  await pool.query(
    `update organizations set settings = jsonb_set(coalesce(settings,'{}'::jsonb), '{triagem}', $2::jsonb) where id = $1`,
    [orgA, JSON.stringify({ areas_atendidas: ["trabalhista", "familia_sucessoes"], areas_recusadas: ["criminal"] })],
  );

  await contato(orgA, contatoMaria, "Maria da Silva Souza", null);
  await caso(orgA, pipeA, stageA, contatoMaria);
  await contato(orgA, contatoSemCaso, "João Pereira", null);
  await contato(orgA, contatoPerfil, null, "Pedro Alves Lima");
  await caso(orgA, pipeA, stageA, contatoPerfil, {}, "lost"); // negócio PERDIDO também conta (consulente)
  await contato(orgA, contatoFundido, "Rita Campos", null, { fundidoEm: contatoMaria });
  await caso(orgA, pipeA, stageA, contatoFundido);
  await contato(orgB, contatoCarlosB, "Carlos Andrade", null);
  await caso(orgB, pipeB, stageB, contatoCarlosB);
});

describe("critério 8: conflito de interesses", () => {
  const checa = (nome: string, org = orgA, turno: string | null = null) =>
    checaConflito(pool, { organizationId: org, contatoDoTurno: turno, nomeDaParteContraria: nome });

  it("nome igual, sem acento nem caixa, é possível conflito", async () => {
    const r = await checa("MARIA DA SILVA SOUZA");
    expect(r).toMatchObject({ resultado: "possivel_conflito", contatos: [{ contactId: contatoMaria, como: "igual", casos: 1 }] });
  });

  it("nome composto parecido (mesmo primeiro e último, meio omitido) é possível conflito", async () => {
    const r = await checa("maria souza");
    expect(r).toMatchObject({ resultado: "possivel_conflito", contatos: [{ contactId: contatoMaria, como: "parecido" }] });
  });

  it("nome solto não vira conflito por substring: 'Maria', 'Mari', 'Silva'", async () => {
    for (const n of ["Maria", "Mari", "Silva", "Souza"]) expect(await checa(n)).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("outra pessoa com o mesmo primeiro nome não é conflito", async () => {
    expect(await checa("Maria Oliveira")).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("contato sem caso não é cliente", async () => {
    expect(await checa("João Pereira")).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("negócio perdido conta, e o nome do perfil (display_name) também", async () => {
    expect(await checa("Pedro Alves Lima")).toMatchObject({ resultado: "possivel_conflito", contatos: [{ contactId: contatoPerfil }] });
  });

  it("contato fundido em outro não conta", async () => {
    expect(await checa("Rita Campos")).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("o próprio contato do turno não é a parte contrária de si mesmo", async () => {
    expect(await checa("Maria da Silva Souza", orgA, contatoMaria)).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("ISOLAMENTO: o cliente de OUTRO escritório não é conflito, e no dele é", async () => {
    expect(await checa("Carlos Andrade", orgA)).toEqual({ resultado: "sem_conflito", verificado: true });
    expect(await checa("Carlos Andrade", orgB)).toMatchObject({ resultado: "possivel_conflito", contatos: [{ contactId: contatoCarlosB }] });
    // e o cliente de A não aparece para B
    expect(await checa("Maria da Silva Souza", orgB)).toEqual({ resultado: "sem_conflito", verificado: true });
  });

  it("nome vazio ou sem letra: nada conferido, e a resposta diz isso", async () => {
    for (const n of ["", "   ", "???", "x"]) expect(await checa(n)).toEqual({ resultado: "sem_conflito", verificado: false });
  });
});

describe("registrar_triagem: o executor completo", () => {
  it("critério 7: área recusada, sem urgência → recusa educada e NÃO guarda a história", async () => {
    const c = await clienteNovo(["Boa tarde, preciso de um advogado para um processo de furto"]);
    const d = await executaRegistrarTriagem(pool, c.quem, {
      area_do_direito: "Criminal",
      resumo_do_caso: "Acusado de furto em loja",
      parte_contraria: "Loja Exemplo",
    });
    expect(d.acao).toBe("recusar");
    if (d.acao === "recusar") {
      expect(d.texto).toContain("não atua na área criminal");
      expect(d.texto).toContain("Não precisa nos contar os detalhes");
    }
    const cf = await camposDo(c.casos[0]!);
    expect(cf).toMatchObject({ area_do_direito: "Criminal", triagem_decisao: "recusar", triagem_motivo: "area_recusada" });
    expect(cf).not.toHaveProperty("resumo_do_caso");
    expect(cf).not.toHaveProperty("parte_contraria");
  });

  it("área atendida → segue e pede PRIMEIRO a outra parte, depois a história", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem, trabalhei 4 anos sem carteira assinada"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista" });
    expect(d).toMatchObject({ acao: "seguir", pendente: ["parte_contraria", "resumo_do_caso"], registro: { gravado: true, casoId: c.casos[0] } });
  });

  it("segue completo quando já tem a outra parte e o resumo; grava e MESCLA sem apagar o resto", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem, trabalhei 4 anos sem carteira assinada"]);
    const d = await executaRegistrarTriagem(pool, c.quem, {
      area_do_direito: "trabalhista",
      resumo_do_caso: "Trabalhou 4 anos sem registro e foi dispensada sem verbas.",
      parte_contraria: "Padaria Pão Quente Ltda",
    });
    expect(d).toMatchObject({ acao: "seguir", pendente: [] });
    const cf = await camposDo(c.casos[0]!);
    expect(cf).toMatchObject({
      numero_processo: "0001234-56.2026.8.26.0100", // o que já existia continua
      area_do_direito: "Trabalhista",
      resumo_do_caso: "Trabalhou 4 anos sem registro e foi dispensada sem verbas.",
      parte_contraria: "Padaria Pão Quente Ltda",
      triagem_decisao: "seguir",
    });
  });

  it("critério 9: preso → passa ao advogado, mesmo em área RECUSADA (urgência antes da recusa)", async () => {
    const c = await clienteNovo(["Meu filho foi preso agora de manhã, está na delegacia"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Criminal" });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "urgencia" });
    if (d.acao === "passar_ao_advogado") expect(d.urgencias[0]).toMatchObject({ tipo: "preso" });
    const cf = await camposDo(c.casos[0]!);
    expect(String(cf.urgencia_juridica)).toContain("foi preso");
    expect(cf).toMatchObject({ triagem_decisao: "passar_ao_advogado", triagem_motivo: "urgencia" });
  });

  it("critério 9: o prazo é lido do que o CLIENTE escreveu, mesmo que o modelo não marque urgência", async () => {
    const c = await clienteNovo(["Doutor, recebi uma citação e o prazo vence amanhã"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista", urgencia: false });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "urgencia" });
  });

  it("a marca do modelo só ACRESCENTA: 'nenhuma' e 'não há urgência' não contam, um tipo do léxico conta", async () => {
    const a = await clienteNovo(["Fui mandado embora ontem"]);
    expect((await executaRegistrarTriagem(pool, a.quem, { area_do_direito: "Trabalhista", urgencia: "nenhuma" })).acao).toBe("seguir");
    const a2 = await clienteNovo(["Fui mandado embora ontem"]);
    expect((await executaRegistrarTriagem(pool, a2.quem, { area_do_direito: "Trabalhista", urgencia: "não há urgência" })).acao).toBe("seguir");
    const b = await clienteNovo(["Fui mandado embora ontem"]);
    expect(
      await executaRegistrarTriagem(pool, b.quem, { area_do_direito: "Trabalhista", urgencia: "audiencia" }),
    ).toMatchObject({ acao: "passar_ao_advogado", motivo: "urgencia" });
  });

  it("a fala do ESCRITÓRIO não é urgência do cliente", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem"]);
    await fala_(orgA, c.quem.conversationId, c.quem.contactId, "outbound", "Se o prazo vence amanhã, me avise. Está preso?", 50);
    expect((await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista" })).acao).toBe("seguir");
  });

  it("critério 8: parte contrária já é cliente → passa ao advogado, sem coletar, e grava o aviso", async () => {
    const c = await clienteNovo(["Quero processar minha vizinha por causa do muro"]);
    const d = await executaRegistrarTriagem(pool, c.quem, {
      area_do_direito: "Família e sucessões",
      parte_contraria: "maria da silva souza",
      resumo_do_caso: "disputa por herança",
    });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "conflito" });
    if (d.acao === "passar_ao_advogado") {
      expect(d.conflito[0]).toMatchObject({ contactId: contatoMaria });
      expect(d.instrucao).toContain("NÃO diga ao cliente");
    }
    // o campo do caso leva `true` e ids — o nome do outro cliente NÃO entra em custom_fields
    const cf = await camposDo(c.casos[0]!);
    expect(cf.conflito_possivel).toBe(true);
    expect(cf.conflito_contatos).toEqual([contatoMaria]);
    expect(Array.isArray(cf.conflito_casos) && cf.conflito_casos.length).toBe(1);
    expect(JSON.stringify(cf)).not.toContain("Maria da Silva Souza");
    expect(cf).not.toHaveProperty("conflito_de_interesses");
    // quem mostra o nome ao advogado é a consulta, filtrada pela organização
    expect(await nomesDosContatosEmConflito(pool, orgA, cf.conflito_contatos as string[])).toEqual([{ contactId: contatoMaria, nome: "Maria da Silva Souza" }]);
    expect(await nomesDosContatosEmConflito(pool, orgB, cf.conflito_contatos as string[])).toEqual([]);
  });

  it("ISOLAMENTO no executor: o cliente do escritório B não trava a triagem do A", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista", parte_contraria: "Carlos Andrade" });
    expect(d.acao).toBe("seguir");
  });

  it("área que ninguém decidiu → advogado decide (NÃO recusa)", async () => {
    const c = await clienteNovo(["O INSS cortou meu benefício"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Previdenciário" });
    expect(d).toMatchObject({ acao: "passar_ao_advogado", motivo: "area_a_decidir" });
  });

  it("escritório que não configurou nada: a área só é registrada — não recusa e não manda ao advogado", async () => {
    const c = await clienteNovo(["Preciso de ajuda com um processo de furto"], { org: orgB });
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Criminal" });
    expect(d).toMatchObject({ acao: "seguir", registro: { gravado: true } });
    expect(await camposDo(c.casos[0]!)).toMatchObject({ area_do_direito: "Criminal", triagem_decisao: "seguir" });
  });

  it("sem config a urgência e o conflito continuam valendo", async () => {
    const u = await clienteNovo(["Meu prazo no processo vence amanhã"], { org: orgB });
    expect(await executaRegistrarTriagem(pool, u.quem, { area_do_direito: "Trabalhista" })).toMatchObject({ motivo: "urgencia" });
    const c = await clienteNovo(["Fui mandado embora ontem"], { org: orgB });
    expect(await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista", parte_contraria: "Carlos Andrade" })).toMatchObject({
      motivo: "conflito",
    });
  });

  it("registraUrgenciaNoCaso: mescla só a urgência e a data, sem tocar a decisão nem o resto; isolada por escritório", async () => {
    const c = await clienteNovo(["oi"]);
    await pool.query(
      "update crm_leads set custom_fields = custom_fields || $2::jsonb where id = $1",
      [c.casos[0], JSON.stringify({ triagem_decisao: "seguir", area_do_direito: "Trabalhista" })],
    );
    const r = await registraUrgenciaNoCaso(pool, c.quem, [{ tipo: "prazo", trecho: "meu prazo vence" }]);
    expect(r).toEqual({ gravado: true, casoId: c.casos[0] });
    const cf = await camposDo(c.casos[0]!);
    expect(cf).toMatchObject({ triagem_decisao: "seguir", area_do_direito: "Trabalhista", numero_processo: "0001234-56.2026.8.26.0100" });
    expect(String(cf.urgencia_juridica)).toContain("meu prazo vence");
    expect(typeof cf.triagem_em).toBe("string");
    // com a organização trocada não acha caso nenhum
    const fora = await registraUrgenciaNoCaso(pool, { ...c.quem, organizationId: orgB }, [{ tipo: "prazo", trecho: "x" }]);
    expect(fora.gravado).toBe(false);
  });

  it("o modelo diz 'Trabalhista' mas o cliente só falou de crime → não atende às cegas", async () => {
    const c = await clienteNovo(["Prenderam meu irmão e ele está na delegacia"]);
    const d = await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista" });
    expect(d.acao).toBe("passar_ao_advogado"); // aqui por urgência; a divergência de área sozinha também não atenderia
  });

  it("repetir a chamada não repete a nota na timeline; mudar a decisão cria outra", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem"]);
    const notas = async () =>
      Number(
        (await pool.query("select count(*) from crm_lead_activities where lead_id = $1 and source_module = 'triagem_juridica'", [c.casos[0]])).rows[0]
          .count,
      );
    await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista" });
    await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista", resumo_do_caso: "dispensa sem justa causa" });
    expect(await notas()).toBe(1);
    await executaRegistrarTriagem(pool, c.quem, { area_do_direito: "Trabalhista", urgencia: "prazo" });
    expect(await notas()).toBe(2);
  });

  it("sem caso aberto ou com mais de um empatado: decide, mas não grava (e diz por quê)", async () => {
    const semCaso = await clienteNovo(["Fui mandado embora ontem"], { casos: 0 });
    expect(await executaRegistrarTriagem(pool, semCaso.quem, { area_do_direito: "Trabalhista" })).toMatchObject({
      acao: "seguir",
      registro: { gravado: false, casoId: null, motivo: "sem_caso_aberto" },
    });
    const dois = await clienteNovo(["Fui mandado embora ontem"], { casos: 2 });
    await pool.query("update crm_leads set last_activity_at = '2026-10-01', created_at = '2026-10-01' where contact_id = $1", [dois.quem.contactId]);
    expect(await executaRegistrarTriagem(pool, dois.quem, { area_do_direito: "Trabalhista" })).toMatchObject({
      registro: { gravado: false, motivo: "varios_casos_abertos" },
    });
    for (const id of dois.casos) expect(await camposDo(id)).not.toHaveProperty("area_do_direito");
  });

  it("ISOLAMENTO na gravação: o caso de outro escritório nunca é tocado", async () => {
    const c = await clienteNovo(["Fui mandado embora ontem"]);
    const outro = await clienteNovo(["oi"], { org: orgB });
    // o contato do turno de A, mas rodando com a organização B: não acha caso e não grava no de A
    const d = await executaRegistrarTriagem(pool, { ...c.quem, organizationId: orgB }, { area_do_direito: "Trabalhista" });
    expect(d.registro.gravado).toBe(false);
    expect(await camposDo(c.casos[0]!)).not.toHaveProperty("area_do_direito");
    expect(await camposDo(outro.casos[0]!)).not.toHaveProperty("area_do_direito");
  });
});
