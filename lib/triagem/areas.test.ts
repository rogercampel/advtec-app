/**
 * Spec 0001.E3, critério 7 — área do direito e recusa educada, sem coletar história.
 *
 * MUTAÇÕES (23/10/2026; aplicadas, acusadas, desfeitas):
 *   - em `decideArea`, trocar `every` por `some` na linha da recusa → "criminal + trabalhista" passa a recusar e o teste de mistura acusa;
 *   - em `decideAreaDoCaso`, devolver sempre `completa` → "demitido + aluguel" deixa de atender e acusa;
 *   - tirar o `(?! ... trabalho)` do termo "delegacia" → "delegacia do trabalho" vira criminal e acusa;
 *   - em `leConfigDeTriagem`, aceitar entrada não reconhecida → o teste do erro de digitação acusa.
 */
import { describe, expect, it } from "vitest";

import { avalia } from "@/lib/oab/travas";

import {
  areaDoRotulo,
  classificaArea,
  decideArea,
  decideAreaDoCaso,
  textoDeRecusa,
  type ConfigDeAreas,
} from "./areas";
import { CONFIG_PADRAO, leConfigDeTriagem } from "./config";

const PILOTO: ConfigDeAreas = { atendidas: ["trabalhista", "familia_sucessoes"], recusadas: ["criminal"] };

describe("classificaArea: linguagem de cliente leigo", () => {
  const frases: Array<[string, string]> = [
    ["fui mandado embora ontem sem receber nada", "trabalhista"],
    ["trabalhei 5 anos sem carteira assinada", "trabalhista"],
    ["meu patrão não pagou o FGTS", "trabalhista"],
    ["quero me divorciar e ficar com a guarda do meu filho", "familia_sucessoes"],
    ["meu pai faleceu e preciso abrir o inventário", "familia_sucessoes"],
    ["quero pedir pensão alimentícia pra minha filha", "familia_sucessoes"],
    ["meu marido foi preso em flagrante", "criminal"],
    ["fui acusado de furto na loja", "criminal"],
    ["o INSS negou meu auxílio-doença", "previdenciario"],
    ["meu nome foi negativado no Serasa sem eu dever", "consumidor"],
    ["caí na malha fina da Receita Federal", "tributario"],
  ];
  it.each(frases)("%s", (frase, area) => {
    const c = classificaArea(frase);
    expect(c.area).toBe(area);
    expect(c.trecho).toBeTruthy();
    expect(frase.toLowerCase()).toContain(c.trecho!.toLowerCase().slice(0, 4));
  });

  it("devolve o trecho como o cliente escreveu", () => {
    expect(classificaArea("Fui MANDADA embora semana passada").trecho).toBe("Fui MANDADA embora");
  });

  it("controles negativos: conversa sem assunto jurídico e palavra solta ambígua", () => {
    expect(classificaArea("bom dia, queria marcar uma conversa").area).toBeNull();
    expect(classificaArea("o guarda de trânsito me parou").area).toBeNull();
    expect(classificaArea("comprei um guarda-roupa novo").area).toBeNull();
    expect(classificaArea("fui na delegacia do trabalho").candidatas.map((c) => c.area)).not.toContain("criminal");
    expect(classificaArea("").candidatas).toEqual([]);
  });

  it("devolve todas as candidatas quando o texto mistura áreas", () => {
    const c = classificaArea("fui demitido sem justa causa e agora preciso do divórcio");
    expect(c.candidatas.map((x) => x.area).sort()).toEqual(["familia_sucessoes", "trabalhista"]);
  });
});

describe("areaDoRotulo", () => {
  it.each([
    ["Trabalhista", "trabalhista"],
    ["direito do trabalho", "trabalhista"],
    ["Família e sucessões", "familia_sucessoes"],
    ["familia", "familia_sucessoes"],
    ["Penal", "criminal"],
    ["CRIMINAL", "criminal"],
  ])("%s -> %s", (rotulo, id) => expect(areaDoRotulo(rotulo)).toBe(id));
  it("desconhecida ou vazia -> null", () => {
    expect(areaDoRotulo("Direito Digital")).toBeNull();
    expect(areaDoRotulo("")).toBeNull();
    expect(areaDoRotulo(undefined)).toBeNull();
  });
});

