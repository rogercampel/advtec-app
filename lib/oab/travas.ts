/**
 * As travas da OAB — validação de SAÍDA, não instrução de prompt.
 *
 * A apresentação afirma ao advogado que "a vedação está no código". Este módulo
 * é o lugar onde essa frase é verdade ou mentira.
 *
 * ═══ A ESCOLHA DE DESENHO ═══
 *
 * Duas camadas, e a primeira é a que importa:
 *
 *  1. **Lado da PERGUNTA.** Pergunta de mérito — "eu ganho?", "quanto vou
 *     receber?", "tenho direito?" — inverte o ônus da prova: a resposta só sai
 *     se **deferir explicitamente ao advogado**. Não é blocklist, é allowlist
 *     estreita, e é aqui que mora o fechado-por-padrão.
 *
 *     O desvio bem escrito continua saindo — "essa análise é do advogado, vou
 *     passar seu caso hoje" é a resposta CERTA, e segurá-la seria burrice. O
 *     que não sai é o robô mudando de assunto e deixando o cliente sem resposta
 *     numa pergunta que ele fez.
 *
 *  2. **Lado da RESPOSTA.** Lista de padrões proibidos, para o que escapa da
 *     camada 1. Esta camada é blocklist e falha ABERTO por natureza: o que ela
 *     não conhece, ela deixa passar. Por isso ela é a segunda, não a única.
 *
 * A versão anterior tinha só a camada 2 e o docblock dizia "falha fechado".
 * Medido em 18/08/2026: de 11 frases proibidas plausíveis, **10 saíam
 * liberadas**.
 *
 * ═══ POR QUE O TEXTO É NORMALIZADO ANTES DE CASAR ═══
 *
 * Em JavaScript, `\b` não casa ao lado de vogal acentuada: `ê` não é caractere
 * de palavra em ASCII, então `/\b[êe]xito garantido/` **não pega** "Êxito
 * garantido". Esse defeito já estava anotado no caderno de armadilhas e voltou
 * mesmo assim, porque nota não protege — só código protege.
 *
 * A defesa não é escrever regex mais esperto: é tirar o acento do texto antes
 * de casar, e escrever todo padrão em ASCII minúsculo. Assim a classe inteira
 * do defeito deixa de ser possível, em vez de ser evitada com cuidado.
 *
 * ═══ A QUEM SE APLICA ═══
 *
 * Ao agente que fala com o CLIENTE. A ferramenta interna que serve o ADVOGADO
 * (specs 0002 a 0007) pesquisa, resume e redige — é trabalho dele, sob
 * supervisão dele. Ver `CONTEXT.md`.
 *
 * Base normativa: Provimento 205/2021 (publicidade e captação) e Recomendação
 * nº 001/2024 do CFOAB (supervisão, veracidade, identificação, saída humana).
 */

export type Motivo =
  | "pergunta_de_merito"
  | "promessa_de_resultado"
  | "valor_ou_prazo_de_ganho"
  | "orientacao_juridica"
  | "linguagem_mercantil"
  | "sem_identificacao_de_maquina";

export type Violacao = { motivo: Motivo; trecho: string };

export type Veredito = {
  /** `false` significa: não envie. Entregue ao advogado. */
  liberado: boolean;
  violacoes: Violacao[];
};

/**
 * Sem acento, minúsculo, espaço colapsado.
 *
 * Todo padrão deste arquivo casa contra a saída desta função, e por isso é
 * escrito em ASCII minúsculo. Padrão com acento aqui dentro é defeito: ele
 * nunca vai casar, porque o texto que chega já perdeu o acento.
 */
export function normalizaParaCasar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

type Regra = { motivo: Motivo; padrao: RegExp };

/**
 * CAMADA 1 — o lado da pergunta.
 *
 * Pergunta que só tem resposta proibida. Não adianta avaliar o que o robô
 * respondeu: qualquer resposta direta a isto opina sobre o mérito, e opinar
 * sobre o mérito é trabalho do advogado. Vai para ele, e pronto.
 *
 * Isto AUMENTA o número de conversas que chegam ao advogado. É de propósito.
 * Afinar para menos exige conversa real que justifique, não opinião.
 */
