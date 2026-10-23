import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { CAMADAS_SEMANTICAS, camadasEfetivas, padraoDasCamadasNoAmbiente } from "@/lib/agent-engine/guardrails/camadas-da-org";
import { montaFicha, CAMPO_DA_DECISAO_DA_TRIAGEM, CAMPO_DA_URGENCIA } from "@/lib/casos/ficha";
import { motivoDoAviso, textoDoAviso } from "@/lib/escalacao/aviso-ao-lead";
import { MOTIVOS_DA_PASSAGEM, ORIGENS_DA_PASSAGEM } from "@/lib/escalacao/passagem";
import { avalia } from "@/lib/oab/travas";
import {
  APRESENTACAO_DA_RECUSA,
  desvioDaTriagem,
  entregaPorUrgenciaDoCliente,
  TRIAGEM_SYSTEM_BLOCK,
  type EntregaAoAdvogado,
  type GanchosDoTurno,
} from "@/lib/triagem/desvio-no-turno";
import { CAMPOS_DA_TRIAGEM, type DecisaoDeTriagem } from "@/lib/triagem/registrar-triagem";
import { CONFERENCIA_DA_TRIAGEM } from "@/lib/ai/guardrails/lista-de-conferencia";
import { detectaUrgenciasJuridicas } from "@/lib/triagem/urgencia-juridica";

/**
 * A triagem jurídica ligada ao turno (#10 parte 3): a parte PURA (o que se faz com cada decisão), a
 * camada da organização, o aviso ao cliente e a fiação no turno. O turno inteiro contra Postgres está em
 * `tests/invariants/triagem-no-turno.test.ts`.
 *
 * MUTAÇÕES FEITAS em 23/10/2026 (regra apagada -> um teste acusou -> regra devolvida):
 *   1. desvio: sem reenvio da recusa com a apresentação -> "recusa na 1ª mensagem…".
 *   2. desvio: o conflito passa a usar o aviso de urgência -> "conflito: aviso GENÉRICO…".
 *   3. desvio: o retorno ao modelo passa a carregar a decisão (com o nome do outro cliente) -> o mesmo caso.
 *   4. aviso-ao-lead: `triagem_conflito` sem o mapeamento genérico -> "motivoDoAviso…".
 *   5. camadas: padrão de `triagem_juridica` false -> "nasce LIGADA".
 *   6. inbound-turn: o desvio de urgência sem o `return` (seguiria para o modelo) -> "o desvio de urgência…".
 *   7. ficha: `triagemRodou` ignorado -> "triagem rodada sem urgência gravada…".
 *   8. inbound-turn: `camadaLigada(camadas.triagem_juridica, false)` -> "a camada manda…".
 *   Segunda rodada (revisão da parte 3), cada uma acusada e devolvida:
 *   9. recusa sem a passagem ao advogado; 10. aviso novo mesmo com a recusa lida (semAviso false);
 *  11. `saiu()` aceitando qualquer ok (rascunho contaria como enviado); 12. recusa com severidade crítica;
 *  13. turno sem repassar a severidade à Central; 14. turno ignorando `semAviso`; 15. aviso de urgência com
 *      "agora mesmo"; 16. ficha ignorando a urgência do histórico; 17. trava_oab na recusa gerando 2ª passagem;
 *  18. ponto de chamada de `registraUrgenciaNoCaso` removido.
 */

const URGENCIA = detectaUrgenciasJuridicas("Minha audiência é amanhã de manhã");

function ganchos(envio: Array<{ ok?: boolean; status?: string; error?: { code: string } }> = [{ ok: true, status: "enviada" }]) {
  const enviarRecusa = vi.fn<GanchosDoTurno["enviarRecusa"]>();
  for (const r of envio) enviarRecusa.mockResolvedValueOnce(r);
  const entregar = vi.fn<(e: EntregaAoAdvogado) => Promise<void>>().mockResolvedValue(undefined);
  return { enviarRecusa, entregar, g: { enviarRecusa, entregar } satisfies GanchosDoTurno };
}

