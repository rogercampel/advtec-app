/**
 * Trava de linguagem da jurimetria — ticket 0007.E6.
 *
 * "Jurimetria descreve o que já aconteceu. Nunca prevê o que vai acontecer."
 * (spec 0007) Critério 5: nenhuma saída contém probabilidade, chance, previsão
 * ou recomendação sobre um caso individual. Critério 6: nenhuma saída nomeia
 * magistrado. Critério 1: percentual sem o N ao lado é falha.
 *
 * Mesmo molde das travas da OAB (0001.E2, `lib/oab/travas.ts`): o texto é
 * normalizado (sem acento, minúsculo) ANTES de casar, e todo padrão é ASCII.
 * É blocklist, e blocklist falha aberto — por isso a frase que vai à tela é
 * montada por código (`textoDoPerfil`), nunca pelo modelo, e a trava roda sobre
 * ela em todo commit (teste de varredura).
 */
import { normalizaParaCasar } from "@/lib/oab/travas";

import type { Desfechos, Lado, Perfil } from "./recorte";

export type MotivoDaTrava = "previsao" | "recomendacao" | "caso_individual" | "magistrado" | "percentual_sem_n";

const PROIBIDO: Array<{ motivo: MotivoDaTrava; padrao: RegExp }> = [
  { motivo: "previsao", padrao: /\b(chances?|probabilidade|provave(l|is)|provavelmente|previs(ao|oes|to|ta)|preve|prever|tende a (ganhar|perder|ser)|deve (ganhar|perder)|vai (ganhar|perder|ser procedente|ser julgad)|expectativa de (exito|ganho|vitoria))\b/ },
  { motivo: "recomendacao", padrao: /\b(recomend\w*|aconselh\w*|sugerimos|vale a pena|melhor (entrar|acordar|ajuizar|desistir))\b/ },
  { motivo: "caso_individual", padrao: /\b(seu caso|sua causa|seu processo|o caso de voce|voce (vai|deve|tem))\b/ },
  // Unidade é o órgão. "Juizado" e "Juízo" são órgão; "juiz", "juíza", "desembargador(a)" e "magistrado(a)" são pessoa.
  { motivo: "magistrado", padrao: /\b(juiz|juiza|juizes|juizas|desembargador\w*|magistrad\w*|des\.|dr\.|dra\.|doutor\w*)(?=\s|$|[.,;:])/ },
];

export type Veredito = { liberado: boolean; violacoes: Array<{ motivo: MotivoDaTrava; trecho: string }> };

export function travaDaJurimetria(texto: string): Veredito {
  const t = normalizaParaCasar(texto);
  const violacoes: Veredito["violacoes"] = [];
  for (const { motivo, padrao } of PROIBIDO) {
    const m = padrao.exec(t);
    if (m) violacoes.push({ motivo, trecho: m[0] });
  }
  // Critério 1, por linha: todo "%" tem de vir com "de N processos" na mesma linha.
  for (const linha of t.split("\n")) {
    if (linha.includes("%") && !/\bde \d+ processos?\b/.test(linha)) {
      violacoes.push({ motivo: "percentual_sem_n", trecho: linha.slice(0, 120) });
    }
  }
  return { liberado: violacoes.length === 0, violacoes };
}

const dataBr = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

function linhasDosDesfechos(d: Desfechos): string[] {
  if (d.situacao === "amostra_insuficiente") {
    return [`Desfecho: amostra insuficiente (${d.n} processos com desfecho lido; o mínimo é ${d.minimo}).`];
  }
  const f = (rotulo: string, x: { n: number; de: number; percentual: number }) =>
    `${rotulo}: ${x.percentual}% (${x.n} de ${x.de} processos)`;
  return [
    f("Procedência", d.procedencia),
    f("Improcedência", d.improcedencia),
    f("Procedência em parte", d.procedencia_parcial),
    `Sem desfecho de mérito no espelho: ${d.semDesfecho} processos.`,
  ];
}

function linhasDoLado(titulo: string, l: Lado): string[] {
  const t = l.tempo;
  const tempo =
    t.situacao === "calculado"
      ? `Do ajuizamento à sentença: mediana de ${t.medianaDias} dias; metade entre ${t.faixa.de} e ${t.faixa.ate} dias (${t.n} processos medidos).`
      : `Do ajuizamento à sentença: amostra insuficiente (${t.n} processos medidos; o mínimo é ${t.minimo}).`;
  const fora = l.descartados.sigilo + l.descartados.dataImpossivel + l.descartados.dataIlegivel;
  return [
    `${titulo}: ${l.volume} processos no espelho; ${fora} fora da conta (sigilo ou data inválida).`,
    ...linhasDosDesfechos(l.desfechos),
    tempo,
  ];
}

/**
 * O texto que vai à tela. Descreve o recorte; a última linha diz o que ele NÃO
 * é. Sai daqui já conferido pela trava — se ela recusar, é defeito deste
 * código, e o erro é alto.
 */
export function textoDoPerfil(p: Perfil): string {
  const f = p.filtro;
  // Medido no 2º grau: órgão com nome de pessoa ("Gabinete Des. Fulano"). Aí vai o código, nunca o nome.
  const nome = p.orgao.nome && travaDaJurimetria(p.orgao.nome).liberado ? p.orgao.nome : `código ${p.orgao.codigo}`;
  const texto = [
    `Recorte “${f.rotulo}”: tribunal ${f.tribunal.toUpperCase()}, ${f.classe_codigo === null ? "todas as classes" : f.classe_nome ? `classe ${f.classe_nome}` : `classe de código CNJ ${f.classe_codigo}`}, ${f.assunto_codigo === null ? "todos os assuntos" : `assunto de código CNJ ${f.assunto_codigo}`}. Coleta de ${dataBr(p.coletadoEm)}.`,
    ...linhasDoLado(`Órgão ${nome}`, p.orgao),
    ...linhasDoLado(`Demais ${p.demais.orgaos} órgãos do tribunal, mesma classe`, p.demais),
    "Isto descreve processos deste recorte já registrados no DataJud. Não diz nada sobre um processo específico.",
  ].join("\n");
  const v = travaDaJurimetria(texto);
  if (!v.liberado) throw new Error(`texto da jurimetria recusado pela trava: ${v.violacoes.map((x) => x.motivo).join(", ")}`);
  return texto;
}
