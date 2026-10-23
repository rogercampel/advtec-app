// Mutação da contagem sugerida (0006.E4): tira cada regra de lib/djen/contagem.ts e da
// pauta, e confere que os testes acusam (algum teste FALHA — erro de ambiente não conta).
// Roda antes sem mutação: se já falha, nada vale. Restaura no fim, mesmo interrompido.
// Uso, da raiz: node scripts/mutar-contagem.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TESTES = "tests/unit/djen-contagem.test.ts tests/unit/djen-pauta.test.tsx";
const CONTA = "lib/djen/contagem.ts";
const TELA = "app/app/publicacoes/_components/PautaDeHoje.tsx";
const originais = { [CONTA]: fs.readFileSync(CONTA, "utf8"), [TELA]: fs.readFileSync(TELA, "utf8") };

function roda() {
  const r = spawnSync(`pnpm exec vitest run ${TESTES}`, { encoding: "utf8", shell: true });
  const saida = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  if (/Tests\s+\d+ failed/.test(saida)) return "acusou";
  if (r.status === 0 && /Tests\s+\d+ passed/.test(saida)) return "ok";
  return "erro";
}

const mutacoes = [
  [CONTA, "publicada no próprio dia da disponibilização", "const publicada = diaUtilDepois(disponibilizada);", "const publicada = disponibilizada;"],
  [CONTA, "começa no dia da publicação", "const inicio = diaUtilDepois(publicada);", "const inicio = publicada;"],
  [CONTA, "útil: o dia do início não conta", "for (let n = 1; n < prazo.dias; n++)", "for (let n = 0; n < prazo.dias; n++)"],
  [CONTA, "corrido: o dia do início não conta", "somaDias(inicio, prazo.dias - 1)", "somaDias(inicio, prazo.dias)"],
  [CONTA, "fim de semana não prorroga", "const vence = ehUtil(ultimoDia) ? ultimoDia : diaUtilDepois(ultimoDia);", "const vence = ultimoDia;"],
  [CONTA, "sábado é útil", "![0, 6].includes", "![0].includes"],
  [CONTA, "não declarado vira corrido", 'prazo.contagem === "corrido" ? "corrido" : "util"', 'prazo.contagem === "util" ? "util" : "corrido"'],
  [CONTA, "não declarado passa por declarado", 'declarada: prazo.contagem !== "nao_declarada",', "declarada: true,"],
  [CONTA, "feriado no caminho some do aviso", "if (nome) feriados.push", "if (false) feriados.push"],
  [CONTA, "recesso some do aviso", "recesso ||= noRecesso(d);", ""],
  // Tirar só o `=== null` não muda nada: `null < 1` também é verdadeiro. Mede-se a guarda inteira e o `< 1`.
  [CONTA, "prazo sem número ganha data", "prazo.dias === null || prazo.dias < 1 || ", ""],
  [CONTA, "zero dias ganha data", " || prazo.dias < 1", ""],
  [CONTA, "data ilegível ganha data", " || Number.isNaN(paraData(disponibilizada).getTime())", ""],
  [CONTA, "disponibilização com hora", "dataDisponibilizacao.slice(0, 10)", "dataDisponibilizacao"],
  [TELA, "a contagem não aparece na pauta", "<ContagemDoPrazo disponibilizada={p.dataDisponibilizacao} prazo={prazo} />", ""],
  [TELA, "sem o rótulo de sugestão", '{t("· sugestão do sistema, confira antes de confirmar")}', ""],
  [TELA, "avisos escondidos", "{avisos.map((a) => (", "{[].map((a) => ("],
  [TELA, "aviso geral some", 't("Feriados locais e móveis, suspensões de expediente e prazo em dobro não entram na conta."),', ""],
  [TELA, "passo do fim de semana some", "...(c.vence !== c.ultimoDia", "...(false"],
  [TELA, "sem número mostra data", 'if (c.situacao === "sem_data") {', 'if (c.situacao === "sem_data" && false) {'],
];

let acusadas = 0;
let invalidas = 0;
try {
  const base = roda();
  if (base !== "ok") {
    console.error(`PAROU: sem mutação os testes já dão "${base}".`);
    process.exit(2);
  }
  for (const [arquivo, nome, de, para] of mutacoes) {
    const original = originais[arquivo];
    if (original.split(de).length !== 2) {
      console.info("NÃO ACHEI:", nome);
      invalidas++;
      continue;
    }
    fs.writeFileSync(arquivo, original.replace(de, () => para));
    const r = roda();
    fs.writeFileSync(arquivo, original);
    console.info(r === "acusou" ? "acusou: " : r === "ok" ? "ESCAPOU:" : "ERRO:   ", nome);
    if (r === "acusou") acusadas++;
    else if (r === "erro") invalidas++;
  }
} finally {
  for (const [arquivo, texto] of Object.entries(originais)) fs.writeFileSync(arquivo, texto);
}
console.info(`${acusadas} de ${mutacoes.length} acusadas${invalidas ? `; ${invalidas} não puderam ser medidas` : ""}`);
process.exitCode = acusadas === mutacoes.length ? 0 : 1;
