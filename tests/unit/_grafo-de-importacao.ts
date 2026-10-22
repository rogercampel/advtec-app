import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Grafo de importação de RUNTIME do repositório, para as travas que perguntam
 * "este módulo alcança aquele?" (0005.E5).
 *
 * Conta `import … from`, `export … from`, `import("…")` e `require("…")` com
 * caminho literal. NÃO conta `import type` / `export type`: tipo não vira código
 * que roda, e uma trava de "caminho de código" que acusasse tipo reprovaria o
 * legítimo — que é como uma trava vira coisa que alguém desliga.
 *
 * Resolve `@/x` para a raiz do repositório e caminho relativo para o arquivo; tenta
 * `.ts`, `.tsx`, `/index.ts`, `/index.tsx`. Pacote de `node_modules` não entra.
 */

const RAIZ = process.cwd();
const EXTENSOES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

/** Caminho relativo à raiz, com barra normal — a forma em que as travas comparam. */
export const rel = (abs: string) => relative(RAIZ, abs).split("\\").join("/");

function resolveEspecificador(de: string, esp: string): string | null {
  let base: string;
  if (esp.startsWith("@/")) base = join(RAIZ, esp.slice(2));
  else if (esp.startsWith(".")) base = resolve(dirname(de), esp);
  else return null;
  for (const ext of EXTENSOES) {
    const c = base + ext;
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Os especificadores de runtime de um arquivo-fonte. */
export function importacoesDeRuntime(fonte: string): string[] {
  const semComentario = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const achados: string[] = [];
  const padroes = [
    /^\s*import\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/gm,
    /^\s*export\s+(?!type\b)[^'";]*?\sfrom\s+["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of padroes) for (const m of semComentario.matchAll(re)) achados.push(m[1]!);
  return achados;
}

const cacheDeArestas = new Map<string, string[]>();

export function arestas(arquivo: string): string[] {
  const guardado = cacheDeArestas.get(arquivo);
  if (guardado) return guardado;
  const saida = importacoesDeRuntime(readFileSync(arquivo, "utf8"))
    .map((e) => resolveEspecificador(arquivo, e))
    .filter((x): x is string => x !== null);
  cacheDeArestas.set(arquivo, saida);
  return saida;
}

/** Tudo o que `inicio` alcança em runtime (sem ele mesmo), com o caminho até cada um. */
export function alcance(inicio: string): Map<string, string[]> {
  const caminho = new Map<string, string[]>([[inicio, [inicio]]]);
  const fila = [inicio];
  while (fila.length) {
    const atual = fila.shift()!;
    for (const prox of arestas(atual)) {
      if (caminho.has(prox)) continue;
      caminho.set(prox, [...caminho.get(atual)!, prox]);
      fila.push(prox);
    }
  }
  caminho.delete(inicio);
  return caminho;
}

/** Todo `.ts`/`.tsx` de produção sob as pastas dadas (sem teste). */
export function arquivosDeProducao(pastas: string[]): string[] {
  const saida: string[] = [];
  const anda = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const c = join(dir, nome);
      if (statSync(c).isDirectory()) anda(c);
      else if (/\.(ts|tsx)$/.test(nome) && !/\.(test|spec)\.(ts|tsx)$/.test(nome) && !nome.endsWith(".d.ts")) saida.push(c);
    }
  };
  for (const p of pastas) anda(join(RAIZ, p));
  return saida;
}