const REGISTRO = { gravado: true, casoId: "c1" } as const;
const SEGUIR: DecisaoDeTriagem = { acao: "seguir", area: "Trabalhista", pendente: ["parte_contraria"], instrucao: "x", registro: REGISTRO };
const RECUSAR: DecisaoDeTriagem = { acao: "recusar", area: "Criminal", texto: "Este escritório não atua na área criminal.", instrucao: "x", registro: REGISTRO };
const passar = (motivo: "urgencia" | "conflito" | "area_a_decidir"): DecisaoDeTriagem => ({
  acao: "passar_ao_advogado",
  motivo,
  area: "Trabalhista",
  urgencias: motivo === "urgencia" ? URGENCIA : [],
  conflito: motivo === "conflito" ? [{ contactId: "x", nome: "Fulano de Tal Silva", casos: 2, como: "igual" }] : [],
  instrucao: "x",
  registro: REGISTRO,
});

describe("desvioDaTriagem — o que o turno faz com a decisão", () => {
  it("seguir: devolve a decisão ao modelo e não envia nem passa nada", async () => {
    const { g, enviarRecusa, entregar } = ganchos();
    expect(await desvioDaTriagem(SEGUIR, g)).toBe(SEGUIR);
    expect(enviarRecusa).not.toHaveBeenCalled();
    expect(entregar).not.toHaveBeenCalled();
  });

  it("erro da ferramenta volta como veio (o modelo é ensinado a passar para humano)", async () => {
    const { g, entregar } = ganchos();
    const erro = { ok: false as const, error: { code: "internal_error", message: "x" } };
    expect(await desvioDaTriagem(erro, g)).toBe(erro);
    expect(entregar).not.toHaveBeenCalled();
  });

  it("recusar: o texto pronto sai pela cadeia, exatamente como veio, e a conversa vai ao advogado conferir", async () => {
    const { g, enviarRecusa, entregar } = ganchos([{ ok: true, status: "enviada" }]);
    const r = (await desvioDaTriagem(RECUSAR, g)) as { enviada: boolean; entregue: boolean; instrucao: string };
    expect(enviarRecusa).toHaveBeenCalledTimes(1);
    expect(enviarRecusa).toHaveBeenCalledWith(RECUSAR.texto);
    // Sem isto o cliente que escrevesse de novo teria a história colhida por quem acabou de ser recusado.
    expect(entregar).toHaveBeenCalledTimes(1);
    const e = entregar.mock.calls[0]![0];
    expect(e.motivoCodigo).toBe("triagem_recusa");
    expect(e.origem).toBe("triagem_juridica");
    expect(e.severidade, "o item da Central é pedido de conferência, não alarme").toBe("info");
    expect(e.inboxTitle).toMatch(/confira se a recusa estava certa/);
    expect(e.semAviso, "o cliente acabou de ler a recusa: sem novo aviso").toBe(true);
    expect(r.enviada).toBe(true);
    expect(r.entregue).toBe(true);
    expect(r.instrucao).toMatch(/encerre o turno/);
  });

  it("recusa que NÃO saiu (rascunho, canal na fila fora, veto): a passagem acontece, com aviso, e o retorno e o briefing dizem", async () => {
    for (const envio of [
      { ok: true, status: "rascunho" },
      { ok: false, error: { code: "outside_window" } },
      { ok: false, error: { code: "envio_falhou" } },
    ]) {
      const { g, entregar } = ganchos([envio]);
      const r = (await desvioDaTriagem(RECUSAR, g)) as { enviada: boolean; entregue: boolean; instrucao: string };
      expect(entregar, JSON.stringify(envio)).toHaveBeenCalledTimes(1);
      const e = entregar.mock.calls[0]![0];
      expect(e.motivoCodigo).toBe("triagem_recusa");
      expect(e.semAviso, "ele não leu a recusa: recebe o aviso genérico").toBe(false);
      expect(e.motivoDoAviso).toBe("advogado_vai_responder");
      expect(e.tentativa.desfecho).toMatch(/NÃO chegou ao cliente/);
      expect(r.enviada).toBe(false);
      expect(r.instrucao).toMatch(/NÃO chegou ao cliente/);
    }
  });

  it("recusa aceita pelo canal e na fila (canal fora): conta como saída — o cliente vai ler", async () => {
    const { g, entregar } = ganchos([{ ok: true, status: "aceita_aguardando_canal" }]);
    await desvioDaTriagem(RECUSAR, g);
    expect(entregar.mock.calls[0]![0].semAviso).toBe(true);
  });

  it("a trava da OAB barrou a própria recusa: já foi entregue ao advogado, sem segunda passagem", async () => {
    const { g, entregar } = ganchos([{ ok: false, error: { code: "trava_oab" } }]);
    const r = (await desvioDaTriagem(RECUSAR, g)) as { ok: boolean; error: { code: string } };
    expect(entregar).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("trava_oab");
  });

  it("recusa na 1ª mensagem: se SÓ a identificação vetou, reenvia com a apresentação na frente", async () => {
    const { g, enviarRecusa } = ganchos([{ ok: false, error: { code: "trava_oab_identificacao" } }, { ok: true, status: "enviada" }]);
    const r = (await desvioDaTriagem(RECUSAR, g)) as { enviada?: boolean };
    expect(enviarRecusa).toHaveBeenCalledTimes(2);
    expect(enviarRecusa).toHaveBeenLastCalledWith(`${APRESENTACAO_DA_RECUSA} ${RECUSAR.texto}`);
    expect(r.enviada).toBe(true);
    // E a apresentação cumpre a regra de verdade, não só a nossa leitura dela.
    expect(avalia(`${APRESENTACAO_DA_RECUSA} ${RECUSAR.texto}`, { primeiraResposta: true }).liberado).toBe(true);
  });

  it("recusa que não saiu por outro veto: o erro volta ao modelo, sem improviso", async () => {
    const { g, enviarRecusa } = ganchos([{ ok: false, error: { code: "outside_window" } }]);
    const r = (await desvioDaTriagem(RECUSAR, g)) as { enviada: boolean; instrucao: string };
    expect(enviarRecusa).toHaveBeenCalledTimes(1);
    expect(r.enviada).toBe(false);
    expect(r.instrucao).toMatch(/outside_window/);
    expect(r.instrucao).toMatch(/encerre o turno/);
  });

  it("urgência: passa ao advogado com motivo, origem, aviso e título críticos", async () => {
    const { g, entregar, enviarRecusa } = ganchos();
    await desvioDaTriagem(passar("urgencia"), g);
    expect(enviarRecusa).not.toHaveBeenCalled();
    const e = entregar.mock.calls[0]![0];
    expect(e.motivoCodigo).toBe("urgencia_juridica");
    expect(e.reason).toBe("urgencia_juridica");
    expect(e.origem).toBe("triagem_juridica");
    expect(e.motivoDoAviso).toBe("urgencia_juridica");
    expect(e.inboxTitle).toMatch(/Urgência jurídica/);
    expect(e.tentativa.desfecho).toMatch(/audiência é amanhã/i);
  });

  it("conflito: aviso GENÉRICO ao cliente, e a palavra não aparece em nada que o cliente ou o modelo leem", async () => {
    const { g, entregar } = ganchos();
    const volta = await desvioDaTriagem(passar("conflito"), g);
    const e = entregar.mock.calls[0]![0];
    expect(e.motivoCodigo).toBe("triagem_conflito");
    expect(e.motivoDoAviso).toBe("advogado_vai_responder");
    // O que o cliente lê: todas as variantes, nos dois idiomas, para vários leads.
    for (const idioma of ["pt-BR", "es"]) {
      for (let lead = 0; lead < 12; lead++) {
        const texto = textoDoAviso(e.motivoDoAviso, null, `lead-${lead}`, idioma);
        expect(texto).not.toMatch(/conflit|cliente d[eo]l? (escrit|despach)/i);
      }
    }
    // O que volta ao modelo: sem o nome do outro cliente, sem conflito.
    expect(JSON.stringify(volta)).not.toMatch(/Fulano|conflit/i);
    expect(JSON.stringify(e.tentativa)).not.toMatch(/Fulano/);
  });

  it("área a decidir e sem caso: triagem_area, aviso genérico", async () => {
    for (const d of [passar("area_a_decidir"), { acao: "passar_ao_advogado", motivo: "sem_caso" } as const]) {
      const { g, entregar } = ganchos();
      await desvioDaTriagem(d, g);
      const e = entregar.mock.calls[0]![0];
      expect(e.motivoCodigo).toBe("triagem_area");
      expect(e.motivoDoAviso).toBe("advogado_vai_responder");
    }
  });

  it("o que volta ao modelo depois de uma entrega manda encerrar e não carrega os detalhes", async () => {
    const { g } = ganchos();
    const volta = (await desvioDaTriagem(passar("urgencia"), g)) as Record<string, unknown>;
    expect(volta.entregue).toBe(true);
    expect(String(volta.instrucao)).toMatch(/encerre o turno/);
    expect(volta).not.toHaveProperty("urgencias");
    expect(volta).not.toHaveProperty("conflito");
  });

  it("os vocabulários que a entrega usa existem no vocabulário da passagem (senão o INSERT dá 23514)", async () => {
    const todas: EntregaAoAdvogado[] = [];
    for (const d of [passar("urgencia"), passar("conflito"), passar("area_a_decidir"), RECUSAR]) {
      const { g, entregar } = ganchos();
      await desvioDaTriagem(d, g);
      todas.push(entregar.mock.calls[0]![0]);
    }
    todas.push(entregaPorUrgenciaDoCliente(URGENCIA));
    for (const e of todas) {
      expect(MOTIVOS_DA_PASSAGEM).toContain(e.motivoCodigo);
      expect(ORIGENS_DA_PASSAGEM).toContain(e.origem);
    }
  });
});

