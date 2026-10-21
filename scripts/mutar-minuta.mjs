// Mutação da trava da minuta (0005.E1): tira cada regra de lib/acervo/minuta.ts e confere que
// tests/unit/acervo-minuta.test.ts acusa. Restaura o arquivo no fim. Uso: node scripts/mutar-minuta.mjs
import fs from "node:fs";
import { execSync } from "node:child_process";
const F = "lib/acervo/minuta.ts"; // rodar da raiz: node scripts/mutar-minuta.mjs
const original = fs.readFileSync(F, "utf8");
const mutacoes = [
  ["algarismo no texto do modelo", `if (/\\d/.test(invisiveis(frase).normalize("NFKC"))) return "numero_no_texto";`, ""],
  ["cara de citação", `if (CARA_DE_CITACAO.test(forma(frase))) return "cara_de_citacao";`, ""],
  ["cópia do acervo aceita sem conferir", `if (copiaDoAcervo(frase, acervo)) return null;`, `if (true) return null;`],
  ["cópia sem mínimo de palavras", `if (p.length < PALAVRAS_PARA_SER_COPIA) return false;`, ""],
  ["cópia por substring (sem limite de palavra)", "const alvo = ` ${p.join(\" \")} `;", "const alvo = p.join(\" \");"],
  ["CITA sem conferir literal", `|| !literalEm(frase, t.texto)) {`, `) {`],
  ["CITA sem conferir trecho", `if (!t || n < PALAVRAS_DA_CITACAO.minimo`, `if (n < PALAVRAS_DA_CITACAO.minimo`],
  ["CITA sem mínimo de palavras", `n < PALAVRAS_DA_CITACAO.minimo || `, ``],
  ["S.T.J. sem juntar letras", "replace(/\\b(?:[a-z]\\.\\s?){2,}/g, (m) => `${m.replace(/[.\\s]/g, \"\")} `)", "toString()"],
  ["invisível não sai", `const invisiveis = (s: string) => s.replace(/\\p{Cf}/gu, "");`, `const invisiveis = (s: string) => s;`],
  ["julgado procedente vira citação", `"\\\\bjulgados?\\\\b(?! (procedente|improcedente|parcialmente|extint))",`, `"\\\\bjulgados?\\\\b",`],
  ["numeração de seção como número", `const numeracao = linha.match(NUMERACAO)?.[0] ?? "";`, `const numeracao = "";`],
  ["quebra de linha dentro do CITA", `.replace(/\\[[^\\]]*\\]/g, (m) => m.replace(/\\s*\\n\\s*/g, " "));`, `;`],
  ["parágrafo perdido", `return { texto: linhas.join("\\n").trim(), retirou };`, `return { texto: linhas.join(" ").trim(), retirou };`],
  ["marcas seguidas não fundem", `if (saida[saida.length - 1] !== MARCA_DO_RETIRADO) saida.push(MARCA_DO_RETIRADO);`, `saida.push(MARCA_DO_RETIRADO);`],
  ["pontuação solta", `.replace(/\\]\\s+([.,;:)])/g, "]$1")`, ``],
  ["abreviatura corta a frase", `if (!ABREVIATURA.test(atual.trimEnd())) {`, `if (true) {`],
  ["colchete cortado por dentro", `if (parte.startsWith("[") && parte.endsWith("]")) {`, `if (false) {`],
  ["o que faltou sem a regra", `const { texto: conferido, retirou } = confere(f, c);`, `const conferido = f.trim(), retirou = false;`],
  ["sem base só com zero blocos", `if (!blocos.some((b) => !b.novo && semMarcas(b.texto) !== "")) return`, `if (blocos.length === 0) return`],
  ["fonte inventada aceita", `.filter((f) => c.trechoDe.has(f));`, `;`],
  ["nada no acervo vira falha", `if (busca.situacao === "nada_no_acervo") return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };`, `if (busca.situacao === "nada_no_acervo") return { situacao: "falha", codigo: "x" };`],
  ["fora do formato vira sem base", `if (!lido.success) return { situacao: "falha", codigo: "formato" };`, `if (!lido.success) return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };`],
];
let acusadas = 0;
for (const [nome, de, para] of mutacoes) {
  if (original.split(de).length !== 2) { console.info("NÃO ACHEI:", nome); continue; }
  fs.writeFileSync(F, original.replace(de, () => para));
  let passou = true;
  try { execSync("pnpm exec vitest run tests/unit/acervo-minuta.test.ts", { stdio: "pipe" }); } catch { passou = false; }
  console.info(passou ? "ESCAPOU:" : "acusou: ", nome);
  if (!passou) acusadas++;
}
fs.writeFileSync(F, original);
console.info(`${acusadas} de ${mutacoes.length}`);