describe("decideArea: o que o escritório faz", () => {
  it("atende as atendidas e recusa as recusadas", () => {
    expect(decideArea(["trabalhista"], PILOTO).acao).toBe("atende");
    expect(decideArea(["familia_sucessoes", "trabalhista"], PILOTO).acao).toBe("atende");
    expect(decideArea(["criminal"], PILOTO).acao).toBe("recusa");
  });
  it("o resto vai para o advogado, não é recusado", () => {
    const d = decideArea(["previdenciario"], PILOTO);
    expect(d).toMatchObject({ acao: "perguntar_ao_advogado", motivo: "area_nao_configurada" });
  });
  it("mistura de recusada com atendida não recusa", () => {
    expect(decideArea(["criminal", "trabalhista"], PILOTO)).toMatchObject({
      acao: "perguntar_ao_advogado",
      motivo: "areas_misturadas",
    });
  });
  it("área não identificada vai para o advogado", () => {
    expect(decideArea([], PILOTO)).toMatchObject({ acao: "perguntar_ao_advogado", motivo: "area_nao_identificada" });
  });
  it("config que se contradiz (mesma área nas duas listas) vai para o advogado", () => {
    const c: ConfigDeAreas = { atendidas: ["criminal"], recusadas: ["criminal"] };
    expect(decideArea(["criminal"], c)).toMatchObject({ acao: "perguntar_ao_advogado", motivo: "config_contraditoria" });
  });
  it("sem config nenhuma área é recusada", () => {
    for (const a of ["trabalhista", "criminal", "civel"] as const) {
      expect(decideArea([a], CONFIG_PADRAO).acao).toBe("perguntar_ao_advogado");
    }
  });
});

describe("decideAreaDoCaso: modelo + o que o cliente disse", () => {
  const decide = (doModelo: Parameters<typeof decideAreaDoCaso>[0]["doModelo"], texto: string, config = PILOTO) =>
    decideAreaDoCaso({ doModelo, classificacao: classificaArea(texto), config });

  it("a área dominante atende mesmo com menção de raspão a outra", () => {
    expect(decide("trabalhista", "fui demitido, perdi o FGTS e a rescisão, e ainda atrasei o aluguel").acao).toBe("atende");
  });
  it("recusa só quando tudo que o cliente disse é de área recusada", () => {
    expect(decide("criminal", "meu filho foi preso em flagrante por furto").acao).toBe("recusa");
    expect(decide("criminal", "fui demitido e depois fui preso").acao).toBe("perguntar_ao_advogado");
  });
  it("modelo rotula atendida, mas o cliente só falou de crime: não atende às cegas", () => {
    expect(decide("trabalhista", "prenderam meu filho, ele está na delegacia").acao).toBe("perguntar_ao_advogado");
  });
  it("modelo sem rótulo conhecido e texto sem termo: advogado", () => {
    expect(decide(null, "preciso de ajuda com um assunto").acao).toBe("perguntar_ao_advogado");
  });
  it("sem config, nada é recusado nem atendido sozinho", () => {
    expect(decide("criminal", "fui preso em flagrante", CONFIG_PADRAO).acao).toBe("perguntar_ao_advogado");
  });
});

describe("config da organização", () => {
  it("lê ids e nomes como a pessoa escreve", () => {
    const c = leConfigDeTriagem({
      triagem: { areas_atendidas: ["Trabalhista", "Família e sucessões"], areas_recusadas: ["penal"] },
    });
    expect(c).toEqual({ atendidas: ["trabalhista", "familia_sucessoes"], recusadas: ["criminal"] });
  });
  it("erro de digitação na lista de recusa não recusa nada", () => {
    expect(leConfigDeTriagem({ triagem: { areas_recusadas: ["crimnal"] } }).recusadas).toEqual([]);
  });
  it("ausente, malformado ou de outro tipo cai no padrão", () => {
    for (const s of [null, undefined, {}, { triagem: "x" }, { triagem: { areas_atendidas: "trabalhista" } }, [], 3]) {
      expect(leConfigDeTriagem(s)).toEqual(CONFIG_PADRAO);
    }
  });
});

describe("texto da recusa educada", () => {
  it("não coleta história, não orienta, não promete e cita a Defensoria", () => {
    const t = textoDeRecusa(["criminal"]);
    expect(t).toContain("criminal");
    expect(t).toContain("Defensoria Pública");
    expect(t).toContain("Não precisa nos contar os detalhes");
    expect(t).not.toMatch(/\?/); // não pergunta nada: não puxa conversa
  });
  it("passa pelas travas da OAB (publicidade e mérito)", () => {
    expect(avalia(textoDeRecusa(["criminal"]), { primeiraResposta: false }).violacoes).toEqual([]);
  });
  it("não cita a Defensoria quando a área não é dela (tributário)", () => {
    expect(textoDeRecusa(["tributario"])).not.toContain("Defensoria");
  });
  it("duas áreas recusadas aparecem no texto", () => {
    expect(textoDeRecusa(["criminal", "tributario"])).toContain("criminal e tributário");
  });
});
