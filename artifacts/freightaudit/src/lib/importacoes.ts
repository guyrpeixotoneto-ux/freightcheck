/**
 * O que cada estado de uma importação significa para quem opera — decidido
 * antes de desenhar, e testável sem desenhar.
 *
 * Os nomes internos do pipeline (`import_run_status`) são para quem depura.
 * Tudo que a tela de Importações diz sobre um estado sai daqui, e é aqui que
 * um estado novo do pipeline ganha nome, tom e comportamento — em vez de
 * vazar cru para a tela, que foi exatamente o defeito que este arquivo fecha.
 */

/**
 * Como cada estado se chama e o que ele significa, para quem opera.
 *
 * "Duplicata" era uma palavra só, e ela escondia três situações que pedem
 * reações diferentes: o mesmo arquivo de novo (não faça nada), o mesmo dado num
 * arquivo diferente (não faça nada, e saiba que o número não vai mudar) e uma
 * vigência que já existe (decida se é correção). O estado do run distingue as
 * duas primeiras; a terceira chega como recusa da aprovação.
 */
export const ESTADOS: Record<
  string,
  { rotulo: string; tom: "ok" | "erro" | "neutro" | "espera" }
> = {
  PROMOTED: { rotulo: "aprovada", tom: "ok" },
  PREVIEWED: { rotulo: "conferida", tom: "espera" },
  PENDING: { rotulo: "na fila", tom: "espera" },
  READING: { rotulo: "lendo", tom: "espera" },
  STAGED: { rotulo: "preparada", tom: "espera" },
  PROMOTING: { rotulo: "aprovando", tom: "espera" },
  FAILED: { rotulo: "falhou", tom: "erro" },
  ABORTED: { rotulo: "abortada", tom: "erro" },
  VALIDATION_ERROR: { rotulo: "dado não fecha", tom: "erro" },
  SKIPPED_DUPLICATE: { rotulo: "arquivo já recebido", tom: "neutro" },
  SKIPPED_DUPLICATE_DATA: { rotulo: "dados já registrados", tom: "neutro" },
};

export function estadoDaImportacao(status: string) {
  return ESTADOS[status] ?? { rotulo: status.toLowerCase(), tom: "espera" as const };
}

/**
 * A cara que o cartão de upload faz para um estado do run.
 *
 * `lendo` e `conferida` compõem a linha de detalhe na tela (o progresso, o
 * resumo de fatos e avisos); as demais mostram o motivo que o pipeline gravou
 * no run — `motivoPadrao` é o que se diz quando ele não gravou nenhum.
 */
export interface FaceDoCartao {
  face: "lendo" | "conferida" | "recusada" | "duplicata" | "aprovada";
  /** A frase em negrito do cartão. */
  titulo: string;
  /** O run ainda vai mudar sozinho: o cartão continua perguntando ao servidor. */
  emAndamento: boolean;
  /** O que dizer quando o run não gravou motivo. Nulo nas caras com resumo. */
  motivoPadrao: string | null;
}

/**
 * O cartão conhecia três estados — lendo, conferido, falhou — e todo o resto
 * caía no primeiro. Foi visto na tela: um run recusado por VALIDATION_ERROR
 * aparecia como "Lendo o arquivo…" com o nome interno do enum vazando embaixo
 * ("validation_error… nada entra sem sua aprovação"), o motivo que o pipeline
 * tinha gravado em `failure_reason` não aparecia em lugar nenhum, e o polling
 * não parava nunca — a lista de estados finais era outra lista, escrita à mão,
 * e também não o conhecia.
 *
 * Aqui cada estado terminal tem cara própria, e `emAndamento` é a única
 * autoridade sobre continuar perguntando. Um estado que este arquivo não
 * conhece é tratado como andamento — recusar seria pior que esperar —, mas
 * quem o mostra usa o rótulo de `estadoDaImportacao`, nunca o nome interno.
 */
