/**
 * Quem é quem — ticket 0003.E2 (#29).
 *
 * "Partes, advogados, juízo, classe, valor da causa. Extraído, não inferido."
 * (spec 0003, seção 1) Cada campo é o TEXTO dos autos com a página e o trecho de
 * onde saiu; o que não está escrito no formato esperado sai `null`, nunca um
 * palpite. O advogado vê o vazio e preenche; um nome errado ele não percebe.
 * Por isso toda regra aqui é estrita: na dúvida, `null`.
 *
 * Formato de capa medido em 21/10/2026 em duas iniciais públicas reais (TJMG e
 * MPRJ, `tests/fixtures/pecas-publicas.json`): endereçamento, qualificação do
 * autor, "propor a presente <CLASSE> em face de <RÉU>". O valor da causa mora
 * no fim. Casos de borda (JUSTIÇA GRATUITA no topo, contestação que cita
 * "ajuizar", "R$ 50 mil") vieram de um segundo leitor; ver o teste.
 *
 * Autor, classe e réu só saem de PETIÇÃO INICIAL (`extraiTipoDePeca`): na
 * contestação quem abre a capa é o réu, e ler os papéis ali seria trocá-los.
 *
 * ponytail: heurística de capa de inicial. Ampliar para contestação e recurso
 * quando o acervo real do piloto mostrar o formato.
 */
import type { Pagina } from "./fatiar";
import { extraiTipoDePeca, sombra, ZONA_DO_CABECALHO } from "./metadado";

export type Campo = { valor: string; pagina: number; trecho: string };
export type Advogado = Campo & { oab: string };

export type QuemEQuem = {
  juizo: Campo | null;
  autor: Campo | null;
  /** O nome da ação como a peça escreve: "AÇÃO CIVIL PÚBLICA COM PEDIDO LIMINAR". */
  classe: Campo | null;
  reu: Campo | null;
  valor_da_causa: Campo | null;
  advogados: Advogado[];
};

const JUIZO =
  /\b(?:juiz|juiza)(?:\s*\(a\))?\s+(?:de\s+direito\s+|federal\s+|do\s+trabalho\s+)?(?:titular\s+)?d[aeo]s?\s+|\bjuizo\s+(?:de\s+direito\s+|federal\s+)?d[aeo]s?\s+/g;
/** Só tratamento antes de "juiz" na mesma linha: é o endereçamento, não "o juízo da comarca é competente". */
const SO_TRATAMENTO =
  /^\s*(?:(?:a|ao|a\s+sua)\s+)?(?:(?:excelentissim[oa]|exm[oa]|ilustrissim[oa]|ilm[oa]|meritissim[oa]|senhor|sr|sra|doutor|doutora|dr|dra)\.?\s*(?:\(a\)\s*)?)*$/;
/** Linha de referência entre o endereçamento e a qualificação: "REF.: INQUÉRITO N.º 411/2003". */
const LINHA_DE_REFERENCIA = /^\s*(?:ref\b|proc\b|processo\b|autos\b|n[º°o]?\s*\.?\s*\d)/;
/** Faixa de destaque no topo: não é juízo nem autor. */
const FAIXA =
  /^\s*(?:justica gratuita|gratuidade|assistencia judiciaria|urgente|prioridade|tramitacao prioritaria|pedido (?:de )?liminar|com pedido|segredo de justica)/;
/** O endereçamento continua na linha de baixo só se a de cima ficou pendurada ("…VARA EMPRESARIAL DA"). */
const LINHA_PENDURADA = /(?:\b(?:d[aeo]s?|e)|[–-])\s*$/;
const PROPOR = /\b(?:propor|ajuizar|promover|mover|ingressar\s+com):?\s+(?:a\s+presente\s+)?/;
const EM_FACE = /\s(?:em\s+face\s+d[aeo]s?|contra)\s+/;
/** O nome da ação começa por um destes; o resto ("pelo procedimento comum, com fundamento…") não é classe. */
const INICIO_DE_CLASSE =
  /^(?:acao|reclamacao|execucao|mandado|embargos|cumprimento|tutela|habeas|monitoria|procedimento|requerimento|queixa|interdito|inventario|usucapiao|alvara|notificacao|interpelacao|protesto|consignacao|exibicao|producao)\b/;
