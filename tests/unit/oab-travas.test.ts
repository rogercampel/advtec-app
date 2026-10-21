import { describe, expect, it } from "vitest";

import {
  avalia,
  decideResposta,
  defereAoAdvogado,
  normalizaParaCasar,
  pedeHumano,
  perguntaDeMerito,
  seIdentificaComoMaquina,
  type Contexto,
} from "@/lib/oab/travas";

/**
 * Ticket 0001.E2 — as travas da OAB.
 *
 * ═══ POR QUE ESTE ARQUIVO É UMA LISTA DE FRASES, E NÃO UM CASO POR REGRA ═══
 *
 * A versão anterior tinha um teste por regra, escrito a partir da regra. Os
 * dois nasciam da mesma cabeça e concordavam entre si: 32 testes verdes, e um
 * segundo leitor derrubou o módulo com 14 frases banais.
 *
 * Medido em 18/08/2026 contra a versão anterior: de 11 frases proibidas
 * plausíveis, **10 saíam liberadas** — inclusive "Sim, você ganha essa causa."
 * E de 16 pedidos de atendimento humano, 14 não eram reconhecidos.
 *
 * Frase é falseável, regra não é. E o corpus é a interface deste arquivo para
 * quem não lê TypeScript: o advogado acrescenta uma linha e vê o portão
 * reprovar, sem precisar entender regex.
 *
 * ═══ MUTAÇÕES (18/08/2026) — apague a regra e o teste tem de acusar ═══
 *
 * **32 mutações: as 26 regras de `REGRAS`, uma a uma, e as 6 guardas
 * estruturais. Todas as 32 acusaram.**
 *
 *     python scripts/mutar-travas-oab.py
 *
 * O script varre o arquivo para achar as regras, em vez de usar lista escrita à
 * mão. A primeira versão usava lista, testava uma regra de cada família e este
 * comentário afirmava "cobre as quatro famílias" — o segundo leitor mostrou que
 * era falso. Medido depois: **9 das 26 regras podiam ser apagadas com a suíte
 * inteira verde.** As 9 frases marcadas no corpus abaixo existem para fechar
 * exatamente esses 9 buracos.
 *
 * A lição é a razão de o script estar versionado: amostra por família parece
 * cobertura e não é, e só a varredura completa mostra a diferença.
 */

const CONTINUACAO: Contexto = { primeiraResposta: false };
const PRIMEIRA: Contexto = { primeiraResposta: true };

/**
 * O corpus proibido. Cada linha é uma frase que um bot mal-ajustado realmente
 * responde e que a OAB não deixa sair. Acrescentar linha aqui é como se relata
 * defeito neste módulo.
 */