export function faceDoCartao(status: string | undefined): FaceDoCartao {
  switch (status) {
    case "PREVIEWED":
      return {
        face: "conferida",
        titulo: "Conferido, ainda não importado.",
        emAndamento: false,
        motivoPadrao: null,
      };
    case "FAILED":
      return {
        face: "recusada",
        titulo: "Falhou ao ler o arquivo.",
        emAndamento: false,
        motivoPadrao: "Tente enviar o arquivo de novo.",
      };
    case "VALIDATION_ERROR":
      // Não é falha técnica: o arquivo foi lido inteiro, e o que o pipeline
      // recusou foi o dado. O motivo gravado diz qual conflito foi.
      return {
        face: "recusada",
        titulo: "O dado não fecha — nada foi importado.",
        emAndamento: false,
        motivoPadrao: "Corrija a origem e envie o arquivo de novo.",
      };
    case "ABORTED":
      return {
        face: "recusada",
        titulo: "Importação abortada.",
        emAndamento: false,
        motivoPadrao: "Envie o arquivo de novo para recomeçar.",
      };
    case "SKIPPED_DUPLICATE":
      return {
        face: "duplicata",
        titulo: "Arquivo já recebido.",
        emAndamento: false,
        motivoPadrao:
          "Este arquivo já tinha entrado, byte a byte. Nenhum dado foi importado de novo.",
      };
    case "SKIPPED_DUPLICATE_DATA":
      return {
        face: "duplicata",
        titulo: "Dados já registrados.",
        emAndamento: false,
        motivoPadrao:
          "O arquivo é outro, mas os dados normalizados desta vigência são iguais aos já registrados. Nada foi duplicado.",
      };
    case "PROMOTED":
      return {
        face: "aprovada",
        titulo: "Aprovada e importada.",
        emAndamento: false,
        motivoPadrao: "Os dados deste arquivo já estão no sistema.",
      };
    default:
      return {
        face: "lendo",
        titulo: "Lendo o arquivo…",
        emAndamento: true,
        motivoPadrao: null,
      };
  }
}

/**
 * O que se pode afirmar, com verdade, sobre o que o pipeline leu deste run.
 *
 * ---------------------------------------------------------------------------
 * Por que isto não é uma pergunta sobre o estado
 * ---------------------------------------------------------------------------
 * O cartão dizia "as células foram gravadas, mas nenhuma aba foi reconhecida
 * como fonte de fatos" sempre que `stagedFacts` era zero e o run não estava
 * mais esperando decisão. A frase é verdadeira para o arquivo que entrou e não
 * virou nada — que é o caso para o qual ela foi escrita, e um caso real: uma
 * planilha de trecho inteira passou despercebida com 440 células gravadas,
 * nenhum fato, nenhum erro e nenhum aviso.
 *
 * E ela é **falsa** para a duplicata. Um `SKIPPED_DUPLICATE` não gravou célula
 * nenhuma: o SHA-256 decide antes de abrir o arquivo, e o run nasce terminal
 * com os seis contadores em zero. A tela afirmava um trabalho que não houve, e
 * mandava o operador conferir as colunas de uma planilha que o leitor nunca
 * viu — enquanto a causa real (o arquivo já estava no sistema, e o leitor tinha
 * mudado desde então) não aparecia em lugar nenhum.
 *
 * ---------------------------------------------------------------------------
 * Por que a resposta vem dos contadores, e não de uma lista de estados
 * ---------------------------------------------------------------------------
 * "Foi lido" não é um estado do pipeline: é um fato sobre o run, e ele está
 * escrito nos contadores que o próprio pipeline gravou enquanto rodava. Uma
 * lista de estados que não podem dizer "li e não reconheci" teria de crescer a
 * cada estado novo, e o dia em que alguém esquecesse de somar o estado novo à
 * lista, a frase falsa voltaria. `rawCells === 0` é a mesma pergunta feita ao
 * lugar que não pode discordar dela.
 */
export type LeituraDoRun =
  /** Ainda não terminou — falar de fato agora seria alarme sobre trabalho em curso. */
  | { leitura: "EM_ANDAMENTO" }
  /** O arquivo não foi aberto porque já estava no sistema, byte a byte. */
  | { leitura: "NAO_ABERTO_DUPLICATA" }
  /** Nenhuma célula foi capturada, e o run terminou. A leitura não chegou a acontecer. */
  | { leitura: "NAO_LIDO" }
  /** Células gravadas, nenhuma aba reconhecida como fonte de fatos. */
  | { leitura: "LIDO_SEM_FATOS" }
  /** Leu e produziu fatos. */
  | { leitura: "LIDO" };

