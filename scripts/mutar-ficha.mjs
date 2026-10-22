// Mutação da ficha do caso (0001.E4): tira cada regra de lib/casos/ficha.ts e da página
// e confere que os testes da ficha acusam. Roda antes sem mutação; restaura sempre; sai
// com erro se alguma escapar. Uso, da raiz: node scripts/mutar-ficha.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TESTES = "tests/unit/caso-ficha.test.ts tests/unit/ficha-do-caso-tela.test.tsx";
const LIB = "lib/casos/ficha.ts";
const PAGINA = "app/app/fichas/[id]/page.tsx";
const AGENDAR = "app/app/fichas/_components/AgendarConsulta.tsx";
const originais = Object.fromEntries([LIB, PAGINA, AGENDAR].map((f) => [f, fs.readFileSync(f, "utf8")]));

function roda() {
  const r = spawnSync(`pnpm exec vitest run ${TESTES}`, { encoding: "utf8", shell: true });
  const saida = `${r.stdout}\n${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
  if (/Tests\s+\d+ failed/.test(saida)) return "acusou";
  if (r.status === 0 && /Tests\s+\d+ passed/.test(saida)) return "ok";
  return "erro";
}

const mutacoes = [
  [PAGINA, "caso de outra org", String.raw`.select("id, title, custom_fields, created_at, contact_id")
    .eq("organization_id", org)`, String.raw`.select("id, title, custom_fields, created_at, contact_id")`],
  [PAGINA, "mensagens sem filtro de org", String.raw`.select(COLUNAS_DA_MENSAGEM, { count: "exact" })
          .eq("organization_id", org)`, String.raw`.select(COLUNAS_DA_MENSAGEM, { count: "exact" })`],
  [PAGINA, "id sem conferir uuid", String.raw`if (!z.uuid().safeParse(id).success) notFound();`, ""],
  [PAGINA, "viewer agenda", String.raw`ROLE_RANK[activeOrg.role] >= ROLE_RANK.agent`, "true"],
  [PAGINA, "área inventada quando vazia", String.raw`{ficha.area ?? <span className="text-muted-foreground">{aDefinir}</span>}`, String.raw`{ficha.area ?? "Cível"}`],
  [AGENDAR, "agenda sem o contato do caso", String.raw`contact_id: contatoId,`, ""],
  [AGENDAR, "recusa da agenda engolida", String.raw`setEstado({ fase: "erro", mensagem: json.error?.message || t("Não foi possível agendar.") });`, String.raw`setEstado({ fase: "feito" });`],
  [LIB, "área de campo não-texto", String.raw`return typeof v === "string" && v.trim() !== "" ? v.trim() : null;`, String.raw`return v == null ? null : String(v);`],
  [LIB, "urgência na fala do escritório", String.raw`.filter((m) => deCliente(m) && m.body && detectUrgencySignal(m.body))`, String.raw`.filter((m) => m.body && detectUrgencySignal(m.body))`],
  [LIB, "histórico fora de ordem", String.raw`const ordenadas = [...args.mensagens].sort((a, b) => a.created_at.localeCompare(b.created_at));`, String.raw`const ordenadas = [...args.mensagens];`],
  [LIB, "teto fica com as antigas", String.raw`const noHistorico = ordenadas.slice(-MENSAGENS_NA_FICHA);`, String.raw`const noHistorico = ordenadas.slice(0, MENSAGENS_NA_FICHA);`],
  [LIB, "documento sem arquivo", String.raw`.filter((m) => m.media_mime)
      .map((m) => ({`, String.raw`.filter(() => true)
      .map((m) => ({`],
  [LIB, "cancelado aparece", String.raw`const ativos = args.compromissos.filter((c) => c.status !== "cancelled");`, String.raw`const ativos = args.compromissos;`],
  [LIB, "urgência sai da triagem", String.raw`...(resumo ? [] : (["resumo"] as const)), "urgencia"],`, String.raw`...(resumo ? [] : (["resumo"] as const))],`],
  [LIB, "PDF vira arquivo", String.raw`if (m === "application/pdf") return "PDF";`, ""],
];

let acusadas = 0;
let invalidas = 0;
try {
  const base = roda();
  if (base !== "ok") {
    console.error(`PAROU: sem mutação os testes já dão "${base}".`);
    process.exit(2);
  }
  for (const [arq, nome, de, para] of mutacoes) {
    if (originais[arq].split(de).length !== 2) {
      console.info("NÃO ACHEI:", nome);
      invalidas++;
      continue;
    }
    fs.writeFileSync(arq, originais[arq].replace(de, () => para));
    const r = roda();
    fs.writeFileSync(arq, originais[arq]);
    console.info(r === "acusou" ? "acusou: " : r === "ok" ? "ESCAPOU:" : "ERRO:   ", nome);
    if (r === "acusou") acusadas++;
    else if (r === "erro") invalidas++;
  }
} finally {
  for (const [f, s] of Object.entries(originais)) fs.writeFileSync(f, s);
}
console.info(`${acusadas} de ${mutacoes.length} acusadas${invalidas ? `; ${invalidas} não puderam ser medidas` : ""}`);
process.exitCode = acusadas === mutacoes.length ? 0 : 1;