describe("o aviso ao cliente da urgência", () => {
  it("motivoDoAviso: urgência tem frase própria; conflito e área usam a genérica", () => {
    expect(motivoDoAviso("urgencia_juridica")).toBe("urgencia_juridica");
    expect(motivoDoAviso("triagem_conflito")).toBe("advogado_vai_responder");
    expect(motivoDoAviso("triagem_area")).toBe("advogado_vai_responder");
    expect(motivoDoAviso("triagem_recusa")).toBe("advogado_vai_responder");
  });

  it("diz só que o advogado foi avisado: nada de agora mesmo, na hora, neste momento", () => {
    for (const idioma of ["pt-BR", "es"]) {
      for (let lead = 0; lead < 12; lead++) {
        const texto = textoDoAviso("urgencia_juridica", null, `lead-${lead}`, idioma);
        expect(texto).not.toMatch(/agora|neste momento|na hora|ahora|inmediat/i);
      }
    }
  });

  it("não opina, não promete prazo nem resultado: passa nas travas da OAB, em todas as variantes", () => {
    for (const idioma of ["pt-BR", "es"]) {
      for (let lead = 0; lead < 12; lead++) {
        const texto = textoDoAviso("urgencia_juridica", null, `lead-${lead}`, idioma);
        if (idioma === "pt-BR") expect(avalia(texto, { primeiraResposta: false }).liberado, texto).toBe(true);
        expect(texto).toMatch(/advogad|abogad/i);
      }
    }
  });
});