/** O pedaço de uma importação de que {@link leituraDoRun} depende. */
export interface ContadoresDoRun {
  status: string;
  rawCells: number;
  stagedFacts: number;
}

export function leituraDoRun(run: ContadoresDoRun): LeituraDoRun {
  if (faceDoCartao(run.status).emAndamento || run.status === "PREVIEWED") {
    return { leitura: "EM_ANDAMENTO" };
  }
  if (run.status === "SKIPPED_DUPLICATE") return { leitura: "NAO_ABERTO_DUPLICATA" };
  if (run.rawCells === 0) return { leitura: "NAO_LIDO" };
  if (run.stagedFacts === 0) return { leitura: "LIDO_SEM_FATOS" };
  return { leitura: "LIDO" };
}

/** O pedaço de uma importação de que a decisão de aprovar depende. */
export interface ContadoresDaAprovacao {
  status: string;
  /**
   * Apontamentos que impedem aprovar este arquivo — **não** o total de ERROs.
   *
   * Vem do servidor, que o calcula com o mesmo predicado do pipeline.
   */
  blockingErrors: number;
  /** Chaves que já se sabe que ficarão de fora se este arquivo for aprovado. */
  chavesEmQuarentena: number;
  /** Equipamentos novos que este arquivo criaria e quem aprova ainda não declarou. */
  identidadesNaoDeclaradas: number;
}

/** O que impede aprovar agora — `null` quando nada impede. */
export type ImpedimentoDaAprovacao =
  /** O run não está conferido: ainda lendo, recusado, duplicata ou já aprovado. */
  | "NAO_CONFERIDO"
  /** Há apontamento que segura o arquivo inteiro. Corrigir a origem e reenviar. */
  | "ERRO_BLOQUEANTE"
  /** Equipamento novo esperando a declaração de quem aprova. */
  | "IDENTIDADE_NAO_DECLARADA";

/**
 * O que este arquivo já se sabe que **não** vai trazer, dito antes do clique.
 *
 * Deixar o arquivo entrar cria uma dívida que o bloqueio não tinha: um registro
 * que ficou de fora não aparece como faltando — ele simplesmente não aparece,
 * indistinguível na tabela do cargo que a unidade não tem. Quem aprova precisa
 * saber disso enquanto ainda dá para escolher corrigir a origem, e não depois.
 */
export interface RessalvaDaQuarentena {
  /** A frase curta, na linha de detalhe do cartão. */
  frase: string;
  /** O que ela custa: a vigência nasce incompleta nestas chaves. */
  consequencia: string;
}

export interface DecisaoDaAprovacao {
  /** O botão pode ser apertado. */
  podeAprovar: boolean;
  /** Por que não, quando não. `null` quando nada impede. */
  impedimento: ImpedimentoDaAprovacao | null;
  /** O preço de aprovar assim mesmo. `null` quando a vigência entra inteira. */
  ressalva: RessalvaDaQuarentena | null;
}

