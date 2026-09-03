/**
 * O que a aba Chamados de Importações diz sobre cada arquivo recebido.
 *
 * Irmão de `lib/importacoes.ts`, e separado dele de propósito: aquele traduz
 * `import_run_status`, a máquina de estados da planilha de vigência, e este
 * traduz `ticket_import_status`, que é curto porque chamado não vira fato
 * canônico nem vigência — não há staging para conferir nem promoção para
 * aprovar. Juntar as duas tabelas num mapa só faria a tela oferecer "aprovar"
 * para um envio que nunca teve o que aprovar.
 *
 * As contas moram aqui, e não no componente, pelo motivo de sempre nesta casa:
 * são strings e números entrando e saindo, e é o que permite prendê-las em
 * teste sem montar tela nenhuma.
 */

export type { TicketImportSummary } from "@workspace/comparison";
import type { TicketImportSummary } from "@workspace/comparison";
import type { TicketField } from "@workspace/ingest";

/** Quanta coisa uma exclusão tira — a mesma conta que a API faz antes e depois. */
export interface TicketImportDeletionCounts {
  tickets: number;
  ticketChanges: number;
  duplicateAttempts: number;
  storedFile: number;
}

export interface TicketImportDeletionPlan {
  ticketImportId: string;
  filename: string;
  status: string;
  /** Por que não dá para excluir agora — null quando dá. */
  refusal: string | null;
  removes: TicketImportDeletionCounts;
}

export interface TicketImportDeletionResult extends TicketImportDeletionPlan {
  removed: TicketImportDeletionCounts;
}

/** A resposta de `GET /ticket-imports` — todos os envios, o mais novo primeiro. */
export type ListaDeEnvios = TicketImportSummary[];

/**
 * Os nomes dos campos, para a tela explicar o mapeamento sem jargão.
 *
 * Sai daqui, e não de dentro de um dos dois componentes, porque as duas telas
 * que mostram o mapeamento — a lista de recebidos, em Importações, e o painel
 * de procedência, em Alterações — respondem à mesma pergunta: de que coluna do
 * arquivo saiu este campo. Dois dicionários divergindo diriam nomes diferentes
 * para a mesma coluna, na mesma sessão.
 *
 * `Record<TicketField, string>`, e não `Record<string, string>`: com a chave
 * solta, metade dos campos não tinha nome aqui e a tela mostrava `unidadeRaw` e
 * `vigenciaLabel` crus no meio de uma lista em português — o jargão interno
 * vazando exatamente no painel que existe para não haver jargão. O tipo põe o
 * compilador nessa guarda: um campo novo no leitor não compila sem ganhar nome.
 */
export const NOMES_DE_CAMPO: Record<TicketField, string> = {
  externalId: "número do chamado",
  openedAt: "abertura",
  closedAt: "fechamento",
  statusRaw: "status",
  changeKind: "operação",
  vigenciaLabel: "vigência de abertura",
  parameterLabel: "parâmetro",
  entityDescription: "descrição do equipamento",
  entityLabel: "placa",
  entityType: "tipo de equipamento",
  valueBeforeRaw: "valor anterior",
  requestedValueRaw: "valor pedido",
  appliedValueRaw: "valor aplicado",
  requestedBy: "solicitante",
  unidadeRaw: "unidade",
  segmentoRaw: "segmento",
  operadorRaw: "operador",
  aprovadorRaw: "aprovador",
  slaRaw: "SLA",
  categoriaRaw: "categoria",
  prazoPrevisto: "prazo previsto",
  alteradoEmFonte: "alterado em (origem)",
  subject: "assunto",
};

/**
 * O nome de um campo do mapeamento, que chega da API como string solta.
 *
 * O dicionário acima é fechado sobre `TicketField` de propósito — é o que
 * obriga um campo novo do leitor a ganhar nome antes de compilar —, e o que a
 * API devolve é `Record<string, …>`. Esta função é a fronteira entre os dois: um
 * campo que ela não conhece sai como veio, que é melhor do que sumir da lista.
 */
export function nomeDoCampo(campo: string): string {
  return NOMES_DE_CAMPO[campo as TicketField] ?? campo;
}

/**
 * Como cada estado do envio se chama e de que cor ele é.
 *
 * Os tons são os mesmos de `lib/importacoes.ts` porque as duas abas do módulo
 * mostram a mesma coisa — arquivos recebidos —, e um "falhou" vermelho de um
 * lado com um "falhou" âmbar do outro ensinaria que as duas listas não são
 * comparáveis. Duplicata é neutra nas duas: é o sistema tendo feito o trabalho
 * dele, e pintá-la de vermelho manda procurar culpa onde não há.
 */
export const ESTADOS_DO_ENVIO: Record<
  string,
  { rotulo: string; tom: "ok" | "erro" | "neutro" | "espera" }
> = {
  PENDING: { rotulo: "na fila", tom: "espera" },
  READING: { rotulo: "lendo", tom: "espera" },
  READ: { rotulo: "lido", tom: "ok" },
  FAILED: { rotulo: "falhou", tom: "erro" },
  SKIPPED_DUPLICATE: { rotulo: "arquivo já recebido", tom: "neutro" },
};

export function estadoDoEnvio(status: string) {
  return (
    ESTADOS_DO_ENVIO[status] ?? {
      rotulo: status.toLowerCase(),
      tom: "espera" as const,
    }
  );
}