const PERGUNTA_DE_MERITO: RegExp[] = [
  // Exige o objeto: sem ele, "eu ganho 2 mil por mes" virava pergunta de
  // mérito e travava a triagem inteira. Achado pelo segundo leitor.
  /ganh(o|a|ar|amos)\s+(essa|esse|esta|este|a|o|nessa|nesse|nesta|neste)?\s*(causa|processo|acao|briga|questao|disputa)/,
  /(eu|voce|vc|o senhor|a senhora)\s+(vou|vai|posso|consigo)\s+ganhar\b/,
  /tenho (algum )?direito/,
  /quanto (eu )?(vou|vai|posso|da|daria|vale|valeria|consigo|receb)/,
  /quanto (custa|sai|fica) (a |o )?(processo|acao|indenizacao|causa|consulta)/,
  /(qual|quanto) (e )?(o )?valor d(a|o) (indenizacao|causa|processo|acao)/,
  /(tenho|temos|ha) (alguma )?chance/,
  /(quanto tempo|em quanto tempo).{0,25}(receb|ganh|sai o dinheiro|dinheiro cai|demora)/,
  /vale a pena (entrar|processar|acionar|abrir|brigar)/,
  /(meu|esse|este) caso (e|tem) (bom|forte|ganho|facil)/,
];

/** CAMADA 2 — o lado da resposta. Blocklist; o que ela não conhece, passa. */
const REGRAS: Regra[] = [
  // ── prometer resultado ───────────────────────────────────────────────────
  // Com modal é promessa: "você vai receber". Sem modal, `recebe` é triagem
  // legítima — "você recebe a confirmação por aqui" não promete nada, e a versão
  // anterior bloqueava. `ganhar`/`vencer` é mérito com modal ou sem.
  { motivo: "promessa_de_resultado", padrao: /(voce|vc|ce|o senhor|a senhora)\s+(vai|ira|vao|irao)\s+(ganhar|vencer|receber|sair)/ },
  { motivo: "promessa_de_resultado", padrao: /(voce|vc|ce|o senhor|a senhora)\s+(ganha|ganhar|vence|vencer)\b/ },
  { motivo: "promessa_de_resultado", padrao: /(nos|a gente|nosso escritorio)\s+(sempre\s+)?(ganha|ganhamos|vence|vencemos)/ },
  { motivo: "promessa_de_resultado", padrao: /(vamos|iremos|vai dar pra|da pra)\s+(ganhar|vencer|reverter)/ },
  { motivo: "promessa_de_resultado", padrao: /(garanto|garantimos|asseguro|pode (ficar )?(tranquilo|sossegado|confiar))/ },
  { motivo: "promessa_de_resultado", padrao: /(com certeza|certamente|sem duvida|claro que)\s+(voce|o senhor|a senhora)?\s*(ganha|vence|recebe|tem direito)/ },
  { motivo: "promessa_de_resultado", padrao: /(exito|sucesso|resultado|ganho)\s+(garantido|certo|assegurado|na certa)/ },
  { motivo: "promessa_de_resultado", padrao: /(fique|fica)\s+(tranquilo|sossegado).{0,30}(nao perde|ganha|recebe)/ },
  { motivo: "promessa_de_resultado", padrao: /chance[s]?\s+de\s+(ganhar|exito).{0,25}?\d{1,3}\s*%/ },

  // ── valor ou prazo de ganho ──────────────────────────────────────────────
  // Amplo de propósito: qualquer cifra numa triagem vira handoff. Inclui
  // honorário — quanto custa é conversa do advogado, não do robô.
  { motivo: "valor_ou_prazo_de_ganho", padrao: /r\$\s?[\d.,]+/ },
  { motivo: "valor_ou_prazo_de_ganho", padrao: /\d[\d.,]*\s*(mil|milhao|milhoes|reais|conto)\b/ },
  // Valor por extenso: "dá uns trinta mil" escapava de tudo que exigia dígito.
  { motivo: "valor_ou_prazo_de_ganho", padrao: /(uns|cerca de|em torno de|na faixa de)\s+(\d|um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|quinze|vinte|trinta|quarenta|cinquenta|cem|duzentos|mil)/ },
  { motivo: "valor_ou_prazo_de_ganho", padrao: /\b(dez|quinze|vinte|trinta|quarenta|cinquenta|cem|duzentos)\s+mil\b/ },
  { motivo: "valor_ou_prazo_de_ganho", padrao: /em (ate\s+)?\d+\s+(dias|semanas|meses|anos)\s+(voce|o senhor)?\s*(recebe|esta com o dinheiro|sai o dinheiro|cai)/ },

  // ── orientação jurídica (opinar sobre o caso) ────────────────────────────
  // Sem sujeito: "Sim, tem direito." vazava. Afirmar direito é opinião jurídica
  // com ou sem pronome.
  { motivo: "orientacao_juridica", padrao: /\btem\s+direito\b/ },
  // Exige PREDICADO de mérito. `(e|esta)` solto bloqueava "seu caso está com o
  // advogado" e "seu caso está registrado" — que são exatamente o deferimento
  // que a CAMADA 1 exige para a resposta poder sair. As duas camadas se
  // contradiziam, e a suíte não via porque o corpus tinha escolhido outra frase.
  // Achado por revisor sem contexto, 19/08/2026.
  { motivo: "orientacao_juridica", padrao: /(seu|o|esse|este) (caso|processo) (e|esta)\s+(muito |bem |bastante |super )?(bom|otim|excelente|solid|forte|ganho|certo|tranquil|facil|favoravel|de \w+|um caso de)/ },
  { motivo: "orientacao_juridica", padrao: /(recomendo|aconselho|sugiro|oriento)\b.{0,40}?(entrar|entre|processar|processe|acionar|acione|ajuizar|ajuize|abrir|abra|aceitar|aceite|recusar|recuse|assinar|assine)/ },
  { motivo: "orientacao_juridica", padrao: /(voce|o senhor|a senhora)\s+(deve|devia|deveria|precisa|tem que)\s+(entrar|processar|acionar|ajuizar|abrir|aceitar|recusar|assinar)/ },
  { motivo: "orientacao_juridica", padrao: /\b(cabe|nao cabe|da pra pedir|pode pedir)\s+(acao|recurso|dano moral|indenizacao|rescisao)/ },
  { motivo: "orientacao_juridica", padrao: /(a lei|o codigo|o artigo \d+|a clt|a constituicao)\s+(diz|garante|assegura|obriga)\s+que\s+(voce|o senhor)/ },
  { motivo: "orientacao_juridica", padrao: /\b(e|foi|configura) (ilegal|ilegalidade|indevido|abusivo|nulo|crime|ilicito|assedio|dano moral|discriminacao)\b/ },

  // ── linguagem mercantil ou sensacionalista ───────────────────────────────
  { motivo: "linguagem_mercantil", padrao: /(o|a|os|as)\s+melhor(es)?\s+(escritorio|advogad)/ },
  { motivo: "linguagem_mercantil", padrao: /\b(promocao|promocional|imperdivel|oferta especial|condicao especial|so hoje|ultima chance|(com|de) desconto)\b/ },
  // Sem `nº 1`: bloqueava "Rua das Flores, número 1". Endereço é mais comum
  // numa triagem do que autopromoção ordinal. Achado pelo segundo leitor.
  { motivo: "linguagem_mercantil", padrao: /\b(lider de mercado|lider em|maior escritorio|mais premiado)/ },
  { motivo: "linguagem_mercantil", padrao: /\b(nao perca|corra|aproveite|garanta ja)\b.{0,30}\b(direito|dinheiro|indenizacao|prazo)/ },
];