/**
 * Só a fórmula do autor, com centavos: "Dá-se à causa o valor de R$ 1.234,56".
 * "R$ 50 mil" sai null (viraria "R$ 50"); "requer seja atribuído à causa o
 * valor de…" é pedido do réu, não o valor da causa.
 */
const VALOR = String.raw`(r\$\s?\d{1,3}(?:\.\d{3})*,\d{2})(?!\d)`;
const VALOR_DA_CAUSA = new RegExp(String.raw`\bda-se\s+a\s+causa,?\s+o\s+valor\s+de\s*${VALOR}|\bvalor\s+da\s+causa\s*:\s*${VALOR}`, "g");
const ADVOGADO = /^[ \t]*(\p{Lu}[\p{Lu} .'-]{4,}?)[ \t]*\n[ \t]*OAB\s*\/\s*([A-Z]{2})\s*(?:n[º°o.]*\s*)?(\d[\d.]*)/gmu;
const CARGO = /^(?:advogad[oa]s?|procurador[a]?|defensor[a]?(?: public[oa])?|oab)$/;
const PARTICULA = /^(?:d[aeo]s?|e)$/;

const junta = (s: string) => s.replace(/\s+/g, " ").trim();
const temMinuscula = (s: string) => /\p{Ll}/u.test(s);

/** Nome de parte: palavras com maiúscula inicial, ou partícula ("de", "da"). "vem respeitosamente" não é nome. */
function pareceNome(s: string): boolean {
  if (s.length < 3 || s.length > 150) return false;
  return s.split(" ").every((p) => /^[\p{Lu}\p{N}]/u.test(p) || PARTICULA.test(p));
}

/** As linhas da zona com a posição de início de cada uma. */
function linhas(zona: string): Array<{ inicio: number; texto: string }> {
  const saida: Array<{ inicio: number; texto: string }> = [];
  let inicio = 0;
  for (const texto of zona.split("\n")) {
    saida.push({ inicio, texto });
    inicio += texto.length + 1;
  }
  return saida;
}

function juizoDaCapa(zona: string, s: string, pagina: number): { campo: Campo; linhaFinal: number } | null {
  const ls = linhas(zona);
  for (const m of s.matchAll(JUIZO)) {
    const i = ls.findLastIndex((l) => l.inicio <= m.index);
    if (!SO_TRATAMENTO.test(s.slice(ls[i]!.inicio, m.index))) continue;
    let final = i;
    while (final + 1 < ls.length) {
      const atual = ls[final]!.texto.trimEnd();
      const proxima = ls[final + 1]!.texto;
      if (atual.endsWith(".") || !proxima.trim() || temMinuscula(proxima)) break;
      if (LINHA_DE_REFERENCIA.test(sombra(proxima)) || FAIXA.test(sombra(proxima))) break;
      if (!LINHA_PENDURADA.test(sombra(atual)) && !proxima.trimEnd().endsWith(".")) break;
      final += 1;
    }
    const fim = ls[final]!.inicio + ls[final]!.texto.length;
    const valor = junta(zona.slice(m.index + m[0].length, fim)).replace(/\.$/, "");
    if (!valor) return null;
    return { campo: { valor, pagina, trecho: junta(zona.slice(ls[i]!.inicio, fim)) }, linhaFinal: final };
  }
  return null;
}

/** Texto até a primeira vírgula da MESMA linha, se for nome. Nome quebrado em duas linhas sai null. */
function nomeAteAVirgula(texto: string, inicio: number): { valor: string; fim: number } | null {
  const quebra = texto.indexOf("\n", inicio);
  const virgula = texto.indexOf(",", inicio);
  if (virgula < 0 || (quebra >= 0 && quebra < virgula)) return null;
  const valor = junta(texto.slice(inicio, virgula));
  return pareceNome(valor) ? { valor, fim: virgula } : null;
}

function capa(primeira: Pagina, inicial: boolean): Pick<QuemEQuem, "juizo" | "autor" | "classe" | "reu"> {
  const zona = primeira.texto.slice(0, ZONA_DO_CABECALHO);
  const s = sombra(zona);
  const pagina = primeira.numero;
  const achado = juizoDaCapa(zona, s, pagina);
  const juizo = achado?.campo ?? null;
  let autor: Campo | null = null;
  let classe: Campo | null = null;
  let reu: Campo | null = null;
  if (!inicial) return { juizo, autor, classe, reu };

  // Autor: a primeira linha depois do juízo que não é vazia, referência nem faixa.
  if (achado) {
    const ls = linhas(zona);
    const linha = ls.slice(achado.linhaFinal + 1).find((l) => {
      const t = sombra(l.texto);
      return t.trim() && !LINHA_DE_REFERENCIA.test(t) && !FAIXA.test(t);
    });
    const nome = linha && nomeAteAVirgula(zona, linha.inicio + (linha.texto.length - linha.texto.trimStart().length));
    if (linha && nome) autor = { valor: nome.valor, pagina, trecho: junta(zona.slice(linha.inicio, nome.fim + 1)) };
  }

  // Classe e réu: "propor a presente <CLASSE> em face de <RÉU>,".
  const mp = PROPOR.exec(s);
  if (mp) {
    const inicio = mp.index + mp[0].length;
    const mf = EM_FACE.exec(s.slice(inicio, inicio + 250));
    if (mf) {
      const bruto = zona.slice(inicio, inicio + mf.index);
      const virgula = bruto.indexOf(",");
      const valor = junta(virgula < 0 ? bruto : bruto.slice(0, virgula));
      if (INICIO_DE_CLASSE.test(sombra(valor)) && valor.length <= 150) {
        classe = { valor, pagina, trecho: junta(zona.slice(mp.index, inicio + mf.index)) };
      }
      const inicioDoReu = inicio + mf.index + mf[0].length;
      const nome = nomeAteAVirgula(zona, inicioDoReu);
      if (nome) reu = { valor: nome.valor, pagina, trecho: junta(zona.slice(inicio + mf.index, nome.fim + 1)) };
    }
  }

  return { juizo, autor, classe, reu };
}

export function quemEQuem(paginas: Pagina[]): QuemEQuem {
  const primeira = paginas.find((p) => p.texto.trim().length > 0);
  const inicial = extraiTipoDePeca(paginas)?.valor === "peticao_inicial";

  // Valor da causa: se os autos dão DOIS valores diferentes (emenda, outra peça
  // juntada), não escolhemos — null, e o advogado diz qual vale.
  const valores = new Map<string, Campo>();
  const advogados: Advogado[] = [];
  const oabs = new Set<string>();
  for (const p of paginas) {
    for (const m of sombra(p.texto).matchAll(VALOR_DA_CAUSA)) {
      const bruto = m[1] ?? m[2]!;
      const ini = m.index + m[0].length - bruto.length;
      const valor = p.texto.substr(ini, bruto.length);
      const chave = valor.replace(/\s/g, "");
      if (valores.has(chave)) continue;
      const comecoDaLinha = p.texto.lastIndexOf("\n", m.index) + 1;
      const quebra = p.texto.indexOf("\n", ini);
      valores.set(chave, { valor, pagina: p.numero, trecho: junta(p.texto.slice(comecoDaLinha, quebra < 0 ? p.texto.length : quebra)) });
    }
    for (const m of p.texto.matchAll(ADVOGADO)) {
      const nome = junta(m[1]!);
      if (CARGO.test(sombra(nome))) continue; // "JOÃO PEREIRA\nADVOGADO\nOAB/SP…": o nome está uma linha acima
      const oab = `OAB/${m[2]} ${m[3]}`;
      if (oabs.has(oab)) continue;
      oabs.add(oab);
      advogados.push({ valor: nome, oab, pagina: p.numero, trecho: junta(m[0]) });
    }
  }
  const valor_da_causa = valores.size === 1 ? [...valores.values()][0]! : null;

  const vazio = { juizo: null, autor: null, classe: null, reu: null };
  return { ...(primeira ? capa(primeira, inicial) : vazio), valor_da_causa, advogados };
}
