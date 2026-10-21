import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { PautaDeHoje } from "@/app/app/publicacoes/_components/PautaDeHoje";
import { CAMPO_DO_PROCESSO, daLinha, semRepetir, type LinhaDaPublicacao, type PublicacaoDaCaixa } from "@/lib/djen/caixa";
import { corteDoVencido, montaPauta } from "@/lib/djen/pauta";
import { montaResumo } from "@/lib/djen/resumo";

/**
 * Ticket 0006.E5 (e o "vence hoje / nesta semana" da 0009) — confirmação de prazo.
 *
 * O que não pode acontecer:
 *   - prazo NÃO confirmado aparecer como vencimento (spec 0006, critério 5);
 *   - prazo não confirmado sair da pauta com o tempo (critério 6, relógio adiantado);
 *   - prazo confirmado continuar dizendo "sugerido", ou SUMIR de todas as listas
 *     (ano digitado errado, vencido há dias, publicação que perdeu o caso, teto
 *     das 300 recentes);
 *   - o resumo da manhã omitir o que vence hoje ou o que já venceu.
 *
 * Mutações: ver o fim do arquivo.
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const NUM = "0001234-56.2026.8.26.0100";
const COM_PRAZO = "DESPACHO. Manifeste-se a parte autora no prazo de 15 (quinze) dias úteis sobre a contestação.";
const caso = { id: "n1", organization_id: ORG, title: "Caso", custom_fields: { [CAMPO_DO_PROCESSO]: NUM } };

/** 21/10/2026, 10h em Brasília. */
const HOJE = new Date("2026-10-21T13:00:00Z");
const maisDias = (n: number) => new Date(HOJE.getTime() + n * 86_400_000);

const pub = (id: string, data: string, venceEm: string | null = null): PublicacaoDaCaixa => ({
  id,
  organizationId: ORG,
  numeroProcesso: NUM,
  dataDisponibilizacao: data,
  tipoComunicacao: "Intimação",
  siglaTribunal: "TJSP",
  nomeOrgao: "3ª Vara Cível",
  texto: COM_PRAZO,
  descartadaEm: null,
  prazoConfirmado: venceEm ? { venceEm, confirmadoEm: "2026-10-20T15:00:00Z", observacao: null } : null,
});

const ids = (ls: Array<{ publicacao: { id: string } }>) => ls.map((l) => l.publicacao.id);

const confirmadosVisiveis = (p: ReturnType<typeof montaPauta>) =>
  [...p.venceu, ...p.venceHoje, ...p.venceNaSemana, ...p.venceDepois].map((l) => l.publicacao.id);

describe("pauta: só prazo confirmado vira vencimento", () => {
  it("separa venceu, hoje, próximos 7 dias e depois; sem confirmação fica pendente", () => {
    const p = montaPauta(
      [
        pub("hoje", "2026-10-10", "2026-10-21"),
        pub("em-7", "2026-10-10", "2026-10-28"),
        pub("em-3", "2026-10-10", "2026-10-24"),
        pub("em-40", "2026-10-10", "2026-11-30"),
        pub("em-8", "2026-10-10", "2026-10-29"),
        pub("ha-8", "2026-10-01", "2026-10-13"),
        pub("ontem", "2026-10-10", "2026-10-20"),
        pub("sem", "2026-10-10"),
      ],
      [caso],
      HOJE,
    );
    expect(ids(p.venceHoje)).toEqual(["hoje"]);
    expect(ids(p.venceNaSemana)).toEqual(["em-3", "em-7"]); // o que vence antes, primeiro
    expect(ids(p.venceDepois)).toEqual(["em-8", "em-40"]);
    expect(ids(p.venceu)).toEqual(["ontem", "ha-8"]); // o mais recente primeiro
    expect(ids(p.pendentes)).toEqual(["sem"]);
  });

  // O defeito que o segundo leitor achou: confirmar com o ano errado (2027), ou um
  // prazo vencido há 9 dias, tirava a linha de TODAS as listas logo depois do
  // clique — sem botão de corrigir. Tudo que a rota aceita tem de continuar à vista.
  it.each([
    ["ano digitado errado", "2027-10-21"],
    ["mês digitado errado", "2026-12-05"],
    ["vencido há 9 dias", "2026-10-12"],
    ["vencido há 60 dias (o limite da rota)", "2026-08-22"],
  ])("confirmado nunca some de vista: %s", (_, venceEm) => {
    expect(confirmadosVisiveis(montaPauta([pub("p", "2026-10-21", venceEm)], [caso], HOJE))).toEqual(["p"]);
  });

  it("confirmado de publicação que perdeu o caso (número saiu do negócio) continua nos vencimentos", () => {
    const p = montaPauta([pub("p", "2026-10-10", "2026-10-24")], [], HOJE);
    expect(ids(p.venceNaSemana)).toEqual(["p"]);
    expect(p.venceNaSemana[0]!.casoIds).toEqual([]);
  });

  it("publicação de hoje com prazo confirmado não aparece duas vezes", () => {
    const p = montaPauta([pub("p", "2026-10-21", "2026-10-23")], [caso], HOJE);
    expect(ids(p.chegouDesdeOntem)).toEqual([]);
    expect(ids(p.venceNaSemana)).toEqual(["p"]);
  });

  it("relógio adiantado: o confirmado anda de 'na semana' para 'hoje' e para 'venceu'", () => {
    const pubs = [pub("p", "2026-10-10", "2026-10-24")];
    expect(ids(montaPauta(pubs, [caso], HOJE).venceNaSemana)).toEqual(["p"]);
    expect(ids(montaPauta(pubs, [caso], maisDias(3)).venceHoje)).toEqual(["p"]);
    expect(ids(montaPauta(pubs, [caso], maisDias(4)).venceu)).toEqual(["p"]);
  });

  it.each([1, 7, 30])("relógio %i dia(s) adiante: o NÃO confirmado continua pendente", (n) => {
    const p = montaPauta([pub("p", "2026-10-10")], [caso], maisDias(n));
    expect(ids(p.pendentes)).toEqual(["p"]);
    expect([...p.venceHoje, ...p.venceNaSemana, ...p.venceu]).toEqual([]);
  });
});