const RESPOSTAS_PROIBIDAS: Array<[string, string]> = [
  ["promessa direta", "Sim, você ganha essa causa."],
  ["promessa no plural", "Vamos ganhar esse processo."],
  ["promessa com confiança", "Você ganha, pode confiar."],
  ["promessa institucional", "A gente sempre ganha esse tipo de caso."],
  ["promessa com acento", "Êxito garantido no seu caso."],
  ["promessa de recebimento", "O senhor vai receber tudo o que pediu."],
  ["percentual de êxito", "Suas chances de êxito são de 80%."],
  ["valor em reais por extenso", "Isso costuma dar uns 20 mil reais."],
  ["valor sem cifrão", "A indenização gira em torno de 15 mil."],
  ["valor com cifrão", "O senhor recebe cerca de R$ 12.000,00."],
  ["valor atribuído ao juízo", "Nesses casos o juiz costuma dar uns 15 mil reais."],
  // Estas duas existem porque a mutação acusou: sem elas, a regra de "N mil"
  // podia ser apagada e o corpus continuava verde — as outras frases de
  // dinheiro eram pegas por "uns" e "em torno de", não pelo valor em si.
  ["valor sem palavra de aproximação", "O acordo saiu por 8 mil reais."],
  ["valor cravado", "Fica em 30 mil."],
  ["prazo de recebimento", "Em 6 meses o senhor recebe o dinheiro."],
  ["orientação sem 'que você'", "Recomendo entrar com ação de dano moral."],
  ["orientação com objeto", "Aconselho você a processar a empresa."],
  ["orientação como dever", "O senhor deve processar a empresa, é o certo."],
  ["cabimento", "Cabe dano moral sim."],
  ["enquadramento do caso", "Seu caso é de área trabalhista."],
  ["juízo de valor sobre o fato", "O que a empresa fez é ilegal."],
  ["superlativo", "Somos os melhores advogados da cidade."],
  ["preço promocional", "Consulta com preço promocional essa semana."],
  ["urgência com acento", "Última chance de entrar com a ação!"],
  ["direito afirmado", "Você tem direito à rescisão indireta."],
  // ── as 8 abaixo vieram do segundo leitor, que rodou o portão contra 48
  //    frases e achou 47 saindo. Cada uma escapava por um buraco diferente:
  //    sujeito ausente, abreviação, subjuntivo, número por extenso, adjetivo
  //    novo. Elas ficam aqui para o buraco não reabrir.
  ["direito sem sujeito", "Sim, tem direito."],
  ["sujeito abreviado", "vc tem direito a rescisão indireta"],
  ["avaliação do caso", "Seu caso é muito bom."],
  ["tipificação do fato", "Isso é assédio moral."],
  ["valor por extenso", "Dá uns trinta mil."],
  ["sucesso em vez de êxito", "É sucesso garantido."],
  ["orientação no subjuntivo", "Recomendo que você entre com a ação."],
  ["promessa com 'cê'", "cê vai receber tudo"],
  // ── as 9 abaixo existem porque a mutação regra a regra mostrou que 9 das 26
  //    regras podiam ser APAGADAS com a suíte inteira verde. Cada frase aqui é
  //    a única do corpus que depende da regra correspondente; sem ela, a regra
  //    é peso morto que ninguém percebe sumir.
  ["garantia genérica", "Garanto que resolvemos isso."],
  ["processo, não caso", "O processo está ganho."],
  ["tranquilizar prometendo", "Fique tranquilo, o senhor não perde nada."],
  ["aproximação por extenso", "O acordo gira em torno de duzentos."],
  ["valor redondo por extenso", "Sai por vinte mil."],
  ["prazo sem sujeito", "Em 90 dias sai o dinheiro."],
  ["a lei como garantia", "A CLT garante que o senhor receba isso."],
  ["liderança de mercado", "Somos líder em ações trabalhistas."],
  ["urgência mercantil", "Não perca seu direito, corra!"],
];

/**
 * O contra-corpus. Sem ele, "bloqueia tudo" passaria em todo teste acima e
 * deixaria o produto inútil. Estas frases são a triagem receptiva que o
 * Provimento 205/2021 permite, e elas TÊM de sair.
 */
const RESPOSTAS_PERMITIDAS: string[] = [
  "Bom dia! Pode me contar o que aconteceu?",
  "Entendi. Em que data isso aconteceu?",
  "O senhor tem cópia do contrato? Pode enviar por aqui.",
  "Certo. A empresa chegou a responder alguma coisa por escrito?",
  "Nosso escritório atende direito trabalhista e de família.",
  "Ele mora no 1 andar do prédio, é isso?",
  "Vou registrar como urgente.",
  "A audiência já foi marcada?",
  // ── falsos positivos que o segundo leitor achou. Bloquear estas deixaria a
  //    triagem trabalhista e de consumidor inútil, e portão que atrapalha é
  //    portão que alguém desliga.
  "A empresa fez algum desconto no seu salário?",
  "Houve algum desconto indevido na fatura?",
  "Nosso endereço é Rua das Flores, número 1, sala 302.",
  // ── as 5 abaixo vieram de um revisor sem contexto, 19/08/2026. Nenhuma era
  //    pega pelo corpus, e todas eram BLOQUEADAS por engano. A segunda é a pior:
  //    "seu caso está com o advogado" é o deferimento que a CAMADA 1 exige para
  //    a resposta sair, e a CAMADA 2 o estrangulava. As duas camadas se
  //    contradiziam, e nenhum dos 148 testes via.
  "Entendi. Seu caso está registrado e o advogado vai avaliar hoje.",
  "Seu caso está na fila do doutor.",
  "Você recebe a confirmação por aqui assim que o advogado abrir.",
  "O senhor recebe um retorno ainda hoje.",
  "Certo. Vou anotar e o senhor recebe o contato do escritório.",
];