/**
 * O envio ainda vai mudar sozinho — a lista continua perguntando ao servidor.
 *
 * Um estado desconhecido conta como andamento, e não como terminal: a leitura
 * roda fora da requisição que recebeu o arquivo, e dar o envio por encerrado
 * cedo demais deixa quem acabou de enviar olhando para contadores em zero até
 * apertar F5. Esperar por um estado que não existe custa uma consulta a mais;
 * encerrar antes da hora custa a confiança na tela.
 */
export function emAndamento(status: string): boolean {
  const estado = ESTADOS_DO_ENVIO[status];
  if (!estado) return true;
  return status === "PENDING" || status === "READING";
}

/**
 * A conta que a leitura precisa fechar: toda linha do arquivo teve um destino.
 *
 * `rowCount` são as linhas de dados que o arquivo trazia; `ticketCount` as que
 * viraram chamado; `ignoredRowCount` as que ficaram de fora por não terem
 * número de chamado. A soma das duas últimas tem que dar a primeira — quando
 * não dá, alguma linha sumiu sem ser contada, e é isso que `fecha` denuncia.
 *
 * Um envio que ainda não terminou de ser lido não tem conta para fechar: os
 * contadores estão em zero porque nada foi gravado ainda, e chamar isso de
 * divergência seria acusar o relógio.
 */
export function contaDaLeitura(envio: {
  status: string;
  rowCount: number;
  ticketCount: number;
  ignoredRowCount: number;
}): { aferivel: boolean; fecha: boolean; diferenca: number } {
  const aferivel = !emAndamento(envio.status) && envio.status !== "FAILED";
  const diferenca =
    envio.rowCount - (envio.ticketCount + envio.ignoredRowCount);
  return { aferivel, fecha: aferivel && diferenca === 0, diferenca };
}

/**
 * De onde saiu a série do envio, em português.
 *
 * A série é a partição dentro da qual dois envios se comparam — a unidade —, e
 * a confiança nela não é a mesma em todos os casos: lida das linhas do arquivo
 * ela sobrevive a alguém renomear o arquivo; lida do nome, não. A tela mostra a
 * diferença porque é ela que separa "reenvio da mesma fila" de "a fila de outra
 * unidade", e esses dois casos se parecem na lista — dois arquivos do mesmo
 * dia, com contagens diferentes.
 *
 * `null` quer dizer que não há o que dizer: o envio não declarou série, e o
 * motor o trata como uma série própria em vez de compará-lo às cegas.
 */
export function origemDaSerie(envio: {
  serie: string | null;
  serieOrigem: string | null;
}): { serie: string; origem: string; confiavel: boolean } | null {
  if (!envio.serie) return null;
  switch (envio.serieOrigem) {
    case "ARQUIVO":
      return {
        serie: envio.serie,
        origem: "lida da coluna Unidade das linhas",
        confiavel: true,
      };
    case "NOME_DO_ARQUIVO":
      return {
        serie: envio.serie,
        origem: "lida do nome do arquivo",
        confiavel: false,
      };
    case "MISTA":
      return {
        serie: envio.serie,
        origem: "as linhas nomeiam mais de uma unidade",
        confiavel: false,
      };
    default:
      return { serie: envio.serie, origem: "origem não registrada", confiavel: false };
  }
}

/**
 * O que dizer sobre um envio que não produziu chamado nenhum.
 *
 * São três situações diferentes com o mesmo `ticketCount: 0`, e a reação certa
 * a cada uma é outra: a que ainda está sendo lida (espere), a que falhou (o
 * motivo está gravado, corrija e reenvie) e a que foi lida inteira sem
 * reconhecer um chamado sequer — o caso silencioso, em que o arquivo entrou, a
 * leitura terminou e nada saiu. `null` quando o envio produziu chamados.
 */
export function leituraSemChamados(envio: {
  status: string;
  rowCount: number;
  ticketCount: number;
}): "EM_LEITURA" | "FALHOU" | "DUPLICATA" | "LIDO_SEM_CHAMADOS" | null {
  if (envio.ticketCount > 0) return null;
  if (emAndamento(envio.status)) return "EM_LEITURA";
  if (envio.status === "FAILED") return "FALHOU";
  if (envio.status === "SKIPPED_DUPLICATE") return "DUPLICATA";
  return "LIDO_SEM_CHAMADOS";
}

/**
 * O histórico do mesmo conteúdo: os outros envios que trazem este SHA-256.
 *
 * É o que transforma "arquivo já recebido" numa frase verificável — o cartão
 * recusado pode apontar para o envio que de fato entrou, em vez de mandar quem
 * lê procurar na lista qual dos arquivos com o mesmo nome foi o bom.
 */
export function mesmoConteudo(
  todos: TicketImportSummary[],
  envio: TicketImportSummary,
): TicketImportSummary[] {
  return todos.filter(
    (outro) =>
      outro.id !== envio.id && outro.contentSha256 === envio.contentSha256,
  );
}

/** O envio que de fato leu este conteúdo — a quem a duplicata aponta. */
export function envioQueLeu(
  todos: TicketImportSummary[],
  envio: TicketImportSummary,
): TicketImportSummary | null {
  return (
    mesmoConteudo(todos, envio).find((outro) => outro.status === "READ") ?? null
  );
}