/**
 * Frases em que o próprio remetente se declara máquina.
 *
 * Exige sujeito na primeira pessoa ou dêitico ("sou", "este é", "aqui é"). A
 * versão anterior aceitava o substantivo solto, e por isso dava a identificação
 * por cumprida quando o robô só ECOAVA a pergunta do cliente: "Você perguntou
 * se isso é um atendimento automático" passava como identificação.
 */
// "Sou o/a assistente virtual…" é a redação mais comum de apresentação; sem o artigo aqui, o
// gate de saída vetaria a própria frase que a mensagem de veto sugere ao modelo.
const IDENTIFICACAO = [
  /(sou|somos)\s+(um |uma |o |a )?(assistente|atendimento|robo|sistema|bot|agente)/,
  /(este|esta|isto|isso|aqui)\s+(e|se trata de)\s+(um |uma |o |a )?(atendimento|mensagem|resposta|assistente)\s*(automatic|automatiz|virtual)/,
  /mensagem automatica/,
  /atendimento (automatico|automatizado|virtual) d(o|a) escritorio/,
  /nao sou (advogad|human|uma pessoa|gente)/,
];

/** Eco da pergunta do cliente não é identificação. */
const ECO = /(voce|vc|o senhor|a senhora)\s+(perguntou|disse|falou|questionou|quis saber|quer saber)/;

