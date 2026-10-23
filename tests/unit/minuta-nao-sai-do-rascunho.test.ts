import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AVISO_DA_MINUTA } from "@/lib/acervo/minuta";

import { alcance, arestas, arquivosDeProducao, rel } from "./_grafo-de-importacao";

/**
 * 0005.E5 (#38) — a minuta nasce e permanece RASCUNHO, e nenhum caminho de código
 * a protocola, envia, assina ou exporta para sistema externo (critérios 6 e 7).
 *
 * ═══ POR QUE GRAFO, E NÃO SÓ VARREDURA DE PALAVRA ═══
 *
 * O molde (`djen-nao-peticiona.test.ts`) varre uma pasta atrás do verbo, e declara o
 * próprio limite: "uma rota que chamasse um serviço externo de peticionamento ficaria
 * fora do alcance daqui". Aqui o limite cai: o teste segue as importações de RUNTIME
 * a partir da minuta (para a frente) e a partir de quem a usa (para trás), e reprova
 * se qualquer um dos dois lados alcança um módulo que fala com a rede fora da lista
 * fechada abaixo.
 *
 * ═══ POR QUE "CHAMADA DE REDE", E NÃO "PASTA DE CANAL" ═══
 *
 * Medido em 22/10/2026: a minuta alcança 82 módulos, e dois moram em pasta de canal
 * (`lib/channels/phone-variants.ts`, `lib/messaging/contact-card.ts`) — os dois são
 * formatação de telefone e de cartão de contato, sem rede. Reprovar por pasta
 * reprovaria o legítimo, e trava que reprova o legítimo é trava que alguém desliga.
 * O que tira a peça do escritório é chamada de rede; é isso que se conta.
 *
 * ═══ QUEM USA A MINUTA, E A TRAVA DE RELEITURA ═══
 *
 * Até 22/10/2026 nenhum arquivo de produção importava a minuta. Em 23/10/2026 entrou
 * o primeiro: `app/api/v1/acervo/minutas/route.ts` (0005.E2, a conferência pelo
 * advogado). Prova relida antes de abrir a trava. A rota:
 *   - lê o acervo com a SESSÃO (transporte do Supabase, já na lista permitida);
 *   - chama embedding e modelo pela biblioteca de IA (fora do grafo — o mesmo
 *     limite declarado abaixo, decisão da 0002);
 *   - devolve a minuta e o texto do arquivo SÓ para quem pediu, na resposta HTTP;
 *     não grava, não enfileira, não chama canal. O advogado baixa no navegador.
 * Os braços de rede examinam o que a rota ALCANÇA e também o PRÓPRIO arquivo dela
 * (`alcance()` exclui o ponto de partida: sem o segundo passo, um `fetch(` escrito
 * direto na rota passava — achado de revisão em 23/10/2026). A checagem de nomes de
 * saída cobre `minuta.ts`, `minuta-em-texto.ts` (que só importa o TIPO da minuta e por
 * isso o grafo não o vê como usuário) e cada importador.
 * A TRAVA continua: ela aceita exatamente esta rota. O próximo arquivo de produção
 * que importar a minuta fica vermelho e obriga a reler esta prova de novo.
 *
 * ═══ O QUE ESTE TESTE NÃO PROVA ═══
 *
 * - Chamada de rede por forma fora de `ehChamadaDeRede` (um SDK novo, `fetch` guardado
 *   numa variável) passa.
 * - A lista permitida libera o ARQUIVO inteiro: um `fetch` novo dentro de um deles entra
 *   sem aviso. `fetch-do-servidor.ts` é o transporte de toda chamada ao Supabase.
 * - A chamada ao provedor do modelo sai pela biblioteca de IA em `node_modules`, fora do
 *   grafo: o grafo só anda no código do repositório. O pedido ao modelo leva os trechos
 *   do acervo — é a geração, não a entrega da peça, decisão declarada da 0002.
 * - FILA e MINUTA SALVA: um código que enfileire o texto (insert consumido por um
 *   worker que envia) ou que leia uma minuta gravada no banco e a mande por um canal
 *   genérico não importa a minuta, e o grafo não vê. Hoje não existe minuta persistida
 *   (nenhuma tabela, nenhuma migration); quando existir, esta prova precisa de um
 *   segundo braço sobre a tabela.
 *
 * MUTAÇÃO (22/10/2026, cinco, todas acusadas, refeitas depois da revisão): a minuta importar `lib/waha/client`;
 * ganhar `export function enviaMinuta`; uma rota nova importar a minuta e
 * `lib/email/resend`; o aviso perder "a revisão é do advogado"; o resolvedor do grafo
 * deixar de achar arquivo (os controles positivos ficam vermelhos).
 * MUTAÇÃO (23/10/2026, três, todas acusadas, desfeitas): `await fetch("https://x")` escrito direto
 * em `app/api/v1/acervo/minutas/route.ts`; `export function enviaMinuta` em `minuta-em-texto.ts`;
 * `const enviaPorEmail` dentro da rota.
 */