/**
 * O que é bloqueado DE PROPÓSITO, e não é defeito.
 *
 * Qualquer cifra numa triagem vira handoff, inclusive quando o robô só confirma
 * um fato que o cliente contou. Custa um atendimento passado ao advogado;
 * deixar o robô manusear valor custa a confiança da conversa inteira. Está como
 * teste para ninguém "consertar" isso achando que é engano.
 */
const BLOQUEIO_DELIBERADO: string[] = [
  "O senhor recebia R$ 1.800,00 por mês, é isso?",
  "Era em torno de 2 mil?",
];

describe("o corpus proibido — nenhuma dessas sai", () => {
  it.each(RESPOSTAS_PROIBIDAS)("%s: %s", (_rotulo, frase) => {
    const d = decideResposta("Aconteceu isso comigo, o que faço?", frase, CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
  });
});

describe("o contra-corpus — a triagem receptiva continua funcionando", () => {
  it.each(RESPOSTAS_PERMITIDAS)("sai: %s", (frase) => {
    const d = decideResposta("Fui demitido semana passada.", frase, CONTINUACAO);
    expect(d.acao).toBe("enviar");
  });

  it.each(BLOQUEIO_DELIBERADO)("bloqueada de propósito, não por engano: %s", (frase) => {
    const d = decideResposta("Fui demitido semana passada.", frase, CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
  });
});

/**
 * Falsos positivos na camada 1 travam a triagem inteira, porque a pergunta de
 * mérito é avaliada em TODA mensagem. A primeira versão tratava "eu ganho 2 mil
 * por mês" como pergunta de mérito, porque todos os grupos do padrão eram
 * opcionais e ele virava `/ganh(o|a|ar)/` solto.
 */
describe("a camada 1 não confunde salário com pergunta de mérito", () => {
  it.each([
    "eu ganho 2 mil por mes e fui demitido",
    "meu marido ganha mais que eu",
    "a empresa ganha muito dinheiro e nao me pagou",
  ])("não é pergunta de mérito: %s", (msg) => {
    expect(perguntaDeMerito(msg)).toBe(false);
  });
});

/**
 * A armadilha virando código.
 *
 * Em JS, `\b` não casa ao lado de vogal acentuada — `ê` não é `\w` em ASCII.
 * Esse defeito estava anotado no caderno de armadilhas e voltou mesmo assim, na
 * mesma sessão, em outro arquivo. Nota não protege; este bloco protege.
 *
 * Fica vermelho se alguém escrever padrão com acento em `REGRAS`, ou tirar a
 * normalização.
 */
describe("acento não muda veredito", () => {
  const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");

  it.each(RESPOSTAS_PROIBIDAS)("%s continua barrada sem acento", (_r, frase) => {
    const d = decideResposta("e ai?", semAcento(frase), CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
  });

  it("normalizaParaCasar tira acento, caixa e espaço repetido", () => {
    expect(normalizaParaCasar("  Êxito   GARANTIDO ")).toBe("exito garantido");
    expect(normalizaParaCasar("Indenização")).toBe("indenizacao");
  });
});

/**
 * Camada 1 — o ônus invertido.
 *
 * A versão anterior só julgava a resposta, então toda frase que a blocklist não
 * conhecesse saía. Aqui, na pergunta de mérito, a resposta precisa DEFERIR para
 * poder sair. É allowlist, e é onde o "falha fechado" do docblock vira verdade.
 */
describe("pergunta de mérito: deferir ou entregar", () => {
  const PERGUNTAS = [
    "Eu ganho essa causa?",
    "Quanto eu vou receber?",
    "Tenho direito a alguma coisa?",
    "vale a pena entrar com processo?",
    "tenho chance nesse caso?",
    "quanto tempo demora pra receber?",
    "qual o valor da indenização?",
  ];

  it.each(PERGUNTAS)("desviar de assunto não basta: %s", (pergunta) => {
    const d = decideResposta(pergunta, "Entendi. Em que data isso aconteceu?", CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
    if (d.acao === "entregar_ao_advogado") {
      expect(d.motivos).toContain("pergunta_de_merito");
    }
  });

  it.each(PERGUNTAS)("a resposta que defere ao advogado SAI: %s", (pergunta) => {
    const d = decideResposta(
      pergunta,
      "Essa análise é do advogado, e eu não posso fazer. Vou passar seu caso para ele hoje.",
      CONTINUACAO,
    );
    expect(d.acao).toBe("enviar");
  });

  it("o deferimento que a camada 1 exige NÃO é bloqueado pela camada 2", () => {
    // A contradição que existia: a camada 1 obriga a resposta a remeter ao
    // advogado, e a camada 2 bloqueava "seu caso está com ele". O portão exigia
    // uma frase e proibia a mesma frase.
    for (const r of [
      "Só o advogado pode avaliar valores. Seu caso está com ele agora.",
      "Essa parte é com o doutor. Seu caso está na mesa dele.",
      "Não posso adiantar. Vou passar e o senhor recebe o retorno hoje.",
    ]) {
      expect(decideResposta("Quanto eu vou receber?", r, CONTINUACAO).acao).toBe("enviar");
    }
  });

  it("deferir não dá licença para prometer na mesma frase", () => {
    const d = decideResposta(
      "Eu ganho essa causa?",
      "O advogado confirma depois, mas o senhor ganha, pode confiar.",
      CONTINUACAO,
    );
    expect(d.acao).toBe("entregar_ao_advogado");
  });

  it("pergunta de fato, não de mérito, não exige deferência", () => {
    expect(perguntaDeMerito("Vocês atendem em Fortaleza?")).toBe(false);
    expect(perguntaDeMerito("Qual o endereço do escritório?")).toBe(false);
    expect(perguntaDeMerito("Preciso levar algum documento?")).toBe(false);
  });

  it("reconhece as formas de deferir", () => {
    expect(defereAoAdvogado("Vou encaminhar para o advogado responsável.")).toBe(true);
    expect(defereAoAdvogado("Não posso adiantar isso, mas registro agora.")).toBe(true);
    expect(defereAoAdvogado("Depende dos documentos, e quem avalia é o Dr. Paulo.")).toBe(true);
    expect(defereAoAdvogado("Em que data isso aconteceu?")).toBe(false);
  });
});

/**
 * Critério 6 — porta de saída humana (Recomendação 001/2024).
 *
 * O corpus veio de como o cliente escreve de verdade: artigo no meio, sem
 * acento, sem interrogação, com abreviação. A versão anterior falhava em 14
 * destas 16 frases — e o critério 6 é norma, não conveniência.
 */
describe("pediu pessoa, a conversa sai do robô", () => {
  it.each([
    "quero falar com um ser humano",
    "quero falar com uma pessoa",
    "vc é um robô?",
    "você é uma máquina?",
    "isso é robô",
    "tô falando com um robô?",
    "não quero falar com um robô",
    "quero atendimento humano",
    "quero um atendente",
    "me chama um humano",
    "me transfira para um atendente",
    "quero falar com gente",
    "quero falar com o responsável",
    "cadê a atendente?",
    "posso falar com a secretária?",
    "me passa pro advogado",
  ])("reconhece: %s", (msg) => {
    expect(pedeHumano(msg)).toBe(true);
  });

  it.each([
    "bom dia",
    "fui demitido semana passada",
    "meu chefe não pagou as horas extras",
    "trabalhei lá três anos",
  ])("não confunde com conversa normal: %s", (msg) => {
    expect(pedeHumano(msg)).toBe(false);
  });

  it("o pedido de humano vence tudo — nem avalia a resposta", () => {
    const d = decideResposta("quero falar com uma pessoa", "Você ganha essa causa!", CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
  });

  it("não insiste: a saída não devolve texto para mandar ao cliente", () => {
    const d = decideResposta("me passa para alguém", "Posso te ajudar melhor que uma pessoa!", CONTINUACAO);
    expect(d).not.toHaveProperty("texto");
  });
});

/** Critério 5 — a primeira resposta diz que é máquina. */
describe("a primeira resposta se identifica como máquina", () => {
  it("sem identificação, a primeira resposta não sai", () => {
    const v = avalia("Bom dia! Como posso ajudar?", PRIMEIRA);
    expect(v.liberado).toBe(false);
    expect(v.violacoes.map((x) => x.motivo)).toContain("sem_identificacao_de_maquina");
  });

  it.each([
    "Olá! Este é o atendimento automático do escritório.",
    "Sou um assistente virtual e vou te ajudar.",
    "Não sou advogado — faço a triagem inicial.",
  ])("reconhece a identificação: %s", (texto) => {
    expect(seIdentificaComoMaquina(texto)).toBe(true);
  });

  it("na continuação não se exige repetir a identificação", () => {
    expect(avalia("Certo. Em que data isso aconteceu?", CONTINUACAO).liberado).toBe(true);
  });

  it("eco da pergunta do cliente não conta como identificação", () => {
    // "Você perguntou se isso é um atendimento automático" satisfazia a versão
    // anterior: o robô repetia o cliente e a norma era dada por cumprida.
    expect(
      seIdentificaComoMaquina("Você perguntou se isso é um atendimento automático. Vou te ajudar!"),
    ).toBe(false);
    expect(seIdentificaComoMaquina("Sou um assistente automático do escritório.")).toBe(true);
  });

  it("mas o eco não invalida identificação de verdade que venha junto", () => {
    // A primeira versão do guarda de eco vetava a resposta CERTA. Excesso de
    // trava também é defeito: reprovar quem cumpriu a norma ensina a burlá-la.
    expect(
      seIdentificaComoMaquina("Você perguntou sobre horas extras. Sou um assistente virtual do escritório."),
    ).toBe(true);
  });
});

describe("o veredito serve para auditar depois", () => {
  it("uma resposta com dois defeitos reporta os dois motivos", () => {
    const d = decideResposta(
      "e aí, o que acha?",
      "Você vai ganhar, garanto. Somos o melhor escritório da cidade.",
      CONTINUACAO,
    );
    expect(d.acao).toBe("entregar_ao_advogado");
    if (d.acao === "entregar_ao_advogado") {
      expect(d.motivos).toContain("promessa_de_resultado");
      expect(d.motivos).toContain("linguagem_mercantil");
    }
  });

  it("o trecho que disparou a trava é reportado, já normalizado", () => {
    // `some`, não `violacoes[0]`: a ordem das regras é detalhe de implementação,
    // e a primeira versão deste teste falhou por depender dela.
    const v = avalia("Com certeza você ganha essa causa.", CONTINUACAO);
    expect(v.violacoes.some((x) => x.trecho.includes("com certeza"))).toBe(true);
  });
});

/**
 * O que este módulo NÃO garante, escrito como teste para não virar promessa.
 *
 * O critério 4 (não falar com quem não escreveu) está garantido NESTA
 * assinatura: sem mensagem do cliente não há saída. Mas o fork tem motor de
 * follow-up agendado em `lib/followup/`, que dispara sem inbound e não passa
 * por aqui. Enquanto a E3 não ligar as duas coisas, o critério é verdadeiro no
 * módulo e falso no produto.
 */
describe("o buraco declarado", () => {
  it("sem mensagem do cliente, nada sai por este caminho", () => {
    const d = decideResposta("", "Olá! Temos uma oportunidade para o senhor.", CONTINUACAO);
    expect(d.acao).toBe("entregar_ao_advogado");
  });
});