describe("a camada da organização", () => {
  it("`triagem_juridica` é escolha da organização e nasce LIGADA", () => {
    expect(CAMADAS_SEMANTICAS).toContain("triagem_juridica");
    expect(padraoDasCamadasNoAmbiente({}).triagem_juridica).toBe(true);
    expect(camadasEfetivas([]).triagem_juridica).toBe(true);
    expect(camadasEfetivas([{ layer: "triagem_juridica", enabled: false }]).triagem_juridica).toBe(false);
  });

  it("aparece na tela de Segurança com escolha de custo zero", () => {
    expect(CONFERENCIA_DA_TRIAGEM.camada).toBe("triagem_juridica");
    expect(CONFERENCIA_DA_TRIAGEM.escolha?.consultaModelo).toBe(false);
    expect(CONFERENCIA_DA_TRIAGEM.escolha?.custo).toMatch(/não custa/i);
  });
});

describe("a ficha mostra o que a triagem gravou", () => {
  const CASO = { id: "c1", title: "Caso", created_at: "2026-10-23T12:00:00Z", contact_id: "k1" };
  const monta = (custom_fields: Record<string, unknown>) =>
    montaFicha({
      caso: { ...CASO, custom_fields },
      contato: null,
      mensagens: [],
      compromissos: [],
      agora: new Date("2026-10-23T13:00:00Z"),
    });

  it("os nomes das chaves são os que a triagem grava (renomear esconde o que já foi gravado)", () => {
    expect(CAMPO_DA_URGENCIA).toBe(CAMPOS_DA_TRIAGEM.urgencia);
    expect(CAMPO_DA_DECISAO_DA_TRIAGEM).toBe(CAMPOS_DA_TRIAGEM.decisao);
  });

  it("urgência gravada aparece, e deixa de ser 'a definir'", () => {
    const f = monta({ [CAMPOS_DA_TRIAGEM.urgencia]: "audiência marcada: «audiência é amanhã»" });
    expect(f.urgenciaDaTriagem).toBe("audiência marcada: «audiência é amanhã»");
    expect(f.daTriagem).not.toContain("urgencia");
  });

  it("triagem rodada sem urgência gravada: o léxico não achou — nunca 'sem urgência'", () => {
    const f = monta({ [CAMPOS_DA_TRIAGEM.decisao]: "seguir" });
    expect(f.urgenciaDaTriagem).toBeNull();
    expect(f.triagemRodou).toBe(true);
    expect(f.daTriagem).not.toContain("urgencia");
  });

  it("a passagem por urgência antes do modelo não grava no caso: a ficha lê o histórico e NUNCA diz que não encontrou", () => {
    const f = montaFicha({
      caso: { ...CASO, custom_fields: { [CAMPOS_DA_TRIAGEM.decisao]: "seguir" } },
      contato: null,
      mensagens: [
        {
          id: "m1",
          conversation_id: "v1",
          direction: "inbound",
          body: "Minha audiência é amanhã de manhã",
          media_mime: null,
          media_size_bytes: null,
          created_at: "2026-10-23T12:30:00Z",
        },
      ],
      compromissos: [],
      agora: new Date("2026-10-23T13:00:00Z"),
    });
    expect(f.urgenciaDaTriagem).toBeNull();
    expect(f.urgenciasNoHistorico.map((u) => u.trecho)).toEqual(["audiência é amanhã"]);
    expect(f.daTriagem, "há urgência no histórico: a triagem não está 'limpa'").toContain("urgencia");
  });

  it("sem triagem: continua a definir", () => {
    const f = monta({});
    expect(f.triagemRodou).toBe(false);
    expect(f.daTriagem).toContain("urgencia");
  });
});