const RAIZ = process.cwd();
const MINUTA = join(RAIZ, "lib/acervo/minuta.ts");
/** Escreve o arquivo da minuta; só importa o TIPO dela, então o grafo de runtime não o liga a `MINUTA`. */
const MINUTA_EM_TEXTO = join(RAIZ, "lib/acervo/minuta-em-texto.ts");

/** Formas de chamada de rede reconhecíveis no código do repositório. */
const REDE = /\bfetch\(|\bfetchComTeto\(|\bnew\s+(?:Resend|WebSocket)\b|\.sendNotification\(|\bgoogle\.calendar\(|\bnodemailer\b|\baxios\b|\bhttps?\.request\(|\bXMLHttpRequest\b|\bsendBeacon\(|\.functions\.invoke\(|from\s+["'](?:undici|got|ky|node-fetch|cross-fetch)["']|from\s+["'](?:node:)?(?:http|https|tls|dgram|child_process)["']|require\(\s*["'](?:node:)?(?:http|https|tls|net|child_process)["']\s*\)/;

/**
 * `node:net` só conta como rede quando o import traz algo além dos validadores de
 * endereço. Medido em 22/10/2026: dois arquivos no alcance da minuta
 * (`lib/automation/destinos-internos-autorizados.ts`, `outbound-ip.ts`) importam só
 * `isIPv4`/`isIPv6` — é a guarda contra destino interno, sem conexão nenhuma.
 */
const VALIDADORES_DE_IP = new Set(["isIP", "isIPv4", "isIPv6"]);
function importaSocket(codigo: string): boolean {
  for (const m of codigo.matchAll(/import\s+([^;]*?)\s+from\s+["'](?:node:)?net["']/g)) {
    const nomes = m[1]!.match(/\{([^}]*)\}/)?.[1]?.split(",").map((n) => n.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
    if (!nomes || nomes.some((n) => !VALIDADORES_DE_IP.has(n))) return true;
  }
  return false;
}

function ehChamadaDeRede(fonte: string): boolean {
  const codigo = semComentarios(fonte);
  return REDE.test(codigo) || importaSocket(codigo);
}

/**
 * As ÚNICAS chamadas de rede que a minuta pode alcançar, cada uma com o motivo.
 * Entrar uma nova aqui é decisão de quem revisa, não ajuste para o teste passar.
 */
const REDE_PERMITIDA: Record<string, string> = {
  "lib/supabase/fetch-do-servidor.ts": "o banco do próprio escritório (Supabase), de onde vem o acervo",
  "lib/ai/pontos/pkce-da-assinatura.ts": "login no provedor do modelo, para gerar a minuta",
  "lib/ai/provider-validators.ts": "validação da chave do provedor do modelo",
};

function semComentarios(f: string): string {
  return f.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const falaComARede = (arquivo: string) => ehChamadaDeRede(readFileSync(arquivo, "utf8"));

/** O que `arquivo` alcança que fala com a rede e NÃO está na lista permitida, com o caminho. */
function saidasAlcancadas(arquivo: string): string[] {
  const achados: string[] = [];
  for (const [f, caminho] of alcance(arquivo)) {
    if (falaComARede(f) && !(rel(f) in REDE_PERMITIDA)) achados.push(caminho.map(rel).join(" → "));
  }
  return achados;
}

/**
 * `saidasAlcancadas` mais o PRÓPRIO `arquivo`: `alcance()` exclui o ponto de partida, e a
 * rota que usa a minuta é justamente onde uma chamada de rede escrita à mão sairia calada.
 */
function saidasDe(arquivo: string): string[] {
  const proprio = falaComARede(arquivo) && !(rel(arquivo) in REDE_PERMITIDA) ? [`${rel(arquivo)} (o próprio arquivo)`] : [];
  return [...proprio, ...saidasAlcancadas(arquivo)];
}

/** Todo arquivo de produção que alcança `alvo` em runtime. */
function quemUsa(alvo: string): string[] {
  const producao = [
    ...arquivosDeProducao(["app", "lib", "components", "workers", "scripts", "hooks"]),
    ...["instrumentation.ts", "middleware.ts"].map((f) => join(RAIZ, f)).filter((f) => existsSync(f)),
  ];
  const reverso = new Map<string, string[]>();
  for (const f of producao) for (const dep of arestas(f)) reverso.set(dep, [...(reverso.get(dep) ?? []), f]);
  const vistos = new Set<string>();
  const fila = [alvo];
  while (fila.length) {
    for (const quem of reverso.get(fila.shift()!) ?? []) {
      if (vistos.has(quem)) continue;
      vistos.add(quem);
      fila.push(quem);
    }
  }
  return [...vistos];
}

/** Nome de função ou variável que é ato de saída. Casa no identificador, não no texto. */
// `envi` sozinho casaria `environment`: o radical exige a forma do verbo (envia, enviar, envio).
// `exporta` só como verbo: seguido de maiúscula ou do fim do nome (`exportaParaSistema`,
// `exportar`), nunca `exportados` — medido: a primeira versão reprovava esse nome legítimo.
// Sem a flag `i`: com ela, `[A-Z]` casaria minúscula e a fronteira do `exporta` some. A
// primeira letra do nome é que se normaliza (`EnviaMinuta` continua sendo pego).
const NOME_DE_SAIDA = /^(?:protocol|peticion|ajuiz|assina(?!tur)|assinar|envi(?:a|o)|send|upload|submit|exportar?(?=[A-Z_]|$)|transmit|entreg|publica|dispara|encaminha)/;
const ehNomeDeSaida = (nome: string) => NOME_DE_SAIDA.test(nome.charAt(0).toLowerCase() + nome.slice(1));

function identificadores(fonte: string): string[] {
  const codigo = semComentarios(fonte)
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, " ")
    .replace(/"(?:\\.|[^"\\\n])*"/g, " ")
    .replace(/'(?:\\.|[^'\\\n])*'/g, " ")
    .replace(/\/(?:\\.|\[[^\]\n]*\]|[^/\n\\[])+\/[gimsuy]*/g, " ");
  return [...new Set(codigo.match(/[A-Za-z_$][\w$]*/g) ?? [])];
}

describe("controles: a varredura enxerga o que diz enxergar", () => {
  it("o grafo da minuta tem as importações que ela de fato faz", () => {
    const a = alcance(MINUTA);
    expect([...a.keys()].map(rel)).toEqual(expect.arrayContaining(["lib/acervo/busca-por-problema.ts", "lib/acervo/leitura-por-modelo.ts"]));
    expect(a.size).toBeGreaterThan(10);
  });

  it("a detecção acusa um caminho de saída REAL: a fronteira do histórico alcança o cliente do WhatsApp", () => {
    const saidas = saidasAlcancadas(join(RAIZ, "lib/channels/historico-do-canal.ts"));
    expect(saidas.some((c) => c.endsWith("lib/waha/client.ts"))).toBe(true);
  });

  // Varre `app`, `lib`, `components`, `workers`, `scripts` e `hooks` inteiros: lento sob carga (16 s medido).
  it("o reverso acha quem usa: o cliente do WhatsApp tem quem o importe", { timeout: 60_000 }, () => {
    expect(quemUsa(join(RAIZ, "lib/waha/client.ts")).length).toBeGreaterThan(0);
  });

  it("o controle da checagem do próprio arquivo: `saidasDe` acusa um arquivo que fala com a rede mesmo sem importar nada", () => {
    // `lib/waha/client.ts` chama `fetch(`: como PONTO DE PARTIDA ele não aparece em `alcance()`, e `saidasDe` o acusa.
    const proprio = join(RAIZ, "lib/waha/client.ts");
    expect(saidasAlcancadas(proprio).some((c) => c === rel(proprio))).toBe(false);
    expect(saidasDe(proprio)).toContain(`${rel(proprio)} (o próprio arquivo)`);
  });

  it.each(["protocolaPeca", "peticionaNoPje", "assinaDocumento", "enviaMinuta", "enviarPeca", "sendDraft", "exportaParaSistema", "uploadPeca", "disparaEmail", "encaminhaAoCliente"])(
    "o controle NEGATIVO acusa o nome '%s'",
    (nome) => expect(ehNomeDeSaida(nome)).toBe(true),
  );

  it.each(["environment", "envelope", "assinatura", "exportados", "publicKey"])(
    "o radical não reprova o legítimo: '%s' passa",
    (nome) => expect(ehNomeDeSaida(nome)).toBe(false),
  );

  it.each([
    `await fetch(url)`,
    `import { request } from "undici";`,
    `import got from "got";`,
    `import https from "node:https";`,
    `import { createConnection } from "node:net";`,
    `import * as net from "net";`,
    `const x = new XMLHttpRequest();`,
    `navigator.sendBeacon(url, corpo);`,
    `await supabase.functions.invoke("envia", { body });`,
    `const { spawn } = require("node:child_process");`,
  ])("a detecção de rede acusa: %s", (codigo) => expect(ehChamadaDeRede(codigo)).toBe(true));

  it("a guarda de IP (só isIPv4/isIPv6 de node:net) não conta como rede", () => {
    expect(ehChamadaDeRede(`import { isIPv4, isIPv6 } from "node:net";`)).toBe(false);
  });
});

describe("TRAVA DE RELEITURA — quem usa a minuta em produção foi relido, um por um", () => {
  it("só a rota da conferência (relida em 23/10/2026) importa a minuta; um novo importador obriga a reler esta prova", () => {
    expect(quemUsa(MINUTA).map(rel).sort()).toEqual(["app/api/v1/acervo/minutas/route.ts"]);
  });
});

describe("critério 6 — nenhum caminho tira a minuta do escritório", () => {
  it("a minuta e o arquivo que a escreve não falam com a rede nem alcançam chamada de rede fora da lista permitida", () => {
    expect(saidasDe(MINUTA)).toEqual([]);
    expect(saidasDe(MINUTA_EM_TEXTO)).toEqual([]);
  });

  it("ninguém que usa a minuta fala com a rede, nem alcança chamada de rede fora da lista permitida", () => {
    const infratores = quemUsa(MINUTA).flatMap((f) => saidasDe(f).map((c) => `${rel(f)}: ${c}`));
    expect(infratores).toEqual([]);
  });

  it("a lista permitida não tem entrada morta: cada uma ainda é alcançada e ainda fala com a rede", () => {
    const alcancados = new Set([...alcance(MINUTA).keys()].map(rel));
    for (const f of Object.keys(REDE_PERMITIDA)) {
      expect(alcancados.has(f), `${f} saiu do alcance — tire da lista`).toBe(true);
      expect(falaComARede(join(RAIZ, f)), `${f} não fala mais com a rede — tire da lista`).toBe(true);
    }
  });

  it("nenhuma função ou variável da minuta, do arquivo dela e de quem a usa é ato de saída (protocolar, enviar, assinar, exportar…)", () => {
    const arquivos = [MINUTA, MINUTA_EM_TEXTO, ...quemUsa(MINUTA)];
    const achados = arquivos.flatMap((f) => identificadores(readFileSync(f, "utf8")).filter(ehNomeDeSaida).map((n) => `${rel(f)}: ${n}`));
    expect(achados).toEqual([]);
  });
});

describe("critério 7 — a minuta se declara rascunho, e a revisão é do advogado", () => {
  it("o aviso diz as duas coisas", () => {
    expect(AVISO_DA_MINUTA).toMatch(/RASCUNHO/);
    expect(AVISO_DA_MINUTA).toMatch(/revisão é do advogado/i);
  });
});