describe("leitura do banco: confirmação só com as duas colunas", () => {
  const base: LinhaDaPublicacao = {
    id: "x",
    organization_id: ORG,
    numero_processo: NUM,
    data_disponibilizacao: "2026-10-10",
    tipo_comunicacao: null,
    sigla_tribunal: null,
    nome_orgao: null,
    texto: COM_PRAZO,
    descartada_em: null,
    prazo_vence_em: null,
    prazo_confirmado_em: null,
    prazo_observacao: null,
  };
  it("sem data final não há confirmação", () => {
    expect(daLinha(base).prazoConfirmado).toBeNull();
    expect(daLinha({ ...base, prazo_confirmado_em: "2026-10-20T15:00:00Z" }).prazoConfirmado).toBeNull();
    expect(daLinha({ ...base, prazo_vence_em: "2026-10-24" }).prazoConfirmado).toBeNull(); // data sem confirmação não é fato
  });
  it("com as duas, vira prazo confirmado", () => {
    const l = daLinha({ ...base, prazo_vence_em: "2026-10-24", prazo_confirmado_em: "2026-10-20T15:00:00Z", prazo_observacao: "ok" });
    expect(l.prazoConfirmado).toEqual({ venceEm: "2026-10-24", confirmadoEm: "2026-10-20T15:00:00Z", observacao: "ok" });
  });
  it("a leitura dos confirmados junta com a das recentes sem repetir, e começa no corte do vencido", () => {
    const recente = { ...base, id: "a" };
    const confirmada = { ...base, id: "b", prazo_vence_em: "2026-10-24", prazo_confirmado_em: "2026-10-20T15:00:00Z" };
    expect(semRepetir([recente, confirmada], [confirmada]).map((l) => l.id)).toEqual(["a", "b"]);
    expect(corteDoVencido(HOJE)).toBe("2026-08-22");
  });
});

