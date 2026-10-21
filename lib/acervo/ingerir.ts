/**
 * Ingestão de peça do acervo: PDF entra, vira pedaços com embedding, e a busca
 * acha. Ticket 0002.E1.
 *
 * ═══ O QUE ESTE MÓDULO NÃO FAZ ═══
 *
 * Não embeda por conta própria e não cria tabela. A base já tem as duas coisas,
 * e reescrever seria divergir do contrato:
 *
 *   - `lib/agent-engine/edge/llm/embed.ts` — pin de contrato do CRM:
 *     `text-embedding-3-small`, **1536 dimensões**, asseridas a cada chamada.
 *     Medido em 18/08/2026 contra a API real: 200, modelo confere, 1536 confere.
 *   - `ai_chunks` (`embedding vector(1536)`, `content_hash`), `ai_knowledge_sources`,
 *     `ai_knowledge_versions`, e a busca `retrieve_top_k_chunks(org, versao,
 *     vetor, k, limiar)` — já filtrando por organização.
 *
 * Divergir de modelo ou dimensão **quebra o recall em silêncio**: os vetores
 * deixam de ser comparáveis e a busca simplesmente devolve pior, sem erro.
 *
 * ═══ O QUE ELE GARANTE ═══
 *
 * 1. O mesmo arquivo, entrando duas vezes, não duplica pedaço (critério 2).
 * 2. Todo pedaço carrega a página de origem (base do critério 4).
 * 3. Documento que falha na extração **aparece na lista de falhas**, não some
 *    (critério 3 — a etapa E2 mostra a lista; aqui a falha já é contada).
 * 4. O lote respeita o teto de gasto e PARA com aviso ao atingir (critério 7,
 *    ticket 0002.E2). A checagem vem ANTES de embedar — que é onde o dinheiro
 *    sai — e o que ficou de fora aparece em `naoProcessados`, não some.
 */

import { fatia, hashDoTexto, type Pagina, type Pedaco } from "./fatiar";
import { metadadoDaPeca, SEM_METADADO, type Correcao, type MetadadoDaPeca } from "./metadado";
import { processoDaPeca } from "./processo-da-peca";

export type Documento = {
  /** identificador estável do arquivo no acervo do escritório. */
  id: string;
  nome: string;
  /** o que o advogado corrigiu no tipo de peça e na área (0002.E3). Vence a extração. */
  correcao?: Correcao;
};

/** Extrair é injetável: teste não precisa de PDF, produção usa o leitor real. */
export type Extrator = (doc: Documento) => Promise<Pagina[]>;

/** Embedar é injetável pelo mesmo motivo, e em produção é o `embed.ts` da base. */
export type Embedador = (textos: string[]) => Promise<number[][]>;

export const DIMENSAO_CONTRATO = 1536;

export type LinhaChunk = {
  organization_id: string;
  knowledge_source_id: string;
  kb_version_id: string;
  position: number;
  content: string;
  content_hash: string;
  token_count: number;
  embedding: number[];
  metadata: { documento: string; nome: string; pagina_inicial: number; pagina_final: number } & MetadadoDaPeca;
};

export type ClienteAcervo = {
  /** hashes que a organização já tem naquela versão — a base da deduplicação. */
  hashesExistentes(organizationId: string, kbVersionId: string): Promise<Set<string>>;
  /**
   * Primeira posição livre em `(knowledge_source_id, kb_version_id)`.
   *
   * Vem do BANCO, e não de um contador local, porque `ai_chunks` tem
   * `unique (knowledge_source_id, kb_version_id, position)` e a numeração
   * precisa continuar de onde a última ingestão parou. Contador que começa em
   * zero a cada chamada colide na segunda leva — e a colisão derruba o insert
   * inteiro, não a linha.
   */
  proximaPosicao(sourceId: string, kbVersionId: string): Promise<number>;
  inserirChunks(linhas: LinhaChunk[]): Promise<{ inseridos: number }>;
};

export type Falha = { documento: string; motivo: string };