/** FIAÇÃO — asserção sobre a FONTE do turno (não há seam isolável); a prova ponta a ponta é o invariante. */
const FONTE = fs.readFileSync(path.join(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
const FONTE_BREAKER = fs.readFileSync(path.join(process.cwd(), "lib/agent-engine/agent/tool-breaker.ts"), "utf8");

describe("fiação da triagem no turno", () => {
  it("a camada manda: padrão LIGADA, fora do Testar", () => {
    expect(FONTE).toMatch(/const triagemLigada = !preview && camadaLigada\(camadas\.triagem_juridica, true\)/);
  });

  it("a urgência vem DEPOIS do opt-out e ANTES do roteiro e do modelo", () => {
    const optOut = FONTE.indexOf("F4-07: STOP AMBÍGUO");
    const urgencia = FONTE.indexOf("URGÊNCIA JURÍDICA (spec 0001.E3");
    const roteiro = FONTE.indexOf("ROTEIRO DE ATENDIMENTO (módulo opcional");
    expect(optOut).toBeGreaterThan(-1);
    expect(urgencia).toBeGreaterThan(optOut);
    expect(roteiro).toBeGreaterThan(urgencia);
  });

  it("o desvio de urgência avisa o cliente antes de passar, sem modelo", () => {
    const i = FONTE.indexOf("const entregarAoAdvogadoNoTurno");
    const corpo = FONTE.slice(i, i + 1800);
    expect(corpo.indexOf("avisarLeadDaEscalacao(")).toBeGreaterThan(-1);
    expect(corpo.indexOf("avisarLeadDaEscalacao(")).toBeLessThan(corpo.indexOf("performHumanHandoff("));
    const bloco = FONTE.slice(FONTE.indexOf("URGÊNCIA JURÍDICA (spec 0001.E3"), FONTE.indexOf("ROTEIRO DE ATENDIMENTO (módulo opcional"));
    expect(bloco).toMatch(/entregaPorUrgenciaDoCliente\(urgencias\)/);
    expect(bloco).toMatch(/return;/);
  });

  it("a passagem da recusa: sem novo aviso quando a recusa saiu, e item da Central de severidade baixa", () => {
    const i = FONTE.indexOf("const entregarAoAdvogadoNoTurno");
    const corpo = FONTE.slice(i, i + 2200);
    expect(corpo).toMatch(/p\.semAviso\s*\?\s*\(\{ avisado: true \} as const\)\s*:\s*await avisarLeadDaEscalacao\(/);
    expect(corpo).toMatch(/severidadeDaCentral: p\.severidade/);
    expect(corpo.indexOf("avisarLeadDaEscalacao(")).toBeLessThan(corpo.indexOf("performHumanHandoff("));
  });

  it("o ponto de chamada de registraUrgenciaNoCaso está marcado, antes da passagem por urgência", () => {
    const todo = FONTE.indexOf("TODO(#18)");
    const passagem = FONTE.indexOf("entregarAoAdvogadoNoTurno(entregaPorUrgenciaDoCliente");
    expect(todo).toBeGreaterThan(-1);
    expect(todo).toBeLessThan(passagem);
    expect(FONTE.slice(todo, passagem)).toMatch(/registraUrgenciaNoCaso/);
  });

  it("registrar_triagem ESCREVE: não está em READ_ONLY_TOOLS; está nas definições e só entra com a camada", () => {
    expect(FONTE_BREAKER).not.toMatch(/registrar_triagem/);
    expect(FONTE).toMatch(/\.\.\.DEFS_DA_TRIAGEM/);
    expect(FONTE).toMatch(/if \(triagemLigada\) \{\n    const triagem = ferramentasDaTriagem\(/);
  });

  it("a instrução de prompt só entra com a camada ligada", () => {
    expect(FONTE).toMatch(/if \(triagemLigada\) blocosResidentes\.push\(TRIAGEM_SYSTEM_BLOCK\)/);
    expect(TRIAGEM_SYSTEM_BLOCK).toMatch(/registrar_triagem/);
    expect(TRIAGEM_SYSTEM_BLOCK).toMatch(/nome da outra parte/);
    expect(TRIAGEM_SYSTEM_BLOCK.indexOf("nome da outra parte")).toBeLessThan(TRIAGEM_SYSTEM_BLOCK.indexOf("relato"));
  });
});
