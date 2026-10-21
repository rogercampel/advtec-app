import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Critério 9 da spec 0006, no mesmo molde do gate de captação ativa da 0001:
 *
 *   "Nenhum caminho de código protocola, peticiona ou responde qualquer coisa
 *    em nome do advogado. Teste varrendo o código."
 *
 * ═══ POR QUE VARREDURA, E NÃO CONFIANÇA ═══
 *
 * O sistema lê intimação e sugere prazo. A distância entre "sugere prazo" e
 * "peticiona sozinho" é uma linha de código que alguém escreve com boa
 * intenção, num sábado, para "economizar um clique do doutor".
 *
 * Não existe correção depois: peticionar em nome de advogado sem mandato é
 * exercício irregular. Então a trava é estrutural — o verbo não entra no
 * módulo, e o teste reprova o build se entrar.
 *
 * ═══ O QUE ESTE TESTE NÃO PROVA ═══
 *
 * Que o produto inteiro não peticiona. Ele varre `lib/djen/`, que é onde a
 * tentação mora. Uma rota que chamasse um serviço externo de peticionamento
 * ficaria fora do alcance daqui — e é por isso que este teste não substitui a
 * revisão humana, só barra o caminho mais provável.
 *
 * MUTAÇÃO (19/08/2026): acrescentando `export function peticiona() {}` em
 * `lib/djen/alarme.ts`, este arquivo fica vermelho.
 */

const RAIZ = join(process.cwd(), "lib", "djen");

/**
 * Verbos de ATO PROCESSUAL. Não entram nomes genéricos ("enviar", "responder"):
 * o módulo envia alarme e responde promessa o tempo todo, e um padrão que
 * reprova o legítimo é um padrão que alguém desliga.
 */
const VERBOS_PROIBIDOS = [
  /\bpeticion(a|ar|amento)/,
  /\bprotocol(a|ar)\b/,
  /\bajuiz(a|ar)\b/,
  /\binterpo(e|r)\s+recurso/,
  /\bcontesta(r|cao)\b/,
  /\bassina(r)?\s+(peticao|documento)\s+/,
];

/**
 * Sem acento e em minúscula, ANTES de casar.
 *
 * A primeira versão deste arquivo escrevia `/interpo(e|r)\s+recurso/` e não
 * pegava "interpõe recurso" — o mesmo defeito de vogal acentuada que já custou o
 * portão da OAB, agora pela terceira vez no projeto. Quem acusou foi o controle
 * negativo abaixo, e é exatamente para isso que ele existe.
 *
 * A defesa não é escrever regex mais esperto: é tirar o acento do texto e
 * escrever todo padrão em ASCII, para a classe do defeito deixar de ser possível
 * em vez de ser evitada com cuidado a cada linha nova.
 */
function normaliza(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function arquivosTs(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) saida.push(...arquivosTs(caminho));
    else if (nome.endsWith(".ts")) saida.push(caminho);
  }
  return saida;
}

/** Tira comentário: o cabeçalho deste próprio módulo cita os verbos que proíbe. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("nenhum caminho do DJEN pratica ato processual", () => {
  const arquivos = arquivosTs(RAIZ);

  it("a varredura enxerga o código — controle positivo antes de qualquer conclusão", () => {
    // Sem isto, uma varredura quebrada (pasta errada, glob vazio) passaria verde
    // e o gate viraria enfeite. É o mesmo controle que a base usa nos dela.
    expect(arquivos.length).toBeGreaterThan(0);
    const total = arquivos.map((f) => readFileSync(f, "utf8")).join("");
    expect(total).toMatch(/export function/);
  });

  it.each(["peticiona", "protocola", "ajuiza", "interpõe recurso", "contestar"])(
    "o controle NEGATIVO acusa: '%s' seria pego",
    (frase) => {
      expect(VERBOS_PROIBIDOS.some((r) => r.test(normaliza(frase)))).toBe(true);
    },
  );

  it("nenhum arquivo de lib/djen contém verbo de ato processual", () => {
    const infratores: string[] = [];
    for (const f of arquivos) {
      const codigo = normaliza(semComentarios(readFileSync(f, "utf8")));
      for (const r of VERBOS_PROIBIDOS) {
        const m = r.exec(codigo);
        if (m) infratores.push(`${f.replace(process.cwd(), "")} → ${m[0]}`);
      }
    }
    expect(infratores).toEqual([]);
  });
});