/**
 * Se "Aprovar e importar" pode ser apertado — e o que dizer antes de apertar.
 *
 * ---------------------------------------------------------------------------
 * O defeito que esta função fecha
 * ---------------------------------------------------------------------------
 * O botão perguntava `errors > 0`, e `errors` é o total de apontamentos de
 * severidade ERRO daquele run. A pergunta e a resposta pareciam a mesma coisa
 * enquanto todo ERRO segurava o arquivo. Quando a duplicidade conflitante
 * deixou de segurá-lo — ela retira a chave e deixa o resto entrar —, as duas
 * deixaram de coincidir, e o efeito foi visto na tela: um QLP de Camaçari
 * conferido, com 11.760 fatos e 8 chaves em conflito, chegou com o botão
 * desabilitado e a frase "8 erros — corrija a origem antes de aprovar" em cima
 * dele. O pipeline considerava aquele arquivo aprovável; a tela dizia que não.
 * A única saída oferecida era corrigir uma planilha para destravar uma
 * importação que o servidor teria aceitado.
 *
 * ---------------------------------------------------------------------------
 * Por que a resposta não é uma conta de erros
 * ---------------------------------------------------------------------------
 * Aprovar depende de três coisas, e nenhuma delas é "quantos ERROs":
 *
 * 1. **o run estar conferido.** `PREVIEWED` não é um estado qualquer: é o
 *    desfecho que a pré-visualização grava quando nada impede promover. Um
 *    arquivo com impedimento nunca chega nele — vira `VALIDATION_ERROR`, com o
 *    motivo escrito. Quem diz "pode aprovar" é o pipeline, e o estado é a forma
 *    como ele já disse;
 * 2. **nenhum apontamento impeditivo.** É a mesma conta do pipeline
 *    (`impedePromocao`), que o servidor agora manda pronta em `blockingErrors`.
 *    Perguntar de novo é redundante por construção — e é exatamente por isso
 *    que vale perguntar: se um dia um estado novo puder chegar aqui com
 *    impedimento, o botão fecha sozinho em vez de descobrir pela recusa;
 * 3. **equipamento novo declarado.** A única decisão que esta tela exige, e não
 *    apenas leitura. Sem a declaração a API recusaria de todo jeito.
 *
 * O que **não** entra: a chave em quarentena. Ela não impede aprovar — ela
 * custa uma parte da vigência, e o preço se anuncia ({@link ressalva}), não se
 * cobra travando o botão.
 */
export function decisaoDaAprovacao(run: ContadoresDaAprovacao): DecisaoDaAprovacao {
  const impedimento: ImpedimentoDaAprovacao | null =
    faceDoCartao(run.status).face !== "conferida"
      ? "NAO_CONFERIDO"
      : run.blockingErrors > 0
        ? "ERRO_BLOQUEANTE"
        : run.identidadesNaoDeclaradas > 0
          ? "IDENTIDADE_NAO_DECLARADA"
          : null;

  return {
    podeAprovar: impedimento === null,
    impedimento,
    ressalva: ressalvaDaQuarentena(run.chavesEmQuarentena),
  };
}

/**
 * A ressalva da quarentena, em número e em consequência.
 *
 * A frase antiga — "8 erros — corrija a origem antes de aprovar" — errava as
 * duas metades: chamava de erro do arquivo o que é ausência de um registro, e
 * mandava corrigir antes de aprovar quando aprovar era permitido. Corrigir a
 * origem continua sendo o caminho para ter a vigência inteira; o que ele deixou
 * de ser é condição para importar os outros 11.760 fatos.
 */
export function ressalvaDaQuarentena(chaves: number): RessalvaDaQuarentena | null {
  if (chaves <= 0) return null;
  const um = chaves === 1;
  return {
    frase:
      `${chaves.toLocaleString("pt-BR")} ${um ? "registro ficará" : "registros ficarão"} ` +
      `de fora por conflito. O restante do arquivo pode ser importado.`,
    consequencia:
      `${um ? "Uma chave aparece" : `${chaves.toLocaleString("pt-BR")} chaves aparecem`} ` +
      `mais de uma vez na mesma vigência com valores que discordam, e o FreightCheck ` +
      `não escolhe entre eles: ${um ? "esse registro fica" : "esses registros ficam"} ` +
      `de fora inteiro${um ? "" : "s"}, com a evidência gravada nos apontamentos abaixo. ` +
      `Se aprovar assim, a vigência nasce incompleta ${um ? "nessa chave" : "nessas chaves"} — ` +
      `o que ficou de fora não aparece como faltando, apenas não aparece. ` +
      `Para tê-${um ? "lo" : "los"} na vigência, corrija a origem e importe de novo.`,
  };
}

/** O papel de uma importação dentro da história do seu arquivo. */
export type PapelNoArquivo = "RECEBIMENTO" | "TENTATIVA_RECUSADA" | "REPROCESSAMENTO";

/** O pedaço de uma importação de que a leitura do histórico depende. */
export interface RunNoHistorico {
  importRunId: string;
  contentSha256: string;
  status: string;
  startedAt: string;
  reprocessOfRunId: string | null;
  reprocessReason: string | null;
}

