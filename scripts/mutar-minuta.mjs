// Mutação da trava da minuta (0005.E1): tira cada regra de lib/acervo/minuta.ts e confere
// que tests/unit/acervo-minuta.test.ts acusa (algum teste FALHA — erro de compilação ou de
// ambiente não conta). Roda antes uma vez sem mutação: se o teste já falha, nada vale.
// Restaura o arquivo no fim, mesmo se for interrompido. Uso, da raiz: node scripts/mutar-minuta.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const F = "lib/acervo/minuta.ts";
const TESTE = "tests/unit/acervo-minuta.test.ts";
const original = fs.readFileSync(F, "utf8");

/** "ok" (todos passam) | "acusou" (algum teste falhou) | "erro" (não rodou direito). */
function roda() {
  const r = spawnSync(`pnpm exec vitest run ${TESTE}`, { encoding: "utf8", shell: true });
  const saida = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  if (/Tests\s+\d+ failed/.test(saida)) return "acusou";
  if (r.status === 0 && /Tests\s+\d+ passed/.test(saida)) return "ok";
  return "erro";
}

const mutacoes = [
  ["algarismo no texto do modelo", String.raw`if (/\p{Nd}/u.test(limpa)) return "numero_no_texto";`, ""],
  ["outro alfabeto", String.raw`OUTRO_ALFABETO.test(limpa) || `, ""],
  ["sigla soletrada", String.raw` || siglaSoletrada(frase)) return "cara_de_citacao";`, String.raw`) return "cara_de_citacao";`],
  ["título com nome", String.raw`TITULO_COM_NOME.test(limpa) || `, ""],
  ["sigla em maiúscula com número por extenso", String.raw` || (SIGLA_EM_MAIUSCULA.test(limpa) && SIGLA_COM_NUMERO.test(forma(frase)))`, ""],
  ["invisível não sai", String.raw`const invisiveis = (s: string) => s.replace(/\p{Cf}/gu, "");`, String.raw`const invisiveis = (s: string) => s;`],
  ["frase inteira: começo em qualquer lugar", String.raw`for (const c of comecos) {`, String.raw`for (const c of corrido.split("").map((_, i) => i)) {`],
  ["frase inteira: fim em qualquer lugar", String.raw`if (!comecos.has(fim + 1)) continue;`, ""],
  ["pedaço: o fim do texto vale como fim de frase", String.raw`if (!comecos.has(fim + 1)) continue;`, String.raw`if (!comecos.has(fim + 1) && fim !== corrido.length) continue;`],
  ["pedaço: o começo do texto vale como começo de frase", String.raw`const comecos = new Set<number>();`, String.raw`const comecos = new Set<number>([0]);`],
  ["grafia: origem por ponto de código (emoji desloca)", String.raw`for (let u = 0; u < c.length; u++) origem.push(base + i + Math.min(u, ch.length - 1));`, String.raw`origem.push(base + i);`],
  ["grafia: aspa de fechamento antes do ponto sobra", String.raw`.replace(/["”’']+(?=[.;:!?]*$)/u, "")`, ""],
  ["grafia: pontuação final de lá não entra", String.raw`while (FIM_DE_FRASE.test(corrido[fim] ?? "")) fim++;`, ""],
  ["frase inteira: ponto de milhar termina frase", String.raw`&& !/\d/.test(l.texto[k + 1] ?? "")) comecos.add(pos + k + 1);`, String.raw`) comecos.add(pos + k + 1);`],
  ["frase inteira: toda quebra de linha é começo", String.raw`if (titulo || FIM_DE_FRASE.test(anterior.slice(-1))) comecos.add(corrido.length);`, String.raw`comecos.add(corrido.length);`],
  ["frase inteira: título não é fim de frase", String.raw`if (titulo || FIM_DE_FRASE.test(anterior.slice(-1))) comecos.add(corrido.length);`, String.raw`if (FIM_DE_FRASE.test(anterior.slice(-1))) comecos.add(corrido.length);`],
  ["literal: aspas contam", String.raw`    if (ASPA.test(ch)) {`, String.raw`    if (false) {`],
  ["CITA sem conferir frase inteira", String.raw`const grafia = t ? grafiaDoAcervo(frase, t.texto) : null;`, String.raw`const grafia = t ? frase : null;`],
  ["CITA imprime o texto do modelo", "return `“${grafia}” (${t.citacao})`;", "return `“${frase}” (${t.citacao})`;"],
  ["NFKC no lugar de NFC (º vira o)", String.raw`const nfc = (s: string) => invisiveis(s).normalize("NFC");`, String.raw`const nfc = (s: string) => invisiveis(s).normalize("NFKC");`],
  ["numeração em qualquer linha", String.raw`const podeNumerar = anterior.trim() === "" || /[.:;!?)\]]$/.test(anterior.trim());`, String.raw`const podeNumerar = true;`],
  ["quebra de linha dentro do CITA", String.raw`.replace(/\[[^\]]*\]/g, (m) => m.replace(/\s*\n\s*/g, " "));`, ";"],
  ["parágrafo perdido", String.raw`return { texto: linhas.join("\n").trim(), retirou };`, String.raw`return { texto: linhas.join(" ").trim(), retirou };`],
  ["marcas seguidas não fundem", String.raw`if (saida[saida.length - 1] !== MARCA_DO_RETIRADO) saida.push(MARCA_DO_RETIRADO);`, String.raw`saida.push(MARCA_DO_RETIRADO);`],
  ["pontuação solta", String.raw`.replace(/\]\s+([.,;:)])/g, "]$1")`, ""],
  ["abreviatura corta a frase", String.raw`if (!ABREVIATURA.test(atual.trimEnd())) {`, String.raw`if (true) {`],
  ["colchete cortado por dentro", String.raw`if (parte.startsWith("[") && parte.endsWith("]")) {`, String.raw`if (false) {`],
  ["o que faltou sem a regra", String.raw`const { texto: conferido, retirou } = confere(f, c);`, String.raw`const conferido = f.trim(), retirou = false;`],
  ["sem base mesmo com bloco apoiado", String.raw`if (!blocos.some((b) => !b.novo)) return`, String.raw`if (!blocos.some((b) => !b.novo && !b.texto.startsWith("[A COMPLETAR"))) return`],
  ["fonte inventada aceita", String.raw`.filter((f) => c.trechoDe.has(f));`, ";"],
  ["nada no acervo vira falha", String.raw`if (busca.situacao === "nada_no_acervo") return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };`, String.raw`if (busca.situacao === "nada_no_acervo") return { situacao: "falha", codigo: "x" };`],
  ["fora do formato vira sem base", String.raw`if (!lido.success) return { situacao: "falha", codigo: "formato" };`, String.raw`if (!lido.success) return { situacao: "sem_base", mensagem: SEM_BASE, faltou: [] };`],
];
// Cada família de LINHAS_DE_CITACAO, desligada sozinha ("(?!)" nunca casa).
for (const linha of ["tribunal", "o_que_se_cita", "julgados", "quem_julga", "numero_por_extenso", "doutrina", "caso_nomeado", "artigo_por_extenso", "tribunal_que_decide"]) {
  mutacoes.push([`família ${linha}`, `\n  ${linha}:`, `\n  ${linha}: "(?!)" ||`]);
}

let acusadas = 0;
let invalidas = 0;
try {
  const base = roda();
  if (base !== "ok") {
    console.error(`PAROU: sem mutação o teste já dá "${base}" — consertar antes de medir.`);
    process.exit(2);
  }
  for (const [nome, de, para] of mutacoes) {
    if (original.split(de).length !== 2) {
      console.info("NÃO ACHEI:", nome);
      invalidas++;
      continue;
    }
    fs.writeFileSync(F, original.replace(de, () => para));
    const r = roda();
    console.info(r === "acusou" ? "acusou: " : r === "ok" ? "ESCAPOU:" : "ERRO:   ", nome);
    if (r === "acusou") acusadas++;
    else if (r === "erro") invalidas++;
  }
} finally {
  fs.writeFileSync(F, original);
}
console.info(`${acusadas} de ${mutacoes.length} acusadas${invalidas ? `; ${invalidas} não puderam ser medidas` : ""}`);
// Portão: qualquer mutação que escapou ou não pôde ser medida reprova.
process.exitCode = acusadas === mutacoes.length ? 0 : 1;