export function seIdentificaComoMaquina(texto: string): boolean {
  const t = normalizaParaCasar(texto);
  // O eco só desqualifica quando NÃO há identificação em primeira pessoa. A
  // primeira versão vetava "Você perguntou sobre X. Sou um assistente virtual",
  // que é a resposta certa. Achado pelo segundo leitor.
  const primeiraPessoa = /(sou|somos)\s+(um |uma |o |a )?(assistente|atendimento|robo|sistema|bot|agente)/.test(t);
  if (ECO.test(t) && !primeiraPessoa) return false;
  return IDENTIFICACAO.some((r) => r.test(t));
}

/**
 * Pedidos de falar com gente. A Recomendação 001/2024 fala em "mediante
 * solicitação" — e a solicitação vem escrita como o cliente escreve: com artigo
 * no meio, sem acento, sem ponto de interrogação, com "vc" e "tô".
 */
const GENTE = "(?:ser humano|humano|humana|pessoa|atendente|advogad[oa]|doutor[a]?|responsavel|secretari[oa]|gente|alguem)";
const ARTIGO = "(?:um|uma|o|a|meu|minha)?\\s*";

const PEDIDO_DE_HUMANO = [
  new RegExp(`(?:falar|conversar|atendimento|contato)\\s+com\\s+${ARTIGO}${GENTE}`),
  /atendimento\s+(?:humano|pessoal|de verdade)/,
  new RegExp(`(?:quero|queria|preciso|posso falar com|pode chamar|chama|chamar)\\s+${ARTIGO}${GENTE}`),
  new RegExp(`(?:me|nos)\\s+(?:passa|passe|transfere|transfira|encaminha|encaminhe|chama|chame|atende)\\s*(?:para|pro|pra|com)?\\s*${ARTIGO}${GENTE}`),
  new RegExp(`cade\\s+${ARTIGO}${GENTE}`),
  // "é um robô?", "tô falando com um robô", "isso é robô" — com ou sem `?`.
  /(?:^|\s)(?:e|eh)\s+(?:um |uma )?(?:robo|bot|maquina|inteligencia artificial)\b/,
  /(?:falando|conversando)\s+com\s+(?:um |uma )?(?:robo|bot|maquina|ia)\b/,
  /nao quero (?:falar com )?(?:um |uma )?(?:robo|bot|maquina|ia)\b/,
];

export function pedeHumano(mensagemDoCliente: string): boolean {
  const t = normalizaParaCasar(mensagemDoCliente);
  return PEDIDO_DE_HUMANO.some((r) => r.test(t));
}

/** CAMADA 1 exposta: a pergunta cuja resposta precisa deferir ao advogado. */
export function perguntaDeMerito(mensagemDoCliente: string): boolean {
  const t = normalizaParaCasar(mensagemDoCliente);
  return PERGUNTA_DE_MERITO.some((r) => r.test(t));
}

/**
 * A saída estreita da camada 1: a resposta manda a pergunta para quem pode
 * respondê-la.
 *
 * Allowlist, não blocklist — e a diferença é o ponto do desenho inteiro. Padrão
 * que falta aqui causa handoff a mais, que custa tempo do advogado. Padrão que
 * falta na blocklist causa resposta proibida enviada ao cliente, que custa
 * processo disciplinar. Os dois erros não valem o mesmo, então as duas listas
 * não são do mesmo tipo.
 */
const DEFERE_AO_ADVOGADO = [
  /\b(o|a|do|da|ao|com o|com a|pelo|pela)\s+(advogad[oa]|dr[ao]?\b\.?|doutor[a]?\b|responsavel\b)/,
  /(nao|nao vou|nao posso|nao consigo)\s+(posso\s+)?(dizer|afirmar|avaliar|responder|adiantar|garantir|opinar|precisar)/,
  /(quem|isso)\s+(avalia|responde|analisa|decide|diz)\s+(isso\s+)?(e|sera)/,
  /(vou|posso)\s+(passar|encaminhar|registrar|repassar|levar)/,
  /(essa|esta|a)\s+(analise|avaliacao|resposta)\s+(e|cabe|fica)\s+(do|ao|com o|para o)/,
  /(so|somente|apenas)\s+(o|a)\s+(advogad|dr|doutor|responsavel)/,
];

export function defereAoAdvogado(resposta: string): boolean {
  const t = normalizaParaCasar(resposta);
  return DEFERE_AO_ADVOGADO.some((r) => r.test(t));
}