export interface HistoricoDoArquivo<T extends RunNoHistorico> {
  /** O papel **deste** run. */
  papel: PapelNoArquivo;
  /** A primeira leitura deste conteúdo — o run mais antigo do arquivo. */
  recebimento: T | null;
  /** O run que este relê, quando ele é um reprocessamento. */
  releu: T | null;
  /**
   * O run que um reprocessamento pedido agora releria.
   *
   * A regra é a do servidor (`reprocessImportRun`), repetida aqui pelo mesmo
   * motivo de {@link RunNoHistorico} existir: a caixa de reprocessamento
   * precisa dizer **antes** o que a releitura vai fazer, e ela só consegue se
   * souber contra quem a releitura será comparada. Repetir a regra é o preço;
   * a alternativa era a tela avisar sobre a troca de tipo comparando com o
   * cartão errado — o da tentativa recusada, que é de onde o operador clica —,
   * e ficar calada exatamente no caso em que o aviso importa.
   *
   * `null` quando o arquivo só tem tentativas recusadas: não há leitura para
   * reler, e o servidor recusa com essa frase.
   */
  alvoDaReleitura: T | null;
  /** Todas as leituras deste arquivo, da mais antiga para a mais nova. */
  leituras: T[];
}

/**
 * A história de um arquivo, lida da lista que a tela já tem.
 *
 * Três runs sobre o mesmo `content_sha256` são três coisas diferentes, e a
 * lista os mostrava como três cartões parecidos em ordem cronológica inversa —
 * sem dizer que falavam do mesmo arquivo, quanto mais qual era qual. Foi
 * exatamente isso que fez uma tentativa recusada parecer *a* importação do
 * arquivo: o cartão dela trazia a data do **recebimento original**
 * (`source_file.received_at`, que é do arquivo e não da tentativa), então quem
 * lia via um envio de ontem com tudo zerado, e concluía que o arquivo de ontem
 * não tinha produzido nada.
 *
 * O agrupamento é pelo sha porque é ele que define "o mesmo arquivo" no resto
 * do produto — a mesma autoridade que decide a duplicata decide a família.
 */
export function historicoDoArquivo<T extends RunNoHistorico>(
  todos: readonly T[],
  run: T,
): HistoricoDoArquivo<T> {
  const leituras = todos
    .filter((r) => r.contentSha256 === run.contentSha256)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));

  /*
    Quem diz "isto é uma releitura" é a **razão**, e não o ponteiro.

    O ponteiro pode ficar nulo: excluir a leitura relida é o passo final de
    corrigir um arquivo que entrou sob o tipo errado, e aí a releitura é
    reancorada — ou, se ela era a ponta da corrente, fica sem âncora. Ler o
    papel do ponteiro faria essa releitura voltar a aparecer como um
    recebimento comum, que é o histórico embaralhado de novo.
  */
  const papel: PapelNoArquivo =
    run.reprocessReason !== null
      ? "REPROCESSAMENTO"
      : run.status === "SKIPPED_DUPLICATE"
        ? "TENTATIVA_RECUSADA"
        : "RECEBIMENTO";

  return {
    papel,
    /*
      O recebimento é o run mais antigo que **abriu** o arquivo — nunca uma
      tentativa recusada, que por definição não abriu nada, e nunca uma
      releitura, que só existe porque já havia um antes dela. Numa lista
      recortada em que o original não aparece, é `null`, e a tela diz que não
      consegue apontá-lo em vez de apontar o vizinho errado.
    */
    recebimento:
      leituras.find(
        (r) => r.status !== "SKIPPED_DUPLICATE" && r.reprocessReason === null,
      ) ?? null,
    releu:
      run.reprocessOfRunId === null
        ? null
        : (todos.find((r) => r.importRunId === run.reprocessOfRunId) ?? null),
    /*
      A mais recente que abriu o arquivo — a mesma conta do servidor. Uma
      tentativa recusada nunca é alvo: ela não leu nada, e reler o que não foi
      lido é a frase que a coluna `reprocess_of_run_id` não pode afirmar.
    */
    alvoDaReleitura:
      leituras.filter((r) => r.status !== "SKIPPED_DUPLICATE").at(-1) ?? null,
    leituras,
  };
}
