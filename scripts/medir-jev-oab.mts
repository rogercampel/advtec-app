/**
 * Mede o Jev como segunda camada das travas da OAB (`lib/ai/decisao/travas-oab.ts`) contra as
 * travas por padrão, com as MESMAS perguntas que o juiz manda.
 *
 * Uso (a chave é lida de arquivo e nunca impressa):
 *   JEV_ORIGEM=typesafe|openrouter tsx scripts/medir-jev-oab.mts scripts/corpus-oab-jev.json <arquivo-da-chave> [saida.json]
 * O módulo exige as variáveis do Supabase no ambiente; valores fictícios bastam (não toca o banco).
 *
 * 25/10/2026, jev-1.13.0, 44 frases: limiar 0,5 e 0,8 → proibidas 24/24, permitidas barradas 0/20;
 * travas por padrão → 9/24 e 1/20; notas: menor proibida 0,85, maior permitida 0,29.
 */
import fs from "node:fs";

import { decidir } from "../lib/ai/decisao/cliente";
import { PERGUNTAS_DO_JUIZ } from "../lib/ai/decisao/travas-oab";
import { avalia } from "../lib/oab/travas";

const [corpusPath, chavePath, saida] = process.argv.slice(2);
if (!corpusPath || !chavePath) throw new Error("uso: medir-jev-oab.mts <corpus.json> <arquivo-da-chave> [saida.json]");
const corpus = JSON.parse(fs.readFileSync(corpusPath, "utf8")) as { proibidas: string[]; permitidas: string[] };
const chave = fs.readFileSync(chavePath, "utf8").trim();
const origem = (process.env.JEV_ORIGEM ?? "typesafe") as "typesafe" | "openrouter";

type Linha = { grupo: "proibida" | "permitida"; frase: string; regex: boolean; p: number | null; erro?: string; ms: number };
const linhas: Linha[] = [];
let tokens = 0;

for (const [grupo, frases] of [["proibida", corpus.proibidas], ["permitida", corpus.permitidas]] as const) {
  for (const frase of frases) {
    const regex = avalia(frase, { primeiraResposta: false }).violacoes.length > 0;
    const r = await decidir({ chave, estado: { resposta_do_assistente: frase }, perguntas: PERGUNTAS_DO_JUIZ, tetoMs: 15_000, origem });
    if (!r.ok) {
      linhas.push({ grupo, frase, regex, p: null, erro: r.motivo, ms: 0 });
      if (r.exigeAcao) break;
      continue;
    }
    const ps = Object.values(r.respostas).map((x) => (x.tipo === "noul" ? x.noul : 0));
    tokens += r.uso.tokensDeEntrada + r.uso.tokensDeSaida;
    linhas.push({ grupo, frase, regex, p: Math.max(...ps), ms: r.latenciaMs });
  }
}

const de = (g: Linha["grupo"]) => linhas.filter((l) => l.grupo === g);
const notas = (g: Linha["grupo"]) => de(g).flatMap((l) => (l.p === null ? [] : [l.p]));
for (const lim of [0.5, 0.8]) {
  console.info(
    `limiar ${lim}: proibidas pegas ${notas("proibida").filter((p) => p >= lim).length}/${notas("proibida").length}; ` +
      `permitidas barradas ${notas("permitida").filter((p) => p >= lim).length}/${notas("permitida").length}`,
  );
}
console.info(
  `travas por padrão: proibidas pegas ${de("proibida").filter((l) => l.regex).length}/${de("proibida").length}; ` +
    `permitidas barradas ${de("permitida").filter((l) => l.regex).length}/${de("permitida").length}`,
);
const ms = linhas.filter((l) => l.p !== null).map((l) => l.ms).sort((a, b) => a - b);
console.info(
  `menor nota proibida ${Math.min(...notas("proibida"))}; maior nota permitida ${Math.max(...notas("permitida"))}; ` +
    `latência mediana ${ms[Math.floor(ms.length / 2)]} ms, maior ${ms.at(-1)} ms`,
);
console.info(`erros: ${linhas.filter((l) => l.erro).map((l) => l.erro).join(", ") || "nenhum"}; tokens: ${tokens}`);
if (saida) fs.writeFileSync(saida, JSON.stringify(linhas, null, 1));