export type ResultadoIngestao = {
  documentos: number;
  pedacosVistos: number;
  pedacosNovos: number;
  pedacosJaExistentes: number;
  falhas: Falha[];
  /** Estimativa do que foi mandado embedar, em tokens — a régua do teto. */
  gastoEstimadoTokens: number;
  /** O lote parou no teto. O que ficou de fora está em `naoProcessados`. */
  paradoPorTeto: boolean;
  /**
   * Ids dos documentos que o teto deixou de fora — visíveis, não engolidos.
   * NÃO são falhas: nada há de errado com eles, e reprocessar com teto maior
   * (ou noutro dia) resolve. Falha e corte de orçamento pedem ações opostas.
   */
  naoProcessados: string[];
};

/** ~4 caracteres por token é a aproximação usada para orçamento, não para cobrança. */
export function estimaTokens(texto: string): number {
  return Math.max(1, Math.ceil(texto.length / 4));
}

export function paraLinha(
  p: Pedaco,
  vetor: number[],
  doc: Documento,
  organizationId: string,
  sourceId: string,
  kbVersionId: string,
  /**
   * Posição ABSOLUTA na fonte, e não a posição do pedaço dentro do documento.
   *
   * `ai_chunks` tem `unique (knowledge_source_id, kb_version_id, position)`, e
   * `Pedaco.posicao` reinicia em 0 a cada documento: dois PDFs na mesma leva
   * davam `0,1,2` e `0,1,2` e o INSERT INTEIRO morria. O `conversations.ts` da
   * própria base usa `totalChunkInserts + i` exatamente por isso — eu não fui
   * olhar antes de escrever.
   */
  posicaoAbsoluta: number,
  /**
   * tipo de peça e área do DOCUMENTO, repetidos em cada pedaço dele (0002.E3), e
   * o número do processo da peça (0004.E3) — `null` quando não deu para amarrar.
   */
  metadado: MetadadoDaPeca & { processo?: string | null } = SEM_METADADO,
): LinhaChunk {
  if (vetor.length !== DIMENSAO_CONTRATO) {
    // Falha alto e cedo. Vetor de dimensão errada entra no banco sem erro e
    // degrada a busca em silêncio — o pior defeito possível aqui.
    throw new Error(
      `dimensão do embedding é ${vetor.length}, e o contrato do CRM é ${DIMENSAO_CONTRATO}`,
    );
  }
  return {
    organization_id: organizationId,
    knowledge_source_id: sourceId,
    kb_version_id: kbVersionId,
    position: posicaoAbsoluta,
    content: p.texto,
    content_hash: p.hash,
    token_count: estimaTokens(p.texto),
    embedding: vetor,
    metadata: {
      documento: doc.id,
      nome: doc.nome,
      pagina_inicial: p.paginaInicial,
      pagina_final: p.paginaFinal,
      ...metadado,
    },
  };
}