export type Contexto = {
  /**
   * Primeira resposta do agente nesta conversa: exige identificação.
   *
   * Quem o calcula é o gate de saída (`gate-das-travas.ts`): `primeiraResposta` =
   * `ctx.disclosure.isFirstOutbound`, lido sob o lock do número — nenhuma
   * mensagem aceita antes para este contato. A resposta de andamento do DJEN
   * (`lib/djen/resposta-de-andamento.ts`) calcula o seu por conta própria.
   */
  primeiraResposta: boolean;
};

export function avalia(resposta: string, contexto: Contexto): Veredito {
  const t = normalizaParaCasar(resposta);
  const violacoes: Violacao[] = [];

  for (const { motivo, padrao } of REGRAS) {
    const m = padrao.exec(t);
    // O trecho sai normalizado, sem acento. É rastro para o advogado ler, não
    // peça de processo — e mapear o índice de volta ao texto original não é
    // possível depois da decomposição NFD, que muda o comprimento.
    if (m) violacoes.push({ motivo, trecho: m[0].trim().slice(0, 120) });
  }

  if (contexto.primeiraResposta && !seIdentificaComoMaquina(resposta)) {
    violacoes.push({ motivo: "sem_identificacao_de_maquina", trecho: "" });
  }

  return { liberado: violacoes.length === 0, violacoes };
}

export type Decisao =
  | { acao: "enviar"; texto: string }
  | { acao: "entregar_ao_advogado"; motivos: Motivo[]; violacoes: Violacao[] };

/**
 * O ponto por onde uma resposta ao cliente pode sair.
 *
 * Chamadores hoje: a resposta de andamento do DJEN (`lib/djen/resposta-de-andamento.ts`)
 * e o gate `travas_oab` da cadeia `before_send` (`lib/oab/gate-das-travas.ts`), que
 * cobre o `send_message` do agente no turno (`lib/agent-engine/agent/inbound-turn.ts`),
 * com a camada `travas_oab` da organização ligada (padrão: ligada).
 *
 * ⚠️ "Ponto ÚNICO" continua sendo mentira. O que NÃO passa por aqui: o follow-up
 * determinístico e o `send_template` (texto escrito por gente, sem modelo), a pergunta
 * do roteiro e o aviso de escalação (texto do sistema), e o Testar do agente
 * (`preview.ts`, que monta o próprio contexto e ainda não arma o gate). O critério 4
 * vale no turno de resposta (`mensagemDoCliente` presente); no follow-up o gate só
 * confere as proibições da resposta, porque não há mensagem nova a defender.
 *
 * Recebe a mensagem do cliente de propósito: sem entrada não há saída. É a
 * forma estrutural de sustentar o critério 4 NESTE módulo — mas o fork tem
 * motor de follow-up agendado (`lib/followup/`), que dispara sem inbound. O
 * critério 4 não está garantido no produto só porque está garantido aqui.
 */
export function decideResposta(
  mensagemDoCliente: string,
  respostaCandidata: string,
  contexto: Contexto,
): Decisao {
  // Critério 4, e agora comportamento e não só assinatura: sem mensagem do
  // cliente não existe resposta ao cliente. Uma "resposta" sem pergunta é
  // abordagem ativa, que o Provimento 205/2021 veda.
  if (normalizaParaCasar(mensagemDoCliente) === "") {
    return { acao: "entregar_ao_advogado", motivos: [], violacoes: [] };
  }

  if (pedeHumano(mensagemDoCliente)) {
    return { acao: "entregar_ao_advogado", motivos: [], violacoes: [] };
  }

  // Camada 1: na pergunta de mérito o ônus inverte — deferir ou entregar.
  if (perguntaDeMerito(mensagemDoCliente) && !defereAoAdvogado(respostaCandidata)) {
    return {
      acao: "entregar_ao_advogado",
      motivos: ["pergunta_de_merito"],
      violacoes: [{ motivo: "pergunta_de_merito", trecho: mensagemDoCliente.slice(0, 120) }],
    };
  }

  // Camada 2 roda SEMPRE, inclusive sobre a resposta que deferiu: deferir não
  // dá licença para prometer resultado na mesma frase.
  const v = avalia(respostaCandidata, contexto);
  if (!v.liberado) {
    return {
      acao: "entregar_ao_advogado",
      motivos: [...new Set(v.violacoes.map((x) => x.motivo))],
      violacoes: v.violacoes,
    };
  }

  return { acao: "enviar", texto: respostaCandidata };
}