describe("tela: o confirmado diz a data; o resto continua 'sugerido'", () => {
  afterEach(cleanup);

  const p = montaPauta(
    [
      pub("conf", "2026-10-10", "2026-10-24"),
      pub("sug", "2026-10-10"),
      { ...pub("longe", "2026-10-10", "2027-10-21"), prazoConfirmado: { venceEm: "2027-10-21", confirmadoEm: "2026-10-22T01:30:00Z", observacao: null } },
    ],
    [caso],
    HOJE,
  );
  const tela = (podeAgir: boolean) =>
    render(
      <PautaDeHoje
        hoje={p.hoje}
        venceHoje={p.venceHoje}
        venceNaSemana={p.venceNaSemana}
        venceDepois={p.venceDepois}
        venceu={p.venceu}
        chegouDesdeOntem={p.chegouDesdeOntem}
        pendentes={p.pendentes}
        cortada={false}
        podeAgir={podeAgir}
      />,
    );

  it("a linha confirmada mostra 'Vence em 24/10/2026' e não fala em sugestão", () => {
    tela(true);
    const grupo = screen.getByRole("group", { name: /Vence nos próximos 7 dias \(1\)/ });
    const li = within(grupo).getByTestId("linha-da-pauta");
    expect(within(li).getByTestId("prazo-confirmado").textContent).toMatch(/Vence em 24\/10\/2026.*confirmada pelo escritório/);
    expect(li.textContent!.split("Abrir publicação")[0]).not.toMatch(/sugerido/i);
    expect(within(li).getByRole("button", { name: "Corrigir a data" })).toBeTruthy();
  });

  it("a linha sem confirmação continua 'sugerido', com o trecho, e oferece confirmar", () => {
    tela(true);
    const grupo = screen.getByRole("group", { name: /Pendente de confirmação \(1\)/ });
    const li = within(grupo).getByTestId("linha-da-pauta");
    expect(within(li).getByText(/sugerido/i)).toBeTruthy();
    expect(li.querySelector("q")?.textContent).toBe(p.pendentes[0]!.prazosSugeridos[0]!.trecho);
    expect(within(li).queryByTestId("prazo-confirmado")).toBeNull();
    expect(within(li).getByRole("button", { name: "Confirmar prazo" })).toBeTruthy();
  });

  it("confirmado com o ano errado fica à vista, com 'Corrigir a data'; a confirmação mostra o dia de Brasília", () => {
    tela(true);
    const grupo = screen.getByRole("group", { name: /Confirmados que vencem depois \(1\)/ });
    const li = within(grupo).getByTestId("linha-da-pauta");
    // 01h30 UTC de 22/10 é 22h30 de 21/10 em Brasília.
    expect(within(li).getByTestId("prazo-confirmado").textContent).toMatch(/Vence em 21\/10\/2027.*em 21\/10\/2026/);
    expect(within(li).getByRole("button", { name: "Corrigir a data" })).toBeTruthy();
  });

  it("quem só vê não recebe o botão", () => {
    tela(false);
    expect(screen.queryByRole("button", { name: /Confirmar prazo|Corrigir a data/ })).toBeNull();
  });
});

describe("resumo da manhã leva os vencimentos confirmados", () => {
  it("vence hoje vai no assunto e no corpo, com a data e o aviso de que foi confirmada", () => {
    const p = montaPauta([pub("hoje", "2026-10-10", "2026-10-21"), pub("sug", "2026-10-10")], [caso], HOJE);
    const r = montaResumo(p, "Escritório X", "https://x/app/publicacoes");
    expect(r.subject).toContain("1 vence(m) hoje");
    expect(r.text).toContain(`Vence hoje (1):\n- ${NUM} · vence em 21/10/2026 (data confirmada pelo escritório)`);
    expect(r.text).toMatch(/Pendente de confirmação \(1\):[\s\S]*prazo sugerido/);
  });

  it("o que já venceu vai no assunto e no topo do corpo", () => {
    const p = montaPauta([pub("ontem", "2026-10-10", "2026-10-20")], [caso], HOJE);
    const r = montaResumo(p, "X", "u");
    expect(r.subject).toContain("1 venceu(ram)");
    expect(r.text.indexOf("Venceu nos últimos 60 dias (1):")).toBeLessThan(r.text.indexOf("Vence hoje"));
  });

  it.each([
    ["só vencimento na semana", "2026-10-24"],
    ["só confirmado que vence depois", "2027-10-21"],
  ])("dia com %s não é 'nada novo'", (_, venceEm) => {
    const p = montaPauta([pub("p", "2026-10-10", venceEm)], [caso], HOJE);
    expect(montaResumo(p, "X", "u").subject).not.toMatch(/nada novo/);
  });
});

/*
 * Mutações (21/10/2026, depois do segundo leitor), junto com os testes das rotas:
 * 26 de 26 acusadas. Pauta: hoje no grupo da semana; semana sem teto; sem o grupo
 * "vencem depois"; vencido só por 7 dias; ignorar a confirmação; sinal trocado;
 * sem ordenar a semana; sem ordenar o vencido; confirmado sem caso fora da pauta;
 * corte do vencido em hoje. Leitura: confirmação só com a data; junção repetindo.
 * Resumo: sem os vencimentos; sem "vence hoje" ou "venceu" no assunto; "nada novo"
 * com confirmado que vence depois. Tela: sem a linha confirmada; botão para quem só
 * vê; dia da confirmação em UTC; sem o grupo "vencem depois". Rotas: sem filtro de
 * organização; sem filtro de descartada; sem janela de data; sem checar papel; sem
 * gravar quem confirmou; descartar publicação com prazo confirmado.
 */