export async function ingere(
  organizationId: string,
  sourceId: string,
  kbVersionId: string,
  documentos: Documento[],
  deps: { extrair: Extrator; embedar: Embedador; cliente: ClienteAcervo },
  opcoes: {
    /**
     * Teto de gasto do LOTE, em tokens estimados (`estimaTokens`). Ausente =
     * sem teto, o comportamento da E1. O teto de verdade, por cliente, mora em
     * `ai_budgets` — este é o freio do lote, que para ANTES de estourar lá.
     */
    tetoDeTokens?: number;
  } = {},
): Promise<ResultadoIngestao> {
  const teto = opcoes.tetoDeTokens ?? Infinity;
  const jaTem = await deps.cliente.hashesExistentes(organizationId, kbVersionId);
  const falhas: Falha[] = [];
  const linhas: LinhaChunk[] = [];
  const naoProcessados: string[] = [];
  let vistos = 0;
  let repetidos = 0;
  let gastoEstimado = 0;
  let paradoPorTeto = false;

  // hashes deste lote, para o mesmo trecho repetido dentro da mesma leva não
  // entrar duas vezes — peça modelo costuma repetir parágrafo inteiro.
  const noLote = new Set<string>();

  // Continua de onde a última ingestão parou. Ver `ClienteAcervo.proximaPosicao`.
  let posicao = await deps.cliente.proximaPosicao(sourceId, kbVersionId);

  for (const doc of documentos) {
    // Depois que o teto parou o lote, os restantes nem são abertos: abrir e
    // fatiar sem poder embedar seria trabalho jogado fora — e a lista de
    // não-processados é o aviso que o critério 7 exige.
    if (paradoPorTeto) {
      naoProcessados.push(doc.id);
      continue;
    }

    let paginas: Pagina[];
    try {
      paginas = await deps.extrair(doc);
    } catch (e) {
      falhas.push({ documento: doc.id, motivo: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const comTexto = paginas.filter((p) => p.texto.trim().length > 0);
    if (comTexto.length === 0) {
      // PDF escaneado sem camada de texto. Recusa explícita, com o motivo —
      // OCR está fora de escopo na spec 0002, e silêncio aqui viraria acervo
      // com buraco que ninguém vê.
      falhas.push({ documento: doc.id, motivo: "sem camada de texto (possível PDF escaneado)" });
      continue;
    }

    // Correção fora do contrato é falha DESTE documento, com o motivo — não
    // derruba o lote e não entra no índice como se fosse palavra do advogado.
    let metadado: MetadadoDaPeca & { processo: string | null };
    try {
      metadado = { ...metadadoDaPeca(comTexto, doc.correcao), processo: processoDaPeca(comTexto)?.numero ?? null };
    } catch (e) {
      falhas.push({ documento: doc.id, motivo: `metadado: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    const pedacos = fatia(comTexto);
    vistos += pedacos.length;

    const novos = pedacos.filter((p) => {
      if (jaTem.has(p.hash) || noLote.has(p.hash)) {
        repetidos += 1;
        return false;
      }
      noLote.add(p.hash);
      return true;
    });
    if (novos.length === 0) continue;

    // O freio vem ANTES de embedar, porque é no embedar que o dinheiro sai.
    // Checar depois seria "paga primeiro, pergunta depois" — e o gasto medido
    // ficaria ACIMA do teto que o escritório configurou.
    const custoDoc = novos.reduce((soma, p) => soma + estimaTokens(p.texto), 0);
    if (gastoEstimado + custoDoc > teto) {
      paradoPorTeto = true;
      naoProcessados.push(doc.id);
      continue;
    }
    gastoEstimado += custoDoc;

    let vetores: number[][];
    try {
      vetores = await deps.embedar(novos.map((p) => p.texto));
    } catch (e) {
      // Os hashes deste documento SAEM do lote. Se ficassem, um documento
      // seguinte com o mesmo conteúdo (peça modelo copiada) cairia em
      // `novos.length === 0`, sairia pelo `continue` sem falha registrada e
      // seria contado como "já existente" — conteúdo não indexado, e ninguém
      // fica sabendo. Achado por revisor sem contexto, 19/08/2026.
      for (const p of novos) noLote.delete(p.hash);
      falhas.push({ documento: doc.id, motivo: `embedding: ${e instanceof Error ? e.message : String(e)}` });
      continue;
    }

    if (vetores.length !== novos.length) {
      for (const p of novos) noLote.delete(p.hash);
      falhas.push({
        documento: doc.id,
        motivo: `embedding devolveu ${vetores.length} vetores para ${novos.length} pedaços`,
      });
      continue;
    }

    novos.forEach((p, i) => {
      linhas.push(paraLinha(p, vetores[i]!, doc, organizationId, sourceId, kbVersionId, posicao++, metadado));
    });
  }

  // O insert também falha. Sem isto, erro de banco derruba o lote inteiro E
  // leva junto a lista de falhas — o contrário do critério 3, que existe para
  // a falha aparecer.
  let inseridos = 0;
  if (linhas.length) {
    try {
      ({ inseridos } = await deps.cliente.inserirChunks(linhas));
    } catch (e) {
      falhas.push({ documento: "(gravação)", motivo: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    documentos: documentos.length,
    pedacosVistos: vistos,
    pedacosNovos: inseridos,
    pedacosJaExistentes: repetidos,
    falhas,
    gastoEstimadoTokens: gastoEstimado,
    paradoPorTeto,
    naoProcessados,
  };
}

export { hashDoTexto };
