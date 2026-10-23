/**
 * O PADRÃO DO AMBIENTE que as telas dizem é o que o worker faz.
 *
 * A tela de Segurança (e o cartão do Jev, que depende da camada anti-manipulação)
 * rodam no servidor web; quem roda a camada é o worker, a partir de
 * `turnKnobsFromEnv`. Os dois lados eram escritos à mão, e discordavam: a tela
 * dizia "Desligada" sem `JAILBREAK_CLASSIFIER_MODEL`, e o worker rodava a
 * camada — o knob existe sempre. Aqui os dois são comparados, sem número fixo.
 */
import { describe, expect, it } from "vitest";

import type { Env } from "../env";
import { turnKnobsFromEnv } from "../agent/turn-knobs";

import { camadaLigada, camadasEfetivas, escolhaDasLinhas, padraoDasCamadasNoAmbiente } from "./camadas-da-org";

/** Como o turno decide a camada sem escolha da organização (`inbound-turn.ts`). */
const oWorkerRodaAManipulacao = (env: Partial<Env>) =>
  camadaLigada(null, turnKnobsFromEnv(env as Env).jailbreak !== undefined);

describe("padrão das camadas fora do worker", () => {
  it.each([
    ["sem JAILBREAK_CLASSIFIER_MODEL", {}],
    ["com JAILBREAK_CLASSIFIER_MODEL", { JAILBREAK_CLASSIFIER_MODEL: "anthropic/claude-haiku-4-5" }],
  ])("a manipulação, %s: a tela diz o que o worker faz", (_caso, env) => {
    expect(padraoDasCamadasNoAmbiente(env).jailbreak).toBe(oWorkerRodaAManipulacao(env));
  });

  it("a escolha da organização vence o padrão, e camada desconhecida é ignorada", () => {
    const linhas = [
      { layer: "jailbreak", enabled: false },
      { layer: "camada_de_uma_versao_futura", enabled: true },
    ];
    expect(escolhaDasLinhas(linhas)).toEqual({
      promessa_semantica: null,
      jailbreak: false,
      afirmacao_clinica: null,
      travas_oab: null,
    });
    expect(
      camadasEfetivas(linhas, { promessa_semantica: true, jailbreak: true, afirmacao_clinica: false, travas_oab: true }),
    ).toEqual({
      promessa_semantica: true,
      jailbreak: false,
      afirmacao_clinica: false,
      travas_oab: true,
    });
    expect(
      camadasEfetivas([], { promessa_semantica: false, jailbreak: true, afirmacao_clinica: false, travas_oab: true }),
    ).toEqual({
      promessa_semantica: false,
      jailbreak: true,
      afirmacao_clinica: false,
      travas_oab: true,
    });
  });

  it("as travas da OAB nascem LIGADAS: sem linha vale ligada, e a organização pode desligar", () => {
    // Inverso da clínica: a spec do escritório proíbe conversa real sem as travas.
    expect(padraoDasCamadasNoAmbiente({}).travas_oab).toBe(true);
    expect(camadasEfetivas([]).travas_oab).toBe(true);
    expect(camadasEfetivas([{ layer: "travas_oab", enabled: false }]).travas_oab).toBe(false);
    expect(escolhaDasLinhas([]).travas_oab).toBeNull();
  });

  it("a afirmação clínica nasce desligada e sem variável de ambiente: só a organização liga", () => {
    // Nenhuma variável liga a camada — nem uma que pareça ser dela.
    expect(padraoDasCamadasNoAmbiente({ PROMISE_SEMANTIC_ENABLED: "true" }).afirmacao_clinica).toBe(false);
    expect(camadasEfetivas([{ layer: "afirmacao_clinica", enabled: true }]).afirmacao_clinica).toBe(true);
  });
});
