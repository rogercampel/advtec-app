/**
 * Alarme de falha de coleta — critério 7 da spec 0006.
 *
 * ═══ O DEFEITO QUE ESTE MÓDULO EXISTE PARA EVITAR ═══
 *
 * Não é a coleta falhar. Falha aparece.
 *
 * É a coleta **parar de rodar** e ninguém notar. O escritório abre a tela, vê a
 * lista de ontem, e conclui que hoje não houve publicação. Silêncio parece
 * calmaria — e prazo perdido por silêncio é indistinguível de prazo que não
 * existia, até o dia em que não é mais.
 *
 * Por isso o alarme olha duas coisas diferentes:
 *
 *   1. a última tentativa DEU ERRADO   → falha visível
 *   2. não houve tentativa nenhuma     → silêncio, e este é o perigoso
 *
 * Um sistema que só avisa quando roda e falha não avisa nunca depois que para.
 *
 * ═══ POR QUE HÁ CARÊNCIA ═══
 *
 * Sem carência, o verificador de hora em hora avisa de hora em hora sobre a
 * mesma falha, e em dois dias o escritório filtra o alarme para a lixeira. O
 * alarme que ninguém lê é igual a alarme que não existe — e aí voltamos ao
 * problema original com uma camada a mais de falsa segurança.
 */

/** O estado que o verificador lê do banco. Uma linha de `djen_coletas`, mais o histórico. */
export type EstadoDaColeta = {
  /** Quando a coleta mais recente COMEÇOU. `null` = nunca rodou. */
  ultimaTentativaEm: Date | null;
  /** A coleta mais recente terminou bem? `null` = não houve tentativa. */
  ultimaFoiOk: boolean | null;
  /** Quando foi a última coleta que terminou BEM. `null` = nenhuma, nunca. */
  ultimoSucessoEm: Date | null;
  /** Quando o alarme desta situação já foi enviado. `null` = ainda não avisamos. */
  alarmeEnviadoEm: Date | null;
  /** O escritório pediu para ser monitorado? Sem OAB cadastrada, não há o que coletar. */
  temOabMonitorada: boolean;
};

export type Motivo =
  "nunca_coletou" | "ultima_coleta_falhou" | "coleta_parou" | "em_dia" | "nao_monitorado";

export type Decisao = {
  /** `true` = avise o escritório agora. */
  alarmar: boolean;
  motivo: Motivo;
  /**
   * Há quanto tempo o escritório está sem coleta boa, em horas.
   *
   * Vai na mensagem: "sem coleta há 26 horas" é acionável; "falha na coleta"
   * não diz se é de agora ou de anteontem.
   */
  horasSemSucesso: number | null;
};

/**
 * Quanto tempo de silêncio antes de considerar que a coleta parou.
 *
 * 26 horas, e não 24: a coleta é diária, e um atraso de rotina não pode virar
 * alarme. Duas horas de folga cobrem fila, manutenção e horário de verão sem
 * deixar um dia inteiro passar batido.
 */
export const HORAS_DE_SILENCIO_ATE_ALARMAR = 26;

/**
 * Carência entre dois alarmes da mesma situação.
 *
 * O critério 7 exige avisar em até 1 hora; ele não pede avisar TODA hora. O
 * verificador roda de hora em hora, então sem isto o escritório receberia 24
 * avisos por dia da mesma falha.
 */
export const HORAS_DE_CARENCIA = 12;

const HORA = 60 * 60 * 1000;

function horasEntre(depois: Date, antes: Date): number {
  return (depois.getTime() - antes.getTime()) / HORA;
}

export function avaliaColeta(
  estado: EstadoDaColeta,
  opcoes: { agora: Date; horasDeSilencio?: number; horasDeCarencia?: number },
): Decisao {
  const { agora } = opcoes;
  const silencio = opcoes.horasDeSilencio ?? HORAS_DE_SILENCIO_ATE_ALARMAR;
  const carencia = opcoes.horasDeCarencia ?? HORAS_DE_CARENCIA;

  const horasSemSucesso = estado.ultimoSucessoEm ? horasEntre(agora, estado.ultimoSucessoEm) : null;

  // Escritório sem OAB cadastrada não tem coleta para falhar. Alarmar aqui seria
  // ruído que ensina a ignorar o alarme de quem TEM.
  if (!estado.temOabMonitorada) {
    return { alarmar: false, motivo: "nao_monitorado", horasSemSucesso };
  }

  const naCarencia =
    estado.alarmeEnviadoEm != null && horasEntre(agora, estado.alarmeEnviadoEm) < carencia;

  const decide = (motivo: Motivo): Decisao => ({
    alarmar: !naCarencia,
    motivo,
    horasSemSucesso,
  });

  if (estado.ultimaTentativaEm === null) return decide("nunca_coletou");
  if (estado.ultimaFoiOk === false) return decide("ultima_coleta_falhou");

  // A última rodou e deu certo. Ainda assim pode ter sido há muito tempo — é o
  // caso do agendador que morreu: nada falha, e nada acontece.
  if (horasSemSucesso === null || horasSemSucesso >= silencio) return decide("coleta_parou");

  return { alarmar: false, motivo: "em_dia", horasSemSucesso };
}

/**
 * A frase que vai para o escritório.
 *
 * Separada da decisão porque texto muda com o canal (e-mail, WhatsApp, painel) e
 * a decisão não. E porque frase de alarme mal escrita vira alarme ignorado.
 */
export function mensagem(d: Decisao): string {
  const ha =
    d.horasSemSucesso == null
      ? "nunca"
      : d.horasSemSucesso < 48
        ? `há ${Math.floor(d.horasSemSucesso)} horas`
        : `há ${Math.floor(d.horasSemSucesso / 24)} dias`;

  switch (d.motivo) {
    case "nunca_coletou":
      return "A busca de publicações ainda não rodou nenhuma vez. Nenhuma intimação está sendo monitorada.";
    case "ultima_coleta_falhou":
      return `A última busca de publicações falhou. Sem coleta bem-sucedida ${ha}.`;
    case "coleta_parou":
      return `A busca de publicações parou de rodar. Sem coleta bem-sucedida ${ha}.`;
    case "nao_monitorado":
      return "Nenhuma OAB cadastrada para monitorar.";
    case "em_dia":
      return "Coleta em dia.";
  }
}
