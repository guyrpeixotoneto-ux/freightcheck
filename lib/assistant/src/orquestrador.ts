/**
 * A camada que decide — e a que recusa.
 *
 * Cinco etapas, nesta ordem: ler a pergunta, resolver o que ela nomeia, montar
 * o plano, executar, validar. Nenhuma delas é feita por modelo. É deliberado:
 * a escolha da fonte é a decisão mais consequente do assistente — errar aqui
 * produz uma resposta correta sobre o assunto errado — e uma decisão dessas
 * precisa ser reproduzível, testável sem rede e explicável a quem discordar.
 *
 * **O plano é uma função da intenção, não uma lista de tudo.** O modelo não
 * recebe trinta ferramentas para escolher: recebe o resultado das que a
 * intenção pediu. Perguntar "o que é IPVA?" não dispara consulta de impacto, e
 * é por isso que a resposta deixou de começar com o resumo de uma vigência que
 * ninguém pediu.
 *
 * **Quatro formas de não saber, e elas não se confundem.** "Não encontrei" não
 * é "não existe no FreightCheck", que não é "o Freightech tem o conceito e o
 * export não traz o parâmetro", que não é "há dado e não dá para precificar".
 * `Lacuna` carrega qual das quatro é, e a resposta é obrigada a dizê-la.
 */

import type { Database } from "@workspace/db";
import { buscarTrechos, type TrechoRelevante } from "./corpus";
import {
  buscarNoBookDetalhado,
  documentoDoBloco,
  LIMIAR_PARA_DEFINIR,
  type TrechoDoBookRanqueado,
} from "./indice-book";
import {
  compararIntervalo,
  filaDeInvestigacao,
  anexoDoBook,
  coberturaDoBook,
  composicaoDaFrota,
  resultadoDaFrota,
  porQueOResultadoMudou,
  placaCitada,
  listarVigencias,
  movimentoDoParametro,
  panoramaDoContexto,
  rankingDeImpacto,
  regraDoBook,
  resolverContexto,
  resumoDaVigencia,
  semParaPrecificar,
  serieDoParametro,
  veiculosAfetados,
  veiculosDoGrupo,
  type Anexo,
  type ContextoResolvido,
  type Evidencia,
} from "./ferramentas";
import {
  balancoDasImportacoes,
  buscarNasCelulas,
  estadoDaCuradoria,
  historicoDaSemantica,
  importacoesRecentes,
} from "./governanca";
import { reconhecerAssunto, vocabularioDoProduto, type AssuntoReconhecido } from "./assunto";
import {
  conferirCorrespondencia,
  desambiguacaoDe,
  explicarFalta,
  identidadeDoTrecho,
  placasNomeadas,
  tokensDeConteudo,
  unidadesNomeadas,
} from "./correspondencia";
import { planejar, type Necessidade, type Plano as PlanoDeInvestigacao } from "./plano";
import {
  INTENCOES_COM_PARAMETRO,
  INTENCOES_COM_RECORTE,
  INTENCOES_QUE_HERDAM_ASSUNTO,
  interpretar,
  temPronomeAnaforico,
  mesParaNumero,
  type Intencao,
  type Leitura,
  type PeriodoPedido,
} from "./interpretacao";
import { normalizar, termos } from "./normalizar";
import { resolverParametro, type Alvo, type Resolucao } from "./parametros";
import { listContexts, listPeriods, type ContextInfo, type SeriesContext } from "@workspace/comparison";
import { rotuloDoPeriodo } from "./formato";
import { descer, type Fundo, type Lado, type PassoDaDescida } from "./aprofundar";
import {
  calcular,
  evidenciaDoCalculo,
  grandezasApuradas,
  operacaoDaFrase,
  operandosDoFio,
  type ResultadoDoCalculo,
} from "./calculo";
import {
  afirmacoesSemLastro,
  autorizacoesDoTexto,
  type Autorizacoes,
} from "./lastro";
import type { EstadoDaConversa } from "./conversa";
import {
  comoSePediu,
  explicarPeriodoInexistente,
  resolverRecorteDoTurno,
  type OrigemDoRecorte,
  type RecorteDoTurno,
  type ResolucaoDePeriodo,
} from "./recorte";

// ── As quatro formas de não saber ───────────────────────────────────────────

/**
 * As necessidades cuja pergunta é **por quê** — e não **quanto**.
 *
 * É esta lista que decide se a orquestração desce até a causa. Ela é curta de
 * propósito: descer custa três consultas, e a maioria das perguntas deste
 * produto se responde num nível só. Uma necessidade a mais aqui é uma
 * afirmação sobre o domínio ("esta pergunta pede causa"), não um ajuste de
 * cobertura.
 */
/**
 * Os focos que significam "a conversa já está dentro de uma investigação".
 *
 * Um grupo ou um veículo em foco quer dizer que a descida já aconteceu e que a
 * pergunta seguinte, se não nomear outro assunto, continua dentro dela. O
 * recorte inteiro **não** entra: estar falando da vigência é o estado normal, e
 * tratá-lo como investigação aberta faria toda pergunta descer.
 */
const DENTRO_DA_DESCIDA: ReadonlySet<string> = new Set(["GRUPO", "VEICULO"]);

/** As necessidades que operam sobre o já apurado — elas nunca disparam a descida. */
const SEM_DESCIDA: ReadonlySet<string> = new Set(["CALCULO", "SUSTENTACAO"]);

const CAUSAIS: ReadonlySet<string> = new Set([
  "PROCEDENCIA",
  "RANKING_PERDA",
  "RANKING_GANHO",
  "ATENCAO",
]);

export type TipoDeLacuna =
  /** A busca não trouxe nada — pode existir e não termos achado. */
  | "NAO_ENCONTREI"
  /** Nem o catálogo nem o dicionário conhecem este assunto. */
  | "NAO_EXISTE_NO_PRODUTO"
  /** O Freightech publica o conceito; este export não traz a coluna. */
  | "CONCEITO_SEM_DADO"
  /** Há dado, e o impacto não é apurável com a semântica atual. */
  | "DADO_SEM_PRECO";

export interface Lacuna {
  tipo: TipoDeLacuna;
  /** A frase que a resposta deve dizer. Escrita aqui, nunca pelo modelo. */
  explicacao: string;
}

// ── O resultado da orquestração ─────────────────────────────────────────────

export interface Etapa {
  nome: string;
  /** O que a tela mostra enquanto isto roda. */
  rotulo: string;
  /**
   * Milissegundos desde o início da orquestração.
   *
   * É o que transforma a lista de etapas em diagnóstico: sem ele dá para ver
   * **o que** rodou e não **onde o tempo foi**, que é a pergunta que alguém faz
   * olhando para uma resposta lenta.
   */
  ms: number;
}

export interface Plano {
  /**
   * A necessidade principal — o nome da resposta.
   *
   * Continua sendo uma `Intencao` para não quebrar o estado da conversa, a
   * tela e as sugestões; o que mudou é de onde ela vem. Antes era o primeiro
   * padrão que casava, e nada mais era executado. Agora é a primeira de
   * `necessidades`, e todas são.
   */
  intencao: Intencao;
  /** Tudo o que esta pergunta precisa descobrir. */
  necessidades: Necessidade[];
  /** Por que esta intenção — para o painel técnico. */
  porque: string;
  /**
   * O assunto que o produto reconheceu, ou `null` quando a pergunta não nomeia
   * nenhum. É o que a conversa guarda — nunca o resíduo da frase.
   */
  assunto: string | null;
  /** Como ele foi reconhecido: por gaveta, ou só por vocabulário. */
  comoReconheceu: AssuntoReconhecido["como"] | null;
  /** O que foi herdado da conversa anterior. */
  herdado: string[];
  alvo: Alvo | null;
  resolucao: Resolucao | null;
  contexto: ContextoResolvido | null;
  /**
   * De onde veio o recorte deste turno — e nunca implícito.
   *
   * `PADRAO` é o estado em que ninguém escolheu: a resposta descreve o primeiro
   * contexto que o banco devolve, que é o de vigência mais recente. Dizê-lo é a
   * diferença entre escolher por padrão, que é aceitável, e escolher em
   * silêncio, que é o que este produto não faz em nenhuma outra tela.
   */
  origemDoRecorte: OrigemDoRecorte;
  /** A unidade que a pergunta nomeou, quando o produto a reconheceu. */
  unidadeCitada: string | null;
  periodo: string | null;
  intervalo: { de: string | null; ate: string | null } | null;
  /**
   * O período pedido não existe neste recorte.
   *
   * Quando verdadeiro, nenhuma consulta de dado roda: qualquer número que
   * saísse aqui descreveria outra vigência que não a pedida.
   */
  periodoImpossivel: { pedido: string; disponiveis: string[] } | null;
}

export interface Dossie {
  pergunta: string;
  leitura: Leitura;
  plano: Plano;
  trechos: TrechoRelevante[];
  /**
   * O conteúdo do Book que responde esta pergunta.
   *
   * Ficam separados dos `trechos` porque são coisas diferentes: `trechos` é o
   * conhecimento **sobre** o produto — o índice dos blocos, o catálogo do
   * Freightech, os artigos aprovados neste repositório —, e `documentos` é o
   * que está escrito **dentro** do Book, transcrito do arquivo que a operação
   * anexou. Um diz "existe um bloco chamado QLP ADM e ele trata de estrutura
   * administrativa"; o outro diz o que a regra determina. A resposta que
   * confunde os dois descreve o índice quando lhe perguntaram a regra — que era
   * exatamente o que acontecia.
   */
  documentos: TrechoDoBookRanqueado[];
  evidencias: Evidencia[];
  /**
   * Os arquivos que vão junto para o modelo ler.
   *
   * Ficam fora de `evidencias` porque não são resultado de consulta: uma
   * evidência traz números que a validação confere, e um anexo traz um
   * documento que ela não tem como conferir. Confundir os dois faria a trava
   * de lastro parecer cobrir o que não cobre.
   */
  anexos: Anexo[];
  lacunas: Lacuna[];
  etapas: Etapa[];
  /** Quando a pergunta casa duas gavetas e o assistente precisa perguntar. */
  desambiguacao: { termo: string; opcoes: string[] } | null;
  /**
   * A descida que **reagiu ao dado** — e não a largura que foi decidida antes.
   *
   * Cada passo aqui teve um argumento que não existia antes de o passo anterior
   * voltar: o código do parâmetro veio do grupo que mais pesou, a placa veio das
   * linhas daquele grupo, a célula veio daquela placa. É a diferença entre
   * investigar e consultar muito, medida em vez de afirmada — ver
   * `encadeamento.ts` e `aprofundar.ts`.
   *
   * Vazio é o estado normal: a maioria das perguntas se responde sem descer, e
   * descer sempre seria a mesma largura pré-planejada com outro nome.
   */
  encadeamentos: PassoDaDescida[];
  /**
   * O `scopeHash` que a tela mandou neste turno — `null` quando ela não mandou.
   *
   * Guardado no estado para o turno seguinte poder distinguir "a tela continua
   * onde estava" de "a pessoa acabou de trocar o seletor". Ver a precedência em
   * `resolverRecorteDoTurno`.
   */
  telaScopeHash: string | null;
  /**
   * O que a recuperação viu antes de decidir — para explicar uma resposta ruim
   * **depois** que ela aconteceu.
   *
   * Sem isto, uma resposta que trouxe o documento errado só se investiga
   * reproduzindo a pergunta à mão e instrumentando o código. Os números aqui
   * respondem as três perguntas que se faz nessa hora: quantos candidatos
   * havia, quantos passaram do limiar, e com que folga o primeiro passou.
   */
  diagnostico: {
    book: { candidatos: number; selecionados: number; melhorPontuacao: number };
    /** O tempo total da orquestração, sem a chamada ao modelo. */
    ms: number;
  };
}

// ── Resolução de período ────────────────────────────────────────────────────

/**
 * "agosto" + as vigências do contexto → "2026-08-01".
 *
 * **Três desfechos, não dois.** Ver `ResolucaoDePeriodo`: o que se pediu e não
 * existe não pode voltar pelo mesmo caminho do que não se pediu, porque o
 * chamador trata a ausência de período como "use a vigência corrente" — e foi
 * assim que uma pergunta sobre fevereiro de 1998 recebeu números de agosto de
 * 2026 sem uma linha dizendo que o período tinha sido trocado.
 */
async function resolverPeriodo(
  db: Database,
  ctx: ContextoResolvido,
  pedido: PeriodoPedido | null,
): Promise<ResolucaoDePeriodo> {
  if (!pedido) return { tipo: "SEM_PEDIDO" };
  const periodos = await listPeriods(db, ctx.contexto); // mais recente primeiro
  const rotulos = periodos.map((p) => rotuloDoPeriodo(p.effective_date));
  const inexistente = (): ResolucaoDePeriodo => ({
    tipo: "INEXISTENTE",
    pedido: comoSePediu(pedido),
    disponiveis: rotulos,
  });

  if (periodos.length === 0) return inexistente();

  if (pedido.relativo === "ULTIMA") return { tipo: "RESOLVIDO", data: periodos[0].effective_date };
  if (pedido.relativo === "ANTERIOR") {
    const anterior = periodos[1]?.effective_date;
    return anterior ? { tipo: "RESOLVIDO", data: anterior } : inexistente();
  }
  if (pedido.relativo === "PRIMEIRA") {
    return { tipo: "RESOLVIDO", data: periodos[periodos.length - 1]!.effective_date };
  }

  /*
    Um ano sozinho — "e em 1998?" — é um pedido de período tanto quanto um mês.
    Tratá-lo como "sem pedido" era o segundo caminho pelo qual a vigência
    trocava em silêncio.
  */
  if (!pedido.mes) {
    if (!pedido.ano) return { tipo: "SEM_PEDIDO" };
    const doAno = periodos.filter((p) => Number(p.effective_date.split("-")[0]) === pedido.ano);
    return doAno[0]
      ? { tipo: "RESOLVIDO", data: doAno[0].effective_date }
      : inexistente();
  }
  const numero = mesParaNumero(pedido.mes);
  if (!numero) return inexistente();

  /*
    Sem ano declarado, o mais recente daquele mês.

    "E julho?" numa base que tem julho/2025 e julho/2026 quer dizer o julho mais
    próximo do que se estava olhando, e o mais recente é o palpite que erra
    menos. O período resolvido volta no recorte da evidência, então quem lê vê
    qual julho respondeu — a escolha aparece, não fica implícita.
  */
  const candidatos = periodos.filter((p) => {
    const [ano, mes] = p.effective_date.split("-");
    return Number(mes) === numero && (!pedido.ano || Number(ano) === pedido.ano);
  });
  return candidatos[0]
    ? { tipo: "RESOLVIDO", data: candidatos[0].effective_date }
    : inexistente();
}

// ── Detecção de lacuna conceitual ───────────────────────────────────────────

/**
 * A pergunta pede um recorte do assunto que o export não traz?
 *
 * "Preço de combustível" resolve a gaveta Combustível — mas "preço" não aparece
 * em nenhuma das colunas dela, que são consumo, capacidade e vida útil. Essa
 * distância entre o que se perguntou e o que existe é exatamente a resposta
 * certa, e sem detectá-la o assistente responderia sobre consumo a quem
 * perguntou de preço, sem avisar da troca.
 */
/**
 * As palavras que pedem dinheiro, e não uma coluna com aquele nome.
 *
 * Nenhuma coluna do export se chama "preço" ou "custo" — nem a de IPVA, que é
 * dinheiro puro. Compará-las com o vocabulário da gaveta como se fossem
 * qualificadores comuns dizia a quem perguntou "quanto custa o IPVA?" que
 * nenhuma coluna trata de "custa", o que é literalmente verdadeiro e
 * completamente enganoso. Para estas palavras a pergunta certa é outra: **esta
 * gaveta tem alguma coluna monetária?** É essa distinção que separa o IPVA, que
 * tem, do Combustível, que não tem — e é o Combustível que precisa da lacuna.
 */
const PALAVRAS_DE_VALOR = new Set([
  "preco", "precos", "custo", "custos", "custa", "custam", "tarifa", "tarifas",
  /*
    "Valor" faltava, e a falta aparecia na frase.

    Ela é a palavra mais comum com que se pede dinheiro neste produto — "qual o
    valor de X?" — e, fora desta lista, era tratada como um qualificador comum:
    a lacuna saía dizendo que nenhuma coluna da gaveta trata de "valor", numa
    gaveta que tem coluna monetária. É o mesmo defeito que a lista inteira
    existe para evitar, numa palavra que escapou dela.
  */
  "valor", "valores",
]);

function lacunaDoQualificador(termoPerguntado: string, alvo: Alvo): Lacuna | null {
  const palavrasDoAlvo = new Set(termos(alvo.parametro));
  /*
    O qualificador é o que **nomeia** — e data, ano, número e verbo de pedido
    não nomeiam coluna nenhuma.

    Sem este filtro, `Qual o valor de Manutenção cavalo em agosto/2026?` produzia
    a frase "o arquivo que o FreightCheck recebe hoje traz … — não traz valor,
    **2026**", e mais adiante "daria para fechar a conta completa de valor,
    **2026** por equipamento": o assistente afirmando, com todas as letras, que
    falta uma coluna chamada 2026. A lacuna era montada com o resíduo da frase,
    e todo número escrito na pergunta virava coluna ausente inventada.

    `tokensDeConteudo` é a autoridade única dessa conta, e é a mesma que o portão
    de correspondência usa — as duas perguntam a mesma coisa ("o que, nesta
    frase, nomeia alguma coisa?") e não podem responder diferente.
  */
  const qualificadores = tokensDeConteudo(termoPerguntado).filter(
    (p) => !palavrasDoAlvo.has(p) && p.length > 3,
  );
  if (qualificadores.length === 0) return null;

  const vocabulario = new Set(
    alvo.atributos.flatMap((a) => a.termos.flatMap((t) => t.split(" "))),
  );
  const naoCasadas = qualificadores.filter((q) => {
    for (const v of vocabulario) if (v === q || v.startsWith(q) || q.startsWith(v)) return false;
    return true;
  });

  const temMonetario = alvo.atributos.some((a) => a.monetario === true);
  const ausentes = naoCasadas.filter((q) => !(PALAVRAS_DE_VALOR.has(q) && temMonetario));
  if (ausentes.length === 0) return null;

  const colunas = alvo.atributos.map((a) => a.rotulo).join(", ");
  /*
    A lacuna é dita como quem opera a diria — e diz o que ela destravaria.

    A frase anterior era "nenhuma coluna dela trata de preço", que é verdadeira
    e fala a língua do banco. Pior: escrita assim, ela virava o assunto da
    resposta inteira, porque é a única frase categórica do dossiê. Aqui ela diz
    três coisas na ordem que interessa a quem perguntou — o que existe, o que
    falta, e o que passaria a ser possível com o que falta.
  */
  return {
    tipo: "CONCEITO_SEM_DADO",
    explicacao:
      `Sobre ${alvo.parametro}, o arquivo de equipamentos que o FreightCheck recebe hoje traz ` +
      `${colunas} — não traz ${ausentes.join(", ")}. Esse dado existe no Freightech, noutra ` +
      `tela, num arquivo que ainda não foi importado; com ele, daria para fechar a conta ` +
      `completa de ${ausentes.join(", ")} por equipamento.`,
  };
}

// ── Orquestração ────────────────────────────────────────────────────────────

export interface OpcoesDeOrquestracao {
  /** O recorte que a tela mandou junto. */
  recorte?: {
    scopeHash?: string;
    channel?: string | null;
    period?: string;
    /** A auditoria de onde a pergunta saiu — ver `ContextoDaFerramenta`. */
    operacao?: string | null;
  };
  /** O estado da conversa, para herdar em perguntas de continuação. */
  estado?: EstadoDaConversa | null;
  /**
   * Chamado a cada etapa, no instante em que ela começa.
   *
   * Existe para a tela poder dizer o que está acontecendo **enquanto**
   * acontece. Sem isto, a única honestidade possível era um "consultando…"
   * genérico: as etapas só chegavam junto com a resposta, quando já não
   * serviam para nada. A alternativa que a tela usava antes — animar uma lista
   * fixa por tempo — anunciava "calculando impacto" numa pergunta conceitual
   * que nunca calcula impacto, e num produto que existe para não exibir o que
   * não pode sustentar, inventar o próprio progresso é a última coisa que se
   * deveria fazer.
   */
  aoAvancar?: (etapa: Etapa) => void;
}

/**
 * De que unidade e canal esta conversa fala — a expressão, escrita uma vez.
 *
 * Os dois caminhos precisam da mesma resposta, e enquanto cada um a montava por
 * conta própria eles já divergiam em silêncio: a orquestração herda o
 * `scopeHash` da conversa quando a tela não manda um, e o contexto que
 * `responder` entrega ao agente não herdava. O efeito seria uma segunda
 * pergunta respondida sobre outra unidade que a primeira — a classe de erro que
 * a fronteira de isolamento existe para tornar impossível.
 *
 * Exportada porque quem garante as comparações precisa saber sobre qual recorte
 * garanti-las, e essa decisão não pode ser tomada duas vezes.
 */
export function recorteDaConversa(
  pedido: OpcoesDeOrquestracao["recorte"],
  estado: EstadoDaConversa | null | undefined,
): Partial<SeriesContext> {
  return {
    ...(pedido?.scopeHash ? { scopeHash: pedido.scopeHash } : {}),
    ...(pedido?.channel !== undefined ? { channel: pedido.channel } : {}),
    ...(estado?.scopeHash && !pedido?.scopeHash ? { scopeHash: estado.scopeHash } : {}),
  };
}

/**
 * O mesmo, **com a pergunta** — que é a fonte que faltava.
 *
 * `recorteDaConversa` conhecia a tela e o fio; a pergunta, não. Uma frase que
 * nomeia a unidade é a declaração mais recente de quem está perguntando, e ela
 * precisa vencer as duas. Esta função é o dono único dessa decisão, e os dois
 * caminhos — a orquestração e a pré-condição das comparações — passam por ela.
 *
 * Faz **uma** ida ao banco (`listContexts`) e devolve o contexto já resolvido,
 * para o chamador não repetir a consulta nem repetir a regra.
 */
export async function contextoDoTurno(
  db: Database,
  pergunta: string,
  opcoes: { recorte?: OpcoesDeOrquestracao["recorte"]; estado?: EstadoDaConversa | null },
): Promise<{ resolvido: ContextoResolvido | null; recorte: RecorteDoTurno }> {
  const contextos: ContextInfo[] = await listContexts(db, {
    operacao: opcoes.recorte?.operacao,
  }).catch(() => []);
  const recorte = resolverRecorteDoTurno({
    pergunta,
    pedidoDaTela: opcoes.recorte,
    estado: opcoes.estado ?? null,
    contextos,
  });
  const resolvido = await resolverContexto(db, {
    ...recorte.pedido,
    ...(opcoes.recorte?.operacao ? { operacao: opcoes.recorte.operacao } : {}),
  }).catch(() => null);
  return { resolvido, recorte };
}

/**
 * Da pergunta ao dossiê — sem escrever uma frase.
 *
 * O que sai daqui é material fechado: os trechos que sustentam o conceito, as
 * evidências que sustentam os números, e as lacunas que a resposta é obrigada a
 * declarar. Quem redige — modelo ou código — trabalha só sobre isto.
 */
export async function orquestrar(
  db: Database,
  pergunta: string,
  opcoes: OpcoesDeOrquestracao = {},
): Promise<Dossie> {
  const etapas: Etapa[] = [];
  const comecou = Date.now();
  const marcar = (nome: string, rotulo: string) => {
    const etapa = { nome, rotulo, ms: Date.now() - comecou };
    etapas.push(etapa);
    opcoes.aoAvancar?.(etapa);
  };

  // ---- 1. entendimento -----------------------------------------------------
  marcar("interpretar", "Analisando sua pergunta");
  const leitura = interpretar(pergunta);
  const estado = opcoes.estado ?? null;

  // ---- 2. herança da conversa ---------------------------------------------
  const herdado: string[] = [];
  let intencao = leitura.intencao;
  /*
    O candidato é uma hipótese até `reconhecerAssunto` a confirmar.

    A variável chamava-se `termoDoParametro`, e o nome era metade do defeito:
    todo o resto desta função a lia como um parâmetro estabelecido, quando ela
    era o resíduo da frase. Aqui ela é o palpite, e `assunto` — logo abaixo — é
    o que o produto reconheceu.
  */
  let candidato = leitura.entidades.assuntoCandidato;
  let periodoPedido = leitura.entidades.periodo;
  let intervaloPedido = leitura.entidades.intervalo;

  /*
    O assunto do fio vale para toda pergunta que não traga o seu.

    Isto roda **fora** do bloco de continuação de propósito, e é a correção do
    defeito que a sequência de aceite expôs. "Quanto mudou em agosto?" logo
    depois de uma resposta sobre combustível tem verbo, tem período e não
    parece continuação nenhuma — mas não diz *o quê*, e num fio aberto o quê é
    o combustível. Antes disso ela caía no agregado da vigência: uma resposta
    verdadeira sobre outro assunto, que é o pior defeito que este assistente
    pode ter.

    O pronome anafórico é o caso explícito da mesma regra: "isso está previsto
    no Book?" declara, com todas as letras, que o assunto está na conversa.
  */
  /*
    O equipamento do fio vale para a pergunta que não nomeia um.

    Sem isto, "qual teve maior perda?" logo depois de "e somente cavalos"
    responde sobre a frota inteira — e a única pista da troca é o número mudar.
    A leitura é reescrita aqui, e não no estado, porque tudo o que vem depois
    (o plano, as ferramentas, o executor do agente) lê `leitura.entidades`.
  */
  const equipamentoDoFio =
    leitura.entidades.equipamento ?? (estado?.equipamento ?? null);
  if (!leitura.entidades.equipamento && equipamentoDoFio) {
    leitura.entidades.equipamento = equipamentoDoFio;
    herdado.push(`equipamento ${equipamentoDoFio.toLowerCase()}`);
  }

  const pronome = temPronomeAnaforico(pergunta);
  if (estado && !candidato && estado.assunto) {
    const pedeAssunto = INTENCOES_QUE_HERDAM_ASSUNTO.has(intencao) || pronome;
    if (pedeAssunto) {
      candidato = estado.assunto;
      herdado.push("assunto");
    }
  }

  /*
    E a vigência do fio vale pelo mesmo motivo.

    Sem isto, "qual foi o impacto?" no meio de uma conversa sobre julho
    respondia sobre a vigência mais recente — trocava o período em silêncio,
    que é exatamente o que este produto não faz em nenhuma outra tela.
  */
  /*
    Comparação fica de fora: ela tem lógica própria de pontas, logo abaixo.

    Herdar a vigência aqui dava as duas pontas iguais — "Compare." respondia
    "julho/2026 → julho/2026, 0 comparações", que é a forma mais silenciosa de
    não responder: um resultado válido, com zero em tudo, sem nada dizendo que
    a pergunta não foi entendida.
  */
  if (
    estado &&
    !periodoPedido &&
    !intervaloPedido &&
    intencao !== "COMPARACAO" &&
    INTENCOES_COM_RECORTE.has(intencao) &&
    (estado.periodo || estado.intervalo)
  ) {
    if (estado.periodo) periodoPedido = estado.periodo;
    else intervaloPedido = estado.intervalo;
    herdado.push("vigência da conversa");
  }

  /*
    Não entender a forma da pergunta não é motivo para largar a conversa.

    `DESCONHECIDA` quer dizer "nenhum padrão casou" — uma afirmação sobre a
    nossa lista de padrões, não sobre a pergunta. Dentro de um fio aberto, a
    leitura que erra menos é que ela continua o fio: "qual teve maior
    impacto?", logo depois de um resumo de agosto, é sobre agosto. Antes, a
    herança da intenção dependia de `ehContinuacao`, que mede a **forma** da
    frase — e essa frase tem verbo, objeto e quatro palavras, então não parecia
    continuação nenhuma. O turno virava um beco: sem intenção, sem consulta,
    sem resposta.

    Isto não é um padrão a mais; é uma condição a menos. A primeira pergunta de
    uma conversa continua sem ter o que herdar, e segue caindo em
    `DESCONHECIDA`.
  */
  if (estado?.intencao && intencao === "DESCONHECIDA") {
    intencao = estado.intencao;
    herdado.push("intenção");
  }

  if (leitura.continuacao && estado) {
    /*
      A herança do assunto já aconteceu acima, para toda intenção que o admite.
      Repeti-la aqui só produzia um segundo rótulo — "parâmetro" — para a mesma
      coisa que o primeiro caminho chama de "assunto", e um teste da bateria
      passou a falhar contra o rótulo que o outro caminho escreve. Um fato, um
      nome.
    */
    /*
      Comparação em continuação: o período que a frase traz é uma das pontas, e
      a outra vem da pergunta anterior. "Compare os dois" sem período nenhum
      compara o período atual com o anterior do estado.
    */
    if (intencao === "COMPARACAO" && !intervaloPedido) {
      const outraPonta = estado.periodo ?? null;
      if (periodoPedido && outraPonta) {
        intervaloPedido = { de: { mes: outraPonta.mes, ano: outraPonta.ano }, ate: periodoPedido };
        periodoPedido = null;
        herdado.push("período anterior como ponta");
      } else if (estado.intervalo) {
        intervaloPedido = estado.intervalo;
        herdado.push("intervalo");
      }
    }
    /*
      "E julho?" depois de "quanto mudou o IPVA desde dezembro?" não pede a
      série de novo — pede o IPVA **em julho**.

      Sem esta troca, a continuação herdava a intenção EVOLUCAO, que trabalha
      sobre intervalo, e o mês que a pessoa acabou de escrever era lido e
      ignorado: a resposta repetia a série inteira, idêntica à anterior, e nada
      na tela denunciava que julho não tinha entrado em nada.
    */
    if (periodoPedido && !intervaloPedido && (intencao === "EVOLUCAO" || intencao === "COMPARACAO")) {
      intencao = candidato ? "VALOR" : "MOVIMENTO";
      herdado.push("assunto, com o período trocado");
    }

    if (!periodoPedido && !intervaloPedido && estado.periodo) {
      periodoPedido = estado.periodo;
      herdado.push("período");
    }
    if (!periodoPedido && !intervaloPedido && estado.intervalo) {
      intervaloPedido = estado.intervalo;
      herdado.push("intervalo");
    }
  }

  // ---- 3. reconhecimento do assunto ---------------------------------------
  /*
    O candidato vira assunto só se o produto o reconhecer.

    Antes, qualquer resíduo virava termo e ia direto ao resolvedor; quando ele
    não achava gaveta, o portão `alvoPerdido` desligava todas as consultas e a
    pergunta terminava sem evidência. Agora existe um terceiro desfecho — **não
    havia assunto** —, e ele é o mais comum numa conversa: "qual foi o impacto
    dessas alterações?" não nomeia gaveta nenhuma, e a resposta certa é o
    movimento do recorte.

    Equipamento não entra: ele é dimensão, e deixá-lo entrar fazia "e nos
    cavalos?" resolver para a gaveta "Manutenção cavalo".
  */
  let assunto: AssuntoReconhecido | null = null;
  let resolucao: Resolucao | null = null;
  let alvo: Alvo | null = null;
  let desambiguacao: Dossie["desambiguacao"] = null;

  if (candidato && INTENCOES_COM_PARAMETRO.has(intencao)) {
    marcar("reconhecerAssunto", "Identificando o assunto");
    assunto = await reconhecerAssunto(db, candidato, {
      ...(leitura.entidades.equipamento ? { equipamento: leitura.entidades.equipamento } : {}),
    });
    resolucao = assunto?.resolucao ?? null;
    alvo = assunto?.alvo ?? null;
    if (resolucao?.ambiguo && resolucao.alvos.length > 1) {
      desambiguacao = {
        termo: assunto!.termo,
        opcoes: resolucao.alvos.slice(0, 4).map((a) => a.parametro),
      };
    }
  }

  /** O assunto reconhecido, para quem precisa do termo — Book, regra, lacuna. */
  const termoDoAssunto = assunto?.termo ?? null;

  // ---- 4. o Book, antes do plano -------------------------------------------
  /*
    A busca vem antes de decidir o que fazer, e essa inversão é o coração da
    fase.

    Ela roda para toda pergunta que não seja saudação, sobre a frase inteira, e
    custa quatro milissegundos sobre um índice em memória. O que muda é o uso:
    o plano passa a **ver** o que a recuperação trouxe. Uma pergunta como "com
    que frequência a auditoria QLP ADM acontece?" sempre recuperou a seção
    certa; o que faltava era alguém olhar para isso antes de concluir que a
    pergunta não tinha classificação.
  */
  const achadosDoBook: TrechoDoBookRanqueado[] = [];
  let diagnosticoDoBook = { candidatos: 0, selecionados: 0, melhorPontuacao: 0 };
  if (leitura.intencao !== "SAUDACAO") {
    marcar("book", "Procurando no Book do Operador");
    const busca = await buscarNoBookDetalhado(db, pergunta, {
      limite: 6,
      blocoPreferido: estado?.blocoDoBook ?? null,
      termosExtras: [
        ...(termoDoAssunto ? [termoDoAssunto] : []),
        ...(alvo ? [alvo.parametro] : []),
      ],
    }).catch(() => ({ selecionados: [], candidatos: 0, melhorPontuacao: 0 }));
    achadosDoBook.push(...busca.selecionados);
    diagnosticoDoBook = {
      candidatos: busca.candidatos,
      selecionados: busca.selecionados.length,
      melhorPontuacao: Number(busca.melhorPontuacao.toFixed(3)),
    };
  }

  // ---- 5. o plano de investigação ------------------------------------------
  if (leitura.intencao !== "SAUDACAO") marcar("planejar", "Decidindo o que consultar");
  const investigacao = planejar({
    pergunta,
    leitura: { ...leitura, intencao },
    assunto: termoDoAssunto,
    temConversa: Boolean(estado?.intencao),
    herdada: estado?.intencao ?? null,
    temRegraDoBook: (achadosDoBook[0]?.pontos ?? 0) >= LIMIAR_PARA_DEFINIR,
  });
  intencao = investigacao.principal;

  // ---- 6. contexto ---------------------------------------------------------
  const precisaRecorte = investigacao.necessidades.some((n) => INTENCOES_COM_RECORTE.has(n));
  let contexto: ContextoResolvido | null = null;

  const querContexto =
    precisaRecorte ||
    investigacao.necessidades.includes("PANORAMA") ||
    investigacao.necessidades.includes("CATALOGO_DE_CONTEXTO");
  /*
    O recorte é resolvido para **toda** pergunta que não seja saudação, e não só
    para as que consultam número.

    Duas razões. A primeira é que a origem precisa ser conhecida mesmo quando
    ninguém vai consultar: uma pergunta conceitual feita depois de "só Camaçari"
    continua sendo sobre Camaçari, e o fio da conversa não pode perder a unidade
    porque o turno do meio era de conceito. A segunda é o custo: `listContexts`
    é uma consulta e o produto já a fazia aqui na maioria dos turnos.
  */
  let recorteDoTurno: RecorteDoTurno = {
    pedido: {},
    origem: "PADRAO",
    citada: null,
  };
  if (leitura.intencao !== "SAUDACAO") {
    marcar("resolverContexto", "Resolvendo unidade e canal");
    const doTurno = await contextoDoTurno(db, pergunta, {
      ...(opcoes.recorte ? { recorte: opcoes.recorte } : {}),
      estado,
    });
    recorteDoTurno = doTurno.recorte;
    if (querContexto) contexto = doTurno.resolvido;
    /*
      Quando a pergunta nomeou a unidade, o contexto é resolvido mesmo que o
      plano não peça recorte — é o que grava a unidade no estado da conversa e
      faz "só Camaçari" valer para o turno seguinte.
    */
    else if (doTurno.recorte.origem === "PERGUNTA") contexto = doTurno.resolvido;
  }
  if (recorteDoTurno.citada) herdado.push(`unidade ${recorteDoTurno.citada.nome} (da pergunta)`);

  /*
    ---- a garantia das comparações **não mora mais aqui** ---------------------

    Ela subiu para `responder`, e a razão é que este arquivo é o caminho do
    planejador — que esta migração existe para aposentar. Enquanto a garantia
    estivesse aqui, o agente a recebia de graça, porque `responder` roda a
    orquestração antes de investigar; no dia em que o planejador saísse, o
    agente perderia a pré-condição junto, sem que nada no diff falasse de
    comparações.

    Não é hipótese: a auditoria de integridade chama as ferramentas direto,
    sem passar por aqui, e viveu esse futuro — dezessete casos aprovados sobre
    conteúdo vazio, num banco cujo estado derivado nunca havia sido
    materializado. Foi o defeito de amanhã acontecendo hoje, num instrumento.

    Ver `garantirRecorte` em `resposta.ts`: um dono só, acima dos dois caminhos.
  */
  const resolucaoDoPeriodo: ResolucaoDePeriodo = contexto
    ? await resolverPeriodo(db, contexto, periodoPedido)
    : { tipo: "SEM_PEDIDO" };
  const periodo = resolucaoDoPeriodo.tipo === "RESOLVIDO" ? resolucaoDoPeriodo.data : null;

  /*
    O período pedido e inexistente desliga as consultas — não as redireciona.

    É a mesma decisão de `alvoPerdido` um pouco mais abaixo, pelo mesmo motivo:
    um número certo sob o período errado é pior que nenhum número, porque parece
    uma resposta. A lacuna, escrita em `recorte.ts`, é o que sai no lugar.
  */
  const periodoImpossivel =
    resolucaoDoPeriodo.tipo === "INEXISTENTE"
      ? { pedido: resolucaoDoPeriodo.pedido, disponiveis: resolucaoDoPeriodo.disponiveis }
      : null;

  /*
    As duas pontas de um intervalo seguem a mesma regra, e basta uma falhar.
    "De fevereiro de 1998 a agosto" não é meio respondível: a ponta que não
    existe torna a diferença entre elas indefinida.
  */
  let intervalo: { de: string | null; ate: string | null } | null = null;
  let intervaloImpossivel: { pedido: string; disponiveis: string[] } | null = null;
  if (contexto && intervaloPedido) {
    const de = await resolverPeriodo(db, contexto, intervaloPedido.de);
    const ate = intervaloPedido.ate
      ? await resolverPeriodo(db, contexto, intervaloPedido.ate)
      : ({ tipo: "SEM_PEDIDO" } as ResolucaoDePeriodo);
    for (const ponta of [de, ate]) {
      if (ponta.tipo === "INEXISTENTE" && !intervaloImpossivel) {
        intervaloImpossivel = { pedido: ponta.pedido, disponiveis: ponta.disponiveis };
      }
    }
    intervalo = {
      de: de.tipo === "RESOLVIDO" ? de.data : null,
      ate: ate.tipo === "RESOLVIDO" ? ate.data : null,
    };
  }

  const periodoRecusado = periodoImpossivel ?? intervaloImpossivel;

  const plano: Plano = {
    intencao,
    necessidades: investigacao.necessidades,
    porque: investigacao.porque.join(" · ") || leitura.porque,
    assunto: termoDoAssunto,
    comoReconheceu: assunto?.como ?? null,
    herdado,
    alvo,
    resolucao,
    contexto,
    origemDoRecorte: recorteDoTurno.origem,
    unidadeCitada: recorteDoTurno.citada?.nome ?? null,
    /*
      O período pedido e recusado **não** cai no da tela.

      `opcoes.recorte?.period` é o que a tela tinha selecionado, e usá-lo aqui
      seria o mesmo fallback silencioso por outro caminho.
    */
    periodo: periodoRecusado ? null : (periodo ?? opcoes.recorte?.period ?? null),
    intervalo,
    periodoImpossivel: periodoRecusado,
  };

  // ---- 5. execução ---------------------------------------------------------
  const evidencias: Evidencia[] = [];
  const documentos: TrechoDoBookRanqueado[] = [];
  const anexos: Anexo[] = [];
  const lacunas: Lacuna[] = [];
  /*
    A mesma consulta não entra duas vezes.

    Com o plano executando um conjunto, duas necessidades podem pedir a mesma
    ferramenta — "o que mudou e o que mais pesou?" quer o movimento e o
    ranking, e as duas passam pelo resumo da vigência. Sem esta guarda o dossiê
    ganharia a mesma evidência com dois números de citação, e a resposta citaria
    duas fontes idênticas como se fossem confirmação independente.
  */
  const vistas = new Set<string>();
  /*
    As consultas partem juntas e são colhidas em ordem.

    Nenhuma delas consome o resultado de outra — são leituras independentes do
    mesmo recorte —, e mesmo assim rodavam em fila: "quanto mudou o pneu desde
    dezembro?" fazia seis, uma após a outra, e levava 239 ms para uma soma de
    trabalho que cabe em 115. Uma promessa em JavaScript começa quando é criada,
    então enfileirar em vez de aguardar já as põe a correr em paralelo.

    **A ordem da colheita é a de declaração, e isso não é detalhe.** É ela que
    numera as citações; colher por ordem de chegada faria a mesma pergunta citar
    fontes com números diferentes conforme a latência do banco naquele instante,
    e a resposta guardada na conversa deixaria de casar com as fontes ao lado.

    **O leque não é limitado, e é uma escolha.** Seis consultas curtas por
    pergunta, contra um pool de dez conexões: com vários analistas perguntando
    ao mesmo tempo o pool enfileira, que é exatamente o que acontecia antes
    desta mudança e sem nenhum erro novo. Um semáforo aqui protegeria contra uma
    carga que este produto não tem — ele é interno e de uma operação — e cobraria
    a complexidade agora. Se um dia a espera aparecer no tempo de resposta, o
    lugar de resolvê-la é o tamanho do pool, não o número de perguntas que uma
    resposta pode fazer.
  */
  const pendentes: Promise<Evidencia | null>[] = [];
  /*
    O funil único das consultas de dado — e o lugar certo para a recusa.

    Guardar cada `case` do switch contra o período impossível seria vinte
    chances de esquecer uma; aqui é uma. A promessa recebida é descartada sem
    ser aguardada: ela já foi criada pelo chamador (é assim que o leque roda em
    paralelo), e deixá-la pendente sem `catch` produziria uma rejeição não
    tratada quando a consulta falhar.
  */
  const juntar = (rotulo: string, promessa: Promise<Evidencia | null>): void => {
    if (periodoRecusado) {
      void promessa.catch(() => null);
      return;
    }
    marcar("consultar", rotulo);
    pendentes.push(promessa.catch(() => null));
  };

  const colher = async (): Promise<void> => {
    for (const promessa of pendentes.splice(0)) {
      const evidencia = await promessa;
      if (!evidencia) continue;
      const chave = `${evidencia.ferramenta}|${evidencia.titulo}|${evidencia.origem}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      evidencias.push(evidencia);
    }
  };

  const periodoEfetivo = plano.periodo ?? undefined;

  /*
    ---- o cálculo derivado, sobre o que a conversa já apurou ------------------

    Ele roda antes do laço porque não depende de nenhuma consulta desta
    pergunta: os operandos são o **foco** da conversa e a base que a resposta
    anterior trouxe. Ver `foco.ts` e `calculo.ts`.

    **Nada aqui é calculado pelo modelo, e nada aqui é calculado sem lastro.**
    Cada operando é conferido contra o que as consultas anteriores apuraram;
    quando falta operando, o desfecho é `CALCULO_NAO_APURADO` com a lista do que
    existe — que é uma resposta, e não um bloqueio.
  */
  let calculoDoFio: ResultadoDoCalculo | null = null;
  let disponiveisParaCalculo: { rotulo: string; escrito: string }[] = [];
  if (investigacao.necessidades.includes("CALCULO")) {
    const escolha = operacaoDaFrase(pergunta);
    const anteriores = estado?.evidenciasAnteriores ?? [];
    if (!escolha) {
      calculoDoFio = {
        apurado: false,
        motivo: "CALCULO_NAO_APURADO",
        explicacao: "não consegui identificar que composição você quer",
      };
    } else {
      const doFio = operandosDoFio(escolha.operacao, estado?.foco ?? null, anteriores);
      disponiveisParaCalculo = doFio.disponiveis;
      calculoDoFio = calcular(
        {
          operacao: escolha.operacao,
          operandos: doFio.operandos,
          grandeza: doFio.grandeza,
          ...(escolha.fator === undefined ? {} : { fator: escolha.fator }),
        },
        grandezasApuradas(anteriores),
      );
    }
  }

  /*
    A pergunta nomeou uma coisa, e essa coisa não existe aqui.

    Este é o gate que impede a pior classe de resposta que este assistente
    produzia: perguntaram "quanto mudou o pedágio?", nenhum parâmetro chamado
    pedágio existe neste export, e a resposta vinha com o movimento **de tudo**
    — R$ 28 mil de alterações que não têm nada a ver com pedágio, apresentados
    como se fossem a resposta. Um número certo sobre o assunto errado é pior que
    nenhum número, porque parece uma resposta.

    Sem alvo, os caminhos que consultam o agregado do recorte ficam desligados,
    e o que sai é a lacuna que diz o que aconteceu.
  */
  /*
    O portão passou a depender de reconhecimento, não de resolução.

    Ele existe para impedir a pior resposta que este assistente dava: perguntar
    "quanto mudou o pedágio?" e receber o movimento **de tudo**, R$ 28 mil que
    não têm nada a ver com pedágio. Mas ele disparava sempre que a resolução
    falhava — inclusive quando o "termo" era `dessas` —, e aí desligava as
    consultas de perguntas que não nomeavam nada.

    Agora só fecha quando a pessoa nomeou algo que o produto conhece e para o
    qual não existe coluna. Quem não nomeou nada (`assunto === null`) consulta
    o recorte, que é o que perguntou.
  */
  const alvoPerdido = assunto !== null && !alvo && !desambiguacao;

  /*
    Uma passagem por necessidade, e todas são executadas.

    Era um `switch` sobre a intenção única: o que não fosse o caso escolhido
    simplesmente não acontecia, e uma pergunta que pedia duas coisas recebia
    uma. Aqui o `switch` continua — ele é a forma certa de despachar um valor
    fechado —, mas ele roda dentro de um laço, e o que decide quantas vezes é o
    plano.
  */
  /*
    Nenhuma consulta é sequer criada quando o período pedido não existe.

    O funil (`juntar`) já recusaria o resultado; parar aqui evita disparar o
    trabalho no banco para depois jogá-lo fora. As duas guardas existem de
    propósito: esta economiza, e a do funil é a que não se pode esquecer ao
    acrescentar um `case`.
  */
  for (const necessidade of periodoRecusado ? [] : investigacao.necessidades) {
  switch (necessidade) {
    case "CONCEITUAL":
    case "DISPONIBILIDADE":
      // Conceito não consulta impacto. É a correção do defeito que fazia
      // "como funciona X" responder com o resumo da vigência mais recente.
      break;

    case "BOOK":
      /*
        O conteúdo do Book vem da busca, que roda para toda pergunta logo
        abaixo. O que sobra para cá é o caso em que a pergunta é sobre o Book
        como um todo — "quantos blocos já têm regra?" —, que é dado e não
        conteúdo.
      */
      /*
        A cobertura só é resposta quando não há regra a mostrar.

        Ela conta quantos blocos já têm conteúdo — dado sobre o Book, não
        conteúdo dele. Quem perguntou algo que a busca respondeu quer a regra;
        entregar a estatística ao lado dela é trocar a resposta pela ficha.
      */
      if (!termoDoAssunto && !investigacao.bookPorEvidencia) {
        juntar("Consultando o Book do Operador", coberturaDoBook(db));
      }
      break;

    case "PANORAMA":
      if (contexto) {
        juntar("Consultando o que foi importado", panoramaDoContexto(db, contexto));
      }
      break;

    case "CATALOGO_DE_CONTEXTO":
      if (contexto) {
        juntar("Listando vigências", listarVigencias(db, contexto));
      }
      break;

    case "MOVIMENTO":
      if (contexto && !alvoPerdido) {
        juntar("Consultando alterações", resumoDaVigencia(db, contexto, periodoEfetivo));
        if (alvo) {
          juntar(
            "Consultando o parâmetro",
            movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
          );
        }
      }
      break;

    case "VALOR":
      if (contexto && alvo) {
        juntar(
          "Consultando o parâmetro",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        for (const atributo of alvo.atributos.slice(0, 2)) {
          juntar("Consultando a série", serieDoParametro(db, contexto, atributo.codigo));
        }
      } else if (contexto && !alvoPerdido) {
        juntar("Consultando alterações", resumoDaVigencia(db, contexto, periodoEfetivo));
      }
      break;

    case "EVOLUCAO":
      if (contexto && alvo) {
        /*
          "Quanto mudou X?" pergunta duas coisas ao mesmo tempo, e as duas
          precisam sair: **quantas** alterações houve na vigência corrente e
          **por onde** o valor andou ao longo delas. A série sozinha responde a
          segunda e deixa a primeira sem número — quem perguntou "quanto mudou
          a manutenção?" ouvia nove médias e nunca as 72 alterações que a tela
          de Parâmetros mostra para a mesma gaveta.
        */
        juntar(
          "Consultando o parâmetro",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        for (const atributo of alvo.atributos.slice(0, 3)) {
          juntar("Consultando a série", serieDoParametro(db, contexto, atributo.codigo));
        }
        juntar(
          "Calculando o intervalo",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined, [
            `${alvo.atributos[0]?.familia ?? ""}|${alvo.parametro}`,
          ]),
        );
      } else if (contexto && !alvoPerdido) {
        juntar(
          "Calculando o intervalo",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined),
        );
      }
      break;

    case "COMPARACAO":
      if (contexto && !alvoPerdido) {
        juntar(
          "Comparando as vigências",
          compararIntervalo(db, contexto, intervalo?.de ?? undefined, intervalo?.ate ?? undefined),
        );
      }
      break;

    case "ATENCAO":
      if (contexto) {
        juntar("Montando a fila de investigação", filaDeInvestigacao(db, contexto, periodoEfetivo));
      }
      break;

    case "RANKING_PERDA":
    case "RANKING_GANHO":
      if (contexto) {
        juntar(
          "Calculando impacto",
          rankingDeImpacto(db, contexto, intencao === "RANKING_PERDA" ? "PERDA" : "GANHO", periodoEfetivo),
        );
      }
      break;

    case "VEICULOS":
      if (contexto) {
        juntar("Consultando veículos afetados", veiculosAfetados(db, contexto, periodoEfetivo));
      }
      break;

    case "SEM_PRECO":
      if (contexto) {
        juntar("Verificando o que não tem preço", semParaPrecificar(db, contexto, periodoEfetivo));
      }
      break;

    case "PROCEDENCIA":
      /*
        Procedência refaz a consulta, em vez de reexibir o que já estava em
        memória.

        A primeira versão guardava as evidências da resposta anterior no estado
        e as devolvia. Duas coisas quebravam: o estado é persistido entre
        requisições e as evidências não são (de propósito — descrevem uma
        consulta de um instante), então numa conversa recarregada "por quê?"
        respondia que não sabia; e reexibir número guardado é servir dado velho
        com cara de consulta nova.

        Refazer é mais lento e é o que se pode sustentar: a origem sai do banco
        agora, no mesmo recorte, e desce até a linha que mudou.
      */
      if (contexto && alvo) {
        juntar(
          "Recuperando a origem",
          movimentoDoParametro(db, contexto, alvo, periodoEfetivo),
        );
        const primeiraColuna = alvo.atributos[0];
        if (primeiraColuna && plano.periodo) {
          juntar(
            "Descendo até as linhas",
            veiculosDoGrupo(db, contexto, plano.periodo, primeiraColuna.codigo, primeiraColuna.equipamento),
          );
        }
      } else if (contexto && !alvoPerdido) {
        juntar("Recuperando a origem", resumoDaVigencia(db, contexto, periodoEfetivo));
      }
      break;

    /*
      ---- governança do dado -------------------------------------------------

      Nenhuma das três precisa de recorte, e isso é uma afirmação sobre o
      domínio, não uma economia: curadoria, importação e balanço descrevem o
      **pipeline**, que é um só para todas as unidades. Filtrá-los por
      (unidade, canal) responderia uma pergunta que ninguém faz e esconderia
      metade do que se quis saber.
    */
    case "CURADORIA":
      juntar("Consultando a curadoria", estadoDaCuradoria(db));
      if (alvo?.atributos[0]) {
        juntar(
          "Recuperando o histórico da semântica",
          historicoDaSemantica(db, alvo.atributos[0].codigo),
        );
      }
      break;

    case "IMPORTACOES":
      juntar("Consultando as importações", importacoesRecentes(db));
      break;

    case "BALANCO":
      juntar("Consultando o rastreio de dados", balancoDasImportacoes(db));
      break;

    case "CELULAS":
      /*
        A busca usa o termo que sobrou da frase, e não a frase inteira.

        "Onde aparece a placa ABC1D23 na planilha?" tem seis palavras de
        operação e uma de conteúdo; procurar a frase toda em `raw_cell` não
        acharia nada, e procurar cada palavra acharia tudo. `assuntoCandidato`
        já é exatamente o resíduo depois da poda.
      */
      /*
        A busca nas células é literal — uma placa, um número de chassi —, então
        ela usa o candidato cru e não o assunto reconhecido: o que se procura
        aqui é justamente o que o dicionário do produto **não** conhece.
      */
      if (candidato) {
        juntar("Procurando nas células importadas", buscarNasCelulas(db, candidato));
      }
      break;

    case "COMPOSICAO":
      if (contexto) {
        juntar(
          "Compondo a remuneração da frota",
          composicaoDaFrota(db, contexto, leitura.entidades.equipamento ?? "CAVALO", periodoEfetivo),
        );
      }
      break;

    /*
      A DRE sempre em escopo de CONJUNTO quando ninguém pediu outro.

      É o único escopo em que a pergunta "este caminhão dá dinheiro?" tem
      resposta completa: um cavalo sozinho não carrega o implemento que roda com
      ele, e uma carreta sozinha não carrega o cavalo. Responder por cavalo
      quando perguntaram por caminhão daria um número menor, verdadeiro sobre
      outra coisa, e indistinguível do certo na leitura.
    */
    case "DRE":
      if (contexto) {
        const escopoDaDRE =
          leitura.entidades.equipamento === "CARRETA"
            ? "CARRETA"
            : leitura.entidades.equipamento === "CAVALO"
              ? "CAVALO"
              : "CONJUNTO";
        await juntar(
          "Apurando o resultado da frota",
          resultadoDaFrota(db, contexto, escopoDaDRE, periodoEfetivo),
        );

        /*
          Quando a pergunta nomeia uma placa, a ponte vem junto.

          "Por que o ABC1D23 piorou em agosto?" precisa das duas coisas: o
          resultado da frota dá a régua, e a ponte diz o que empurrou aquele
          veículo. Sem a segunda, a resposta seria um número de frota para uma
          pergunta sobre um caminhão.
        */
        const veiculo = await placaCitada(db, pergunta).catch(() => null);
        if (veiculo) {
          await juntar(
            `Apurando o que mudou em ${veiculo.placa}`,
            porQueOResultadoMudou(db, contexto, veiculo.entityId, escopoDaDRE, periodoEfetivo),
          );
        }
      }
      break;

    /*
      ---- as duas que falam do que já se disse -------------------------------

      Nenhuma das duas consulta o recorte, e essa é a coisa toda: "tem certeza?"
      pergunta pela qualidade da resposta anterior e "quanto isso dá por ano?"
      compõe um número que já foi apurado. Mandá-las consultar o movimento da
      vigência era o defeito — um resumo correto de outra coisa, entregue a quem
      perguntou outra coisa.
    */
    case "SUSTENTACAO":
      /*
        Ela é respondida em `resposta.ts`, a partir do rastro guardado no
        estado, e por isso não há consulta aqui. O dossiê fica sem evidência de
        propósito: não há número novo a mostrar — há uma resposta anterior a
        auditar.
      */
      break;

    case "CALCULO":
      if (calculoDoFio) {
        marcar("calcular", "Compondo os valores já apurados");
        if (calculoDoFio.apurado) evidencias.push(evidenciaDoCalculo(calculoDoFio));
      }
      break;

    case "SAUDACAO":
    case "DESCONHECIDA":
      break;
  }
  }

  /*
    ---- 5b. o Book, para qualquer pergunta -----------------------------------

    Esta é a etapa que faltava, e ela não é um caso especial de intenção: é uma
    fonte a mais, consultada em paralelo com o dado. A classificação decide o
    que **calcular**; ela não decide o que a operação escreveu sobre o assunto,
    e as duas coisas quase sempre valem juntas. "O que mudou no IPVA?" ganha a
    regra do Book ao lado do número; "o que é QLP ADM?" é respondida só pelo
    Book; "explique QLP ADM e veja o que mudou" precisa das duas, e antes não
    havia caminho nenhum que trouxesse as duas.

    Quem não tem assunto não procura: uma saudação e um "compare julho com
    agosto" sem parâmetro nomeado não têm o que buscar no Book, e uma busca sem
    termo devolveria os trechos mais genéricos do corpus inteiro.
  */
  /*
    Quanto do Book entra na resposta — decidido pelo plano, não pela frase.

    A busca já rodou lá em cima e o limiar já descartou o que era ruído. O que
    se decide aqui é largura: uma pergunta cuja necessidade **é** a regra fica
    com os seis trechos; uma pergunta de número que por acaso casou uma regra
    fica com três, para o dado não ser empurrado para fora do dossiê pelo
    contexto que só o acompanha.
  */
  const querRegra =
    investigacao.necessidades.includes("BOOK") ||
    investigacao.necessidades.includes("CONCEITUAL") ||
    investigacao.necessidades.includes("DISPONIBILIDADE");

  documentos.push(...achadosDoBook.slice(0, querRegra ? 6 : 3));

  if (leitura.intencao !== "SAUDACAO") {
    /*
      A par do conteúdo, o registro: qual bloco, que revisão, que tipo de
      entrada. Isso não entra na prosa — os fatos são marcados como internos —,
      mas é o que sustenta a fonte na tela e o que responde "isto está mesmo
      registrado no Book?".
    */
    if (termoDoAssunto) {
      juntar(
        "Consultando o registro do Book",
        regraDoBook(db, termoDoAssunto, { documentoLido: documentos.length > 0 }),
      );
    }

    /*
      Quando a pergunta é sobre o bloco, o documento inteiro responde melhor
      que três trechos dele.

      "Me explique o QLP ADM" pede o que o documento diz, na ordem em que ele
      diz — objetivo, frequência, critérios. Trechos ranqueados são a ferramenta
      certa para achar; para explicar, eles entregam três pedaços e deixam quem
      lê montando o resto. O teto de tamanho decide: manual de duzentas páginas
      continua vindo por trecho.
    */
    const principal = achadosDoBook[0]?.trecho;
    const nomeouOBloco =
      principal &&
      querRegra &&
      termos(pergunta).some((p) => normalizar(principal.bloco).includes(p));

    if (principal && nomeouOBloco) {
      const inteiro = await documentoDoBloco(db, principal.blockKey).catch(() => null);
      if (inteiro) {
        const outros = documentos.filter((d) => d.trecho.blockKey !== principal.blockKey);
        documentos.length = 0;
        documentos.push(
          ...inteiro.map((trecho) => ({
            trecho,
            pontos: achadosDoBook[0]!.pontos,
            porque: ["documento inteiro — a pergunta é sobre este bloco"],
          })),
          ...outros,
        );
      }
    }

    /*
      O arquivo em si só acompanha a pergunta quando o texto dele não pôde ser
      lido — PDF e imagem, que só o modelo abre.

      Para Word, Excel e PowerPoint o índice já traz o conteúdo estruturado, e
      mandar o arquivo junto seria a mesma informação duas vezes: uma
      conferível contra o texto do dossiê e outra não.
    */
    if (termoDoAssunto && documentos.length === 0) {
      const anexo = await anexoDoBook(db, termoDoAssunto).catch(() => null);
      if (anexo?.conteudo.forma === "NATIVO") {
        marcar("anexar", "Abrindo o documento do Book");
        anexos.push(anexo);
      }
    }
  }

  /*
    ---- a colheita ----------------------------------------------------------

    Aqui, e não antes: o registro do Book é enfileirado depois do laço, e a
    lacuna e a redação leem `evidencias` depois daqui. Colher cedo demais
    devolveria a fila ao comportamento sequencial sem que nada denunciasse.
  */
  await colher();

  /*
    ---- a descida ------------------------------------------------------------

    Aqui a orquestração deixa de executar um plano e passa a **reagir** ao que
    voltou. Ver `aprofundar.ts`: o código do parâmetro sai do grupo que mais
    pesou, a placa sai das linhas daquele grupo, a célula sai daquela placa —
    nenhum dos três existia antes da consulta anterior, e é por isso que eles
    contam como encadeamento e a largura do plano não conta.

    **Quando ela roda.** Quando a pergunta é causal — quer a razão de um
    movimento, o que mais pesou, ou o que merece atenção — e há vigência
    resolvida. Rodar sempre seria transformar profundidade em custo fixo, e a
    maioria das perguntas deste produto se responde num nível só.

    **Quando ela para.** No primeiro passo sem argumento: recorte sem grupo com
    impacto, grupo sem placa, placa sem célula. Parar cedo é desfecho normal.
  */
  const encadeamentos: PassoDaDescida[] = [];
  /*
    `houveTroca` não entra aqui, e não por esquecimento: o portão de
    correspondência roda **depois** desta descida — ele precisa de tudo o que a
    busca trouxe para decidir — e é ele quem esvazia o dossiê quando o que
    voltou não é o que foi pedido. A descida é consulta ao recorte, não à coisa
    nomeada; se o portão fechar, o que ela trouxe sai junto com o resto.
  */
  /*
    Três portas para a descida, e cada uma cobre o que as outras não veem.

    1. **A forma da pergunta.** `leitura.pedeCausa` é a leitura que nenhum
       detector de conteúdo pode fazer: "por que a remuneração caiu?" e "quanto
       a remuneração caiu?" casam o **mesmo** detector, e sem este campo a
       primeira virava MOVIMENTO e recebia o agregado da vigência.
    2. **O plano.** Ranking, atenção e procedência já são pedidos de causa por
       necessidade, tenham ou não a palavra "por quê".
    3. **O fio.** Quando a conversa já está dentro de um grupo, "o que mudou
       nesses veículos?" continua a descida sem nomear causa nenhuma — e
       recomeçar do agregado ali é perder a investigação no meio.
  */
  const querCausa =
    !periodoRecusado &&
    !alvoPerdido &&
    /*
      As duas necessidades que operam sobre o que **já** foi apurado nunca
      descem. Compor um valor e auditar uma conclusão não pedem dado novo — e
      buscar dado novo aqui traria números de uma consulta que não é a que está
      em discussão: a conta sairia aritmeticamente perfeita sobre duas coisas
      que não se comparam. O controle negativo em `calculo-derivado.test.ts`
      pegou exatamente isto.
    */
    !investigacao.necessidades.some((n) => SEM_DESCIDA.has(n)) &&
    (leitura.pedeCausa ||
      investigacao.necessidades.some((n) => CAUSAIS.has(n)) ||
      (DENTRO_DA_DESCIDA.has(estado?.foco?.tipo ?? "") && termoDoAssunto === null));
  if (querCausa && contexto) {
    marcar("aprofundar", "Descendo até a causa");
    /*
      A profundidade sai do plano, e não de mais um vocabulário.

      Procedência pergunta pela origem: desce até a célula. Uma pergunta por
      veículos quer as placas: a linha é a resposta, e a planilha é o passo
      seguinte que ninguém pediu. Ranking e atenção querem o grupo aberto.
      "Por quê" sem mais nada desce até o fundo, porque é a pergunta que não diz
      onde parar.
    */
    const ate: Fundo = investigacao.necessidades.includes("PROCEDENCIA")
      ? "CELULA"
      : investigacao.necessidades.includes("VEICULOS")
        ? "LINHA"
        : leitura.pedeCausa
          ? "CELULA"
          : "LINHA";

    /*
      O lado sai do plano, pela mesma razão que a profundidade: a pergunta já
      declarou de que lado fala, e ordenar por módulo apaga essa declaração.
    */
    const lado: Lado = investigacao.necessidades.includes("RANKING_PERDA")
      ? "PERDA"
      : investigacao.necessidades.includes("RANKING_GANHO")
        ? "GANHO"
        : "QUALQUER";

    const descida = await descer({
      db,
      ctx: contexto,
      ate,
      lado,
      ...(estado?.foco?.grupo ? { grupoEmFoco: estado.foco.grupo } : {}),
      periodo: plano.periodo,
      equipamento: leitura.entidades.equipamento,
      aoAvancar: (rotulo) => marcar("consultar", rotulo),
    }).catch(() => ({ evidencias: [], passos: [] }));

    for (const e of descida.evidencias) {
      const chave = `${e.ferramenta}|${e.titulo}|${e.origem}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      evidencias.push(e);
    }
    encadeamentos.push(...descida.passos);
  }

  /*
    ---- o segundo salto ------------------------------------------------------

    Achou o que pesa; agora vai ler o que a regra diz sobre aquilo.

    É o que um analista faz e o que este assistente não fazia. Quem pergunta "o
    que eu deveria investigar primeiro?" não sabe o nome do parâmetro que vai
    sair na frente — e por isso não tem como pedir a regra dele na mesma frase.
    A primeira busca no Book usou as palavras da pergunta, que não continham o
    assunto porque ele ainda não era conhecido; esta usa o assunto que a
    consulta descobriu.

    **Três guardas, e cada uma evita um jeito de isto piorar a resposta.** Só
    salta a partir de uma ferramenta que **ordenou** alguma coisa: o agregado
    não descobriu assunto, descreveu o conjunto. Só salta quando a primeira
    busca não respondeu com confiança — havendo regra forte, a pergunta já foi
    respondida pelas duas fontes. E o limiar continua decidindo, então um
    assunto sem regra registrada não traz nada, e o silêncio aqui é uma
    resposta correta.

    A segunda guarda mede **confiança**, não presença. Medir presença era o
    primeiro desenho, e ele se anulava sozinho: uma pergunta executiva costuma
    casar fracamente algum bloco pelas palavras soltas da frase, e esse
    documento fraco — que não responde nada — bloqueava a busca dirigida que
    responderia.
  */
  const emDestaque = evidencias.find((e) => e.assuntoEmDestaque)?.assuntoEmDestaque;
  const jaRespondeu = (achadosDoBook[0]?.pontos ?? 0) >= LIMIAR_PARA_DEFINIR;
  if (emDestaque && !jaRespondeu) {
    marcar("segundoSalto", `Procurando a regra de ${emDestaque}`);
    const doDestaque = await buscarNoBookDetalhado(db, emDestaque, { limite: 3 }).catch(() => null);
    if (doDestaque && doDestaque.selecionados.length > 0) {
      /*
        O que a busca dirigida achou vem primeiro.

        Ela procurou pelo assunto que a consulta descobriu; a primeira procurou
        pelas palavras de uma pergunta que ainda não sabia o assunto. Entre as
        duas, a segunda é a que fala do que a resposta vai tratar.
      */
      const antes = documentos.splice(0);
      documentos.push(...doDestaque.selecionados, ...antes);
      documentos.splice(6);
      diagnosticoDoBook = {
        candidatos: diagnosticoDoBook.candidatos + doDestaque.candidatos,
        selecionados: documentos.length,
        melhorPontuacao: Number(doDestaque.melhorPontuacao.toFixed(3)),
      };
    }
  }

  // ---- 6. corpus conceitual -----------------------------------------------
  /*
    Uma saudação não consulta o conhecimento — e não anuncia que consultou.

    A etapa é o que a tela mostra enquanto a orquestração roda, e ela é
    verdadeira por construção: cada linha corresponde a algo que aconteceu.
    Anunciar "Consultando o conhecimento do produto" para um "bom dia"
    reintroduziria o progresso inventado que este módulo existe para não ter.
  */
  if (intencao !== "SAUDACAO") marcar("buscarConceito", "Consultando o conhecimento do produto");
  /*
    Quem pergunta do Book quer o Book.

    Sem restringir o corpus, "isso está previsto no Book?" era respondida pelo
    cartão "Cavalo" do catálogo do Freightech — que menciona o parâmetro
    herdado e por isso subia pelo empurrão de ligação. O catálogo descreve o
    que o Freightech publica; o Book registra o que foi contratado. São
    perguntas diferentes, e a segunda não se responde com a primeira.
  */
  const trechos =
    intencao === "SAUDACAO"
      ? []
      : buscarTrechos(pergunta, {
          limite: intencao === "CONCEITUAL" || intencao === "DISPONIBILIDADE" ? 4 : 2,
          ...(intencao === "BOOK" ? { corpora: ["BOOK_INDICE", "ARTIGO"] as const } : {}),
          atributos: alvo?.atributos.map((a) => a.codigo) ?? [],
          parametros: alvo ? [alvo.parametro] : [],
        });

  /*
    ---- 6b. dedup entre o índice e o documento ------------------------------

    O índice do Book diz "X é um bloco da categoria Y do Book do Operador"; o
    documento de X diz o que a regra determina. Quando os dois estão no dossiê,
    o primeiro não acrescenta nada — e acrescenta um risco: é a frase mais
    fácil de repetir, e foi ela que abriu as respostas que motivaram esta
    revisão. Fonte que diz a mesma coisa não aumenta confiança; aumenta o
    tamanho da resposta.
  */
  const blocosNoDossie = new Set(documentos.map((d) => normalizar(d.trecho.bloco)));
  const semRepetir = trechos.filter(
    (t) => !(t.trecho.corpus === "BOOK_INDICE" && blocosNoDossie.has(normalizar(t.trecho.titulo))),
  );
  trechos.length = 0;
  trechos.push(...semRepetir);

  /*
    ---- 6c. o portão de correspondência --------------------------------------

    A última pergunta antes de escrever: **o que voltou é o que foi pedido?**

    Toda a recuperação acima é por semelhança — o índice do Book ranqueia por
    pontuação, o catálogo casa por vocabulário, o resolvedor aceita o mais
    próximo. Semelhança acha; ela não conclui. Sem este portão, uma placa que
    não existe recebia a regra genérica de IPVA, uma unidade que não existe
    recebia o cartão "Parâmetros operação", e `QLP ADMINISTRATIVO DE FROTA`
    recebia o conteúdo de `DESCONTO QLP ADM` — os três com `lacunas` vazia e
    `desambiguacao` nula, isto é, sem nada dizendo que houve troca.

    Ele roda aqui, depois da colheita e antes das lacunas, porque só aqui existe
    ao mesmo tempo o que foi nomeado e tudo o que a busca trouxe.

    **Quando não corresponde, o material sai do dossiê.** Não basta acrescentar
    a ressalva: enquanto o vizinho continuar entre as evidências, ele é o que a
    redação — determinística ou do modelo — tem para escrever, e a resposta volta
    a ser sobre ele. O vizinho passa a viver só em `desambiguacao`, que é uma
    pergunta a quem perguntou, e não uma resposta.
  */
  const placasCitadas = placasNomeadas(pergunta);
  const placasDesconhecidas =
    placasCitadas.length > 0 && !(await placaCitada(db, pergunta).catch(() => null))
      ? placasCitadas
      : [];

  const unidadesCitadas =
    intencao === "SAUDACAO" ? [] : unidadesNomeadas(pergunta, vocabularioDoProduto());
  const unidadesDesconhecidas: { citada: string; existentes: string[] }[] = [];
  if (unidadesCitadas.length > 0) {
    const contextos = await listContexts(db).catch(() => []);
    const existentes = [
      ...new Set(
        contextos
          .flatMap((c) => c.scopes.map((s) => s.name))
          .filter((n): n is string => typeof n === "string" && n.trim() !== ""),
      ),
    ];
    const conhecida = new Set(existentes.map((n) => normalizar(n)));
    for (const citada of unidadesCitadas) {
      if (!conhecida.has(normalizar(citada))) unidadesDesconhecidas.push({ citada, existentes });
    }
  }

  const semCorrespondencia = conferirCorrespondencia({
    termoNomeado: termoDoAssunto,
    placasDesconhecidas,
    unidadesDesconhecidas,
    material: {
      /*
        A identidade é o **nome** do que voltou, nunca o corpo do texto: um bloco
        que menciona IPVA numa cláusula não passa a se chamar IPVA.
      */
      identidades: [
        ...documentos.map((d) => identidadeDoTrecho(d.trecho.bloco, d.trecho.secao)),
        ...trechos.map((t) => t.trecho.titulo),
        ...(alvo ? [alvo.parametro] : []),
      ],
      vizinhos: [...new Set(documentos.map((d) => d.trecho.bloco))],
    },
  });

  const houveTroca = semCorrespondencia.length > 0;
  if (houveTroca) {
    documentos.length = 0;
    trechos.length = 0;
    evidencias.length = 0;
    anexos.length = 0;
    // A descida some junto com o que ela desceu: um encadeamento que aponta
    // para evidência que não está mais no dossiê é um rastro que mente.
    encadeamentos.length = 0;
    desambiguacao = desambiguacaoDe(semCorrespondencia);
    lacunas.push({ tipo: "NAO_ENCONTREI", explicacao: explicarFalta(semCorrespondencia) });
  }

  // ---- 7. lacunas ----------------------------------------------------------
  /*
    O período que não existe é a primeira lacuna, e ela vem antes de todas.

    Ela é a explicação do turno inteiro: nenhuma consulta rodou por causa dela,
    e qualquer outra lacuna declarada aqui seria consequência dessa, não causa.
    Posta em primeiro lugar, é a que a redação lê primeiro.
  */
  if (periodoRecusado) {
    lacunas.push({
      tipo: "NAO_ENCONTREI",
      explicacao: explicarPeriodoInexistente(
        periodoRecusado.pedido,
        periodoRecusado.disponiveis,
      ),
    });
  }

  /*
    O cálculo que não pôde ser apurado é dito com o nome dele, e com o que existe.

    A alternativa seria um dos dois erros que esta capacidade existe para não
    cometer: devolver um agregado que não responde, ou simplesmente bloquear.
    Aqui a recusa é a resposta — ela diz por que a conta não saiu e lista os
    valores que estão sobre a mesa, que é o que permite a próxima pergunta ser
    a certa.
  */
  if (calculoDoFio && !calculoDoFio.apurado) {
    const oQueHa = disponiveisParaCalculo
      .slice(0, 6)
      .map((d) => `${d.rotulo}: ${d.escrito}`)
      .join(" · ");
    lacunas.push({
      tipo: "DADO_SEM_PRECO",
      explicacao:
        `Não dá para fazer essa conta: ${calculoDoFio.explicacao}.` +
        (oQueHa
          ? ` O que a conversa apurou até aqui — ${oQueHa}. Diga qual desses você quer compor.`
          : " Consulte primeiro o valor que você quer compor."),
    });
  }

  /*
    O qualificador só é lacuna quando a pergunta espera uma coluna.

    Quem pergunta "qual a regra do bloco PNEU?" não está pedindo uma coluna
    chamada regra — está pedindo o Book, que responde em texto. Rodar a detecção
    aqui produzia a nota "nenhuma coluna da gaveta Pneu trata de regra, bloco",
    verdadeira e sem nenhuma relação com o que foi perguntado.
  */
  if (termoDoAssunto && alvo && intencao !== "BOOK" && !houveTroca) {
    const lacuna = lacunaDoQualificador(termoDoAssunto, alvo);
    if (lacuna) lacunas.push(lacuna);
  }

  /*
    Quando a resolução falha, isso é lacuna — ou não é, conforme o que a
    pergunta precisava.

    Numa pergunta de número, sem parâmetro resolvido não há resposta possível, e
    dizê-lo é obrigatório. Numa pergunta conceitual, o corpus pode ter respondido
    inteiramente sem que nenhuma coluna se chame como a pergunta: "o que
    significa semântica UNKNOWN?" é respondida pelo artigo de Curadoria, e
    terminar com "nenhum parâmetro corresponde a unknown" seria negar a resposta
    que acabou de ser dada.
  */
  /*
    O registro do Book não conta como número consultado.

    `regraDoBook` diz qual bloco cobre o assunto e em que revisão — é evidência
    de que a regra existe, não de que houve movimento. Contá-la aqui fazia a
    lacuna desaparecer justamente no caso que a criou: "quanto mudou o
    pedágio?" passou a trazer o registro do Book (porque a busca deixou de
    depender do assunto extraído) e, com ele, a deixar de dizer que o export
    não traz pedágio.
  */
  const evidenciasDeDado = evidencias.filter(
    (e) => !e.ferramenta.toLowerCase().includes("book"),
  );
  const precisavaDeNumero = INTENCOES_COM_RECORTE.has(intencao);
  if (
    alvoPerdido &&
    !houveTroca &&
    (precisavaDeNumero ? evidenciasDeDado.length === 0 : trechos.length === 0)
  ) {
    /*
      Distinguir "o produto não conhece isto" de "o produto conhece e o export
      não traz" é o que separa duas conversas muito diferentes: a primeira
      encerra o assunto, a segunda diz qual arquivo pedir. O catálogo e o Book
      são as duas fontes que provam a segunda.
    */
    const noCatalogo = trechos.some((t) => t.trecho.corpus === "CATALOGO");
    const noBook = trechos.some((t) => t.trecho.corpus === "BOOK_INDICE");
    lacunas.push({
      tipo: noCatalogo || noBook ? "CONCEITO_SEM_DADO" : "NAO_EXISTE_NO_PRODUTO",
      explicacao:
        noCatalogo || noBook
          ? `${noCatalogo ? "O Freightech publica este assunto" : "O Book do Operador trata deste assunto"}, ` +
            `mas nenhuma coluna deste export alimenta "${termoDoAssunto}" — então não há número a somar aqui.`
          : `O arquivo importado não tem nada sobre "${termoDoAssunto}"` +
            (documentos.length > 0
              ? " — o que sai daqui é a regra registrada no Book, não número apurado."
              : ". Pode ser que o Freightech publique esse assunto noutra tela, cujo arquivo ainda não foi importado."),
    });
  }

  const semPreco = evidencias.some((e) =>
    e.fatos.some((f) => /não apurável|sem preço/i.test(`${f.valor} ${f.detalhe ?? ""}`)),
  );
  if (semPreco) {
    lacunas.push({
      tipo: "DADO_SEM_PRECO",
      explicacao:
        "Dá para ver o que mudou, mas não quanto isso vale em dinheiro: ainda não foi " +
        "confirmado como esse valor deve ser somado, e somar sem essa confirmação seria " +
        "chute. A confirmação é feita na tela de Curadoria, e destrava o impacto destas " +
        "mesmas alterações.",
    });
  }

  /*
    Não achar nada só é lacuna quando havia o que achar.

    "Não encontrei nada sobre isto" é uma afirmação sobre uma busca que falhou.
    Um "bom dia" não fez busca nenhuma: dizer a alguém que cumprimentou que
    nada foi encontrado sobre o cumprimento dele é responder a uma pergunta que
    não foi feita — e era a primeira coisa que este produto dizia a quem abria
    a tela. A saudação sai daqui sem lacuna, e quem redige a trata como o que
    ela é: conversa.
  */
  /*
    E o período recusado já explicou o vazio deste turno.

    Sem esta condição, a mesma resposta traria duas lacunas dizendo coisas
    diferentes sobre a mesma causa: "não existe vigência para fevereiro de 1998"
    e "procurei nos três lugares e não encontrei nada". A segunda é verdadeira e
    enganosa — dá a entender que a busca falhou, quando ela não chegou a rodar.
  */
  if (
    intencao !== "SAUDACAO" &&
    !houveTroca &&
    !periodoRecusado &&
    evidencias.length === 0 &&
    documentos.length === 0 &&
    trechos.length === 0 &&
    !desambiguacao
  ) {
    /*
      "Não encontrei" tem de dizer **onde** se procurou.

      A frase genérica encerrava a conversa sem dar a quem perguntou nenhuma
      pista do que fazer em seguida — e as três fontes têm formas diferentes de
      estar vazias: o Book pode não ter o bloco registrado, o export pode não
      trazer a coluna, o recorte pode não ter vigência importada. Dizer os três
      lugares transforma a recusa numa informação.
    */
    lacunas.push({
      tipo: "NAO_ENCONTREI",
      explicacao:
        "Procurei nos três lugares que este produto tem — o Book do Operador, o catálogo " +
        "de parâmetros do Freightech e os dados importados deste recorte — e não encontrei " +
        "nada que sustente uma resposta. Se o assunto tiver documento no Freightech que " +
        "ainda não foi anexado ao Book, é por aí que ele entra.",
    });
  }

  return {
    pergunta,
    leitura: { ...leitura, intencao },
    plano,
    trechos,
    documentos,
    evidencias,
    anexos,
    lacunas,
    etapas,
    desambiguacao,
    encadeamentos,
    telaScopeHash: opcoes.recorte?.scopeHash ?? null,
    diagnostico: { book: diagnosticoDoBook, ms: Date.now() - comecou },
  };
}

// ── A numeração das citações ────────────────────────────────────────────────

/**
 * Tudo o que a resposta pode citar, numerado — **uma vez, num lugar só.**
 *
 * A numeração era contrato e estava reimplementada em três arquivos: quem
 * montava a lista de fontes, quem escrevia o dossiê para o modelo e quem
 * conferia as citações contavam cada um por si, com um comentário em cada
 * ponto avisando que mexer num sem mexer nos outros faria a resposta citar um
 * documento e a trava conferir uma evidência — "o que não daria erro em lugar
 * nenhum". Um contrato que depende de três cópias concordarem não é contrato;
 * é uma coincidência mantida à mão. Agora é esta função, e os três a chamam.
 *
 * A ordem é a da leitura: o conceito situa, o Book manda no conteúdo, o dado
 * mede, o arquivo é o que só o modelo abre.
 */
export type ItemCitavel =
  | { id: number; tipo: "CONCEITO"; trecho: TrechoRelevante }
  | { id: number; tipo: "BOOK"; documento: TrechoDoBookRanqueado }
  | { id: number; tipo: "DADO"; evidencia: Evidencia }
  | { id: number; tipo: "ARQUIVO"; anexo: Anexo };

export function itensCitaveis(dossie: Dossie): ItemCitavel[] {
  const itens: ItemCitavel[] = [];
  let n = 1;
  for (const trecho of dossie.trechos) itens.push({ id: n++, tipo: "CONCEITO", trecho });
  for (const documento of dossie.documentos) itens.push({ id: n++, tipo: "BOOK", documento });
  for (const evidencia of dossie.evidencias) itens.push({ id: n++, tipo: "DADO", evidencia });
  for (const anexo of dossie.anexos) itens.push({ id: n++, tipo: "ARQUIVO", anexo });
  return itens;
}

// ── Validação ───────────────────────────────────────────────────────────────

/**
 * Todo token numérico do texto — **sem a pontuação que encerra a frase**.
 *
 * `\d[\d.,]*` é ganancioso à direita, então numa lista como "19, 44 e 56" ele
 * produz `19,` e `44` — o primeiro com a vírgula da enumeração grudada. Esse
 * token não existe em evidência nenhuma, porque ninguém guarda um número com a
 * pontuação da frase em que ele foi escrito, e a conferência o recusava como
 * se fosse invenção.
 *
 * **Medido, e não suposto.** Na bateria agente × planejador, 42 dos 54 números
 * recusados terminavam em vírgula ou ponto. E o efeito não era só do agente: o
 * caminho determinístico perdeu duas respostas limpas entre duas execuções sem
 * uma linha de código mudada, com `2026,` — o ano da vigência seguido de
 * vírgula — entre os tokens recusados. O defeito estava a degradar o produto em
 * produção.
 *
 * **Isto não afrouxa a trava.** O que sai é pontuação, nunca algarismo: `19,`
 * vira `19` e continua tendo de estar autorizado; `4.145` continua sendo
 * recusado quando o valor é `4.145,26`. Não há número que passe a ser aceito
 * sem lastro — há um token que deixa de ser inventado pelo extrator.
 *
 * De quebra fecha a numeração de lista: `1.` vira `1`, que o filtro de
 * algarismo isolado já descarta por ser ordinal e não afirmação.
 *
 * A mesma função serve os dois lados da conferência — o texto redigido e o que
 * as evidências autorizam —, então a simetria é automática.
 */
function numerosDoTexto(texto: string): string[] {
  return (texto.match(/\d[\d.,]*/g) ?? []).map((t) => t.replace(/[.,]+$/, ""));
}

// ── Identificadores: placa não é número ─────────────────────────────────────

/**
 * A forma de uma placa. A mesma de `ferramentas.ts` e `correspondencia.ts`.
 *
 * Ela vive em três arquivos e isso é uma dívida conhecida — o que não se pode é
 * ela divergir, porque os três decidem coisas sobre a mesma string: o que é uma
 * placa citada, o que é uma placa consultada, e o que é uma afirmação numérica.
 */
const PLACA = /\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/gi;

/** As placas escritas neste texto, em caixa alta. */
function placasDoTexto(texto: string): string[] {
  return [...new Set([...texto.matchAll(PLACA)].map((m) => m[1]!.toUpperCase()))];
}

/**
 * As placas que o dossiê autoriza citar.
 *
 * Três fontes, e as três são o que o modelo de fato recebeu: o campo declarado
 * pela ferramenta (`identificadores`), o texto dos fatos — onde a placa é o
 * rótulo da linha —, e o conteúdo de documento e conceito, porque um contrato
 * pode nomear um veículo.
 *
 * **O que não é fonte: os números.** É o ponto inteiro desta separação. Uma
 * placa não se autoriza por coincidir com um valor apurado.
 */
function placasAutorizadas(dossie: Dossie): Set<string> {
  const autorizadas = new Set<string>();
  const registrar = (texto: string | undefined | null) => {
    if (!texto) return;
    for (const placa of placasDoTexto(texto)) autorizadas.add(placa);
  };

  for (const e of dossie.evidencias) {
    for (const id of e.identificadores ?? []) autorizadas.add(id.toUpperCase());
    registrar(e.titulo);
    registrar(e.nota);
    registrar(e.origem);
    for (const f of e.fatos) {
      registrar(f.rotulo);
      registrar(f.valor);
      registrar(f.detalhe);
    }
  }
  for (const d of dossie.documentos) registrar(d.trecho.texto);
  for (const t of dossie.trechos) registrar(t.trecho.texto);
  for (const l of dossie.lacunas) registrar(l.explicacao);
  return autorizadas;
}

/**
 * As placas que o texto afirma e o dossiê não sustenta.
 *
 * **Isto é uma trava nova, e ela aperta.** Antes uma placa inventada só era
 * pega por acaso — quando os dígitos dela não casassem com nenhum valor da
 * tabela. `ZZZ1Z11` passaria num dossiê que tivesse o número 11 em qualquer
 * lugar, e `ZZZ9Z99` reprovava num que não tivesse 99. O veredito dependia de
 * uma coincidência aritmética que não tem nada a ver com a pergunta.
 *
 * Um dossiê com anexo não isenta: um PDF pode conter placas, mas o modelo não
 * pode citá-las sem que a consulta as tenha devolvido — a licença do anexo é
 * sobre número, e um identificador errado aponta para o caminhão errado.
 */
export function identificadoresSemLastro(texto: string, dossie: Dossie): string[] {
  const autorizadas = placasAutorizadas(dossie);
  return placasDoTexto(texto).filter((p) => !autorizadas.has(p));
}

/**
 * Número verdadeiro, afirmação falsa — a classe de erro que sobrava.
 *
 * **O caso que abriu isto.** A rodada 2B produziu, sobre um dossiê perfeito:
 * *"o financiamento de carreta saltou de R$ 8.320,80 para R$ 12.998,65 em duas
 * carretas"*. Toda régua anterior aprovou, e com razão pela pergunta que cada
 * uma faz: `12.998,65` existe no dossiê, é moeda onde o dossiê declarou moeda,
 * e as placas citadas — nenhuma — todas conferem. O que não existe é o
 * **vínculo**: aquele valor é de uma carreta, e a frase o dá a duas. Uma
 * auditoria que repassa esse número contesta o contrato errado.
 *
 * **A régua não tenta entender a frase.** Ela confere duas coisas que se
 * derivam do dossiê sem interpretar português:
 *
 * 1. **Valor de entidade citado longe da entidade dele.** Se um valor só
 *    aparece no dossiê ligado a determinadas placas, e o bloco cita placas mas
 *    nenhuma delas, o vínculo é falso. Um valor que o dossiê nunca ligou a
 *    entidade nenhuma — um total de grupo, uma média — não é opinião desta
 *    régua, porque não há vínculo a violar.
 * 2. **Valor de uma entidade atribuído a várias.** Se o bloco diz "em duas
 *    carretas" e o valor está ligado a uma só, a contagem afirmada não se
 *    sustenta. É exatamente o caso acima, e ele é aritmético: quantas entidades
 *    o dossiê liga a este valor, contra quantas o texto afirma.
 *
 * **O que ela não pega, dito na frente.** Dentro de uma tabela que cita as duas
 * placas, trocar os valores de linha continua passando: as duas placas estão no
 * bloco, e a régua não sabe qual coluna pertence a qual linha. Fechar isso pede
 * que a ferramenta devolva a tupla montada, não que a trava adivinhe o layout.
 */
const CONTAGEM_DE_ENTIDADE =
  /\b(\d{1,3}|um|uma|dois|duas|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\s+(?:carretas?|cavalos?|veiculos?|veículos?|placas?|ativos?|implementos?|conjuntos?)\b/gi;

const POR_EXTENSO: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, "três": 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
};

/**
 * Que placas o dossiê liga a cada valor — construído do **fato**, que é a linha.
 *
 * O par sai de dentro de um fato, e não de dentro de uma evidência: uma
 * evidência é a tabela inteira, e cruzar tudo com tudo dentro dela autorizaria
 * justamente a troca de linha que esta régua existe para pegar. Quando a
 * evidência declara um único identificador, ele vale para os fatos dela — é a
 * consulta que já veio filtrada por veículo.
 */
/**
 * O que conta como **valor** para esta régua: quantia escrita como quantia.
 *
 * `\d[\d.,]*\d` pegaria o `1` de `[1]` e o `1` e o `60` de `RPG1E60` — e um
 * dígito arrancado do meio de uma placa não é um valor que alguém possa
 * atribuir à entidade errada. Restringir à forma monetária brasileira
 * (`8.320,80`) deixa a régua estreita de propósito: é onde mora o risco de
 * auditoria, e é a forma em que o dossiê devolve dinheiro. Contagem e
 * percentual já têm régua própria em `lastro.ts`.
 */
const QUANTIA = /\d{1,3}(?:\.\d{3})*,\d{2}\b/g;

/** O texto sem o que atrapalha ler quantias: marcador de fonte e placa. */
function semRuidoNumerico(texto: string): string {
  return texto.replace(/\[\d{1,2}\]/g, " ").replace(PLACA, " ");
}

function vinculosAutorizados(dossie: Dossie): Map<string, Set<string>> {
  const porValor = new Map<string, Set<string>>();
  const ligar = (valor: string, placas: string[]) => {
    if (placas.length === 0) return;
    const jaTem = porValor.get(valor) ?? new Set<string>();
    for (const p of placas) jaTem.add(p);
    porValor.set(valor, jaTem);
  };

  for (const e of dossie.evidencias) {
    const daEvidencia = (e.identificadores ?? []).map((i) => i.toUpperCase());
    for (const f of e.fatos) {
      const juntos = `${f.rotulo} ${f.valor} ${f.detalhe ?? ""}`;
      const placas = placasDoTexto(juntos);
      /*
        Um fato cujo rótulo é a placa liga os valores dele àquela placa. Um fato
        sem placa nenhuma — "Total do grupo: +R$ 21.905,20/mês" — não liga nada,
        e é assim que um total de grupo fica fora do alcance desta régua.
      */
      const donos = placas.length > 0 ? placas : daEvidencia.length === 1 ? daEvidencia : [];
      for (const m of semRuidoNumerico(juntos).matchAll(QUANTIA)) ligar(m[0]!, donos);
    }
  }
  return porValor;
}

/** Os vínculos que o bloco afirma e o dossiê não sustenta. */
export function vinculosSemLastro(texto: string, dossie: Dossie): string[] {
  const porValor = vinculosAutorizados(dossie);
  if (porValor.size === 0) return [];

  const placasNoTexto = new Set(placasDoTexto(texto));
  const recusados: string[] = [];
  const limpo = semRuidoNumerico(texto);

  /* Regra 2 — a maior contagem de entidades que o bloco afirma. */
  let afirmadas = 0;
  for (const m of limpo.matchAll(CONTAGEM_DE_ENTIDADE)) {
    const bruto = m[1]!.toLowerCase();
    const n = POR_EXTENSO[bruto] ?? Number(bruto);
    if (Number.isFinite(n)) afirmadas = Math.max(afirmadas, n);
  }

  for (const m of limpo.matchAll(QUANTIA)) {
    const escrito = m[0]!;
    const donos = porValor.get(escrito);
    if (!donos || donos.size === 0) continue;

    /* Regra 1 — o bloco nomeia placas, e nenhuma delas é dona deste valor. */
    if (placasNoTexto.size > 0 && ![...donos].some((d) => placasNoTexto.has(d))) {
      recusados.push(
        `${escrito} — o dossiê liga esse valor a ${[...donos].join(", ")}, ` +
          `e não a ${[...placasNoTexto].join(", ")}`,
      );
      continue;
    }

    /* Regra 2 — mais entidades afirmadas do que o dossiê liga a este valor. */
    if (afirmadas > donos.size) {
      recusados.push(
        `${escrito} — a frase atribui esse valor a ${afirmadas}, ` +
          `e o dossiê o liga a ${donos.size}`,
      );
    }
  }
  return [...new Set(recusados)];
}

/**
 * As datas do texto, como datas — e não como três números soltos.
 *
 * `01/08/2026` é uma referência de tempo, não uma quantia apurada. Partida em
 * tokens, ela chegava à conferência como `01`, `08` e `2026`, e os dois
 * primeiros não estão em evidência nenhuma: a resposta inteira era descartada
 * por conter a data da própria vigência que ela descrevia.
 *
 * O que se confere numa data é o **ano**, que é o que a liga ao recorte. Dia e
 * mês não podem contrabandear grandeza: eles são limitados a dois dígitos e
 * vivem dentro de uma forma que nada mais tem.
 */
const DATA = /\b(\d{1,2}\/)?\d{1,2}\/(\d{2}|\d{4})\b/g;

/**
 * Um arredondamento declarado — "cerca de R$ 28,5 mil".
 *
 * É a forma como se escreve para ser entendido, e a trava a tratava como
 * invenção porque `28,5` não está escrito em lugar nenhum. Está: é
 * `28.511,24` dito na escala em que a frase o diz. A conferência é numérica —
 * o valor arredondado na mesma casa tem de bater com algum número que as
 * evidências autorizam —, então "cerca de R$ 90 mil" continua sendo recusado
 * sobre o mesmo dossiê.
 */
const ARREDONDAMENTO = /\b(\d{1,3}(?:[.,]\d{1,2})?)\s*(mil|milhao|milhoes|milhões|bilhao|bilhoes|bilhões)\b/gi;

const ESCALAS: Record<string, number> = {
  mil: 1e3,
  milhao: 1e6, milhoes: 1e6, "milhões": 1e6,
  bilhao: 1e9, bilhoes: 1e9, "bilhões": 1e9,
};

/** "28,5" → 28.5 — o separador decimal deste produto é a vírgula. */
function comoNumero(escrito: string): number {
  return Number(escrito.replace(/\./g, "").replace(",", "."));
}

/**
 * O texto sem o que já foi conferido por outro critério.
 *
 * Devolve o texto com datas e arredondamentos **válidos** removidos, para que a
 * conferência por token — que continua sendo a regra geral — não os veja. Um
 * arredondamento que não bate com nada fica no texto e reprova, como deve.
 */
function semOsJaConferidos(
  texto: string,
  permitidos: Set<string>,
  valores: number[],
): string {
  let saida = texto.replace(ARREDONDAMENTO, (inteiro, escrito: string, escala: string) => {
    const alvo = comoNumero(escrito);
    if (!Number.isFinite(alvo)) return inteiro;
    const fator = ESCALAS[escala.toLowerCase()] ?? 1;
    const casas = (escrito.split(/[.,]/)[1] ?? "").length;
    const potencia = 10 ** casas;
    const bate = valores.some(
      (v) => Math.round((Math.abs(v) / fator) * potencia) / potencia === alvo,
    );
    return bate ? " " : inteiro;
  });

  saida = saida.replace(DATA, (inteiro) => {
    const ano = inteiro.split("/").pop() ?? "";
    const cheio = ano.length === 2 ? `20${ano}` : ano;
    return permitidos.has(cheio) || permitidos.has(ano) ? " " : inteiro;
  });

  return saida;
}

/**
 * Nenhum número sem lastro.
 *
 * Junta tudo o que as evidências autorizam citar — os valores crus e cada
 * número que já aparece escrito nos fatos — e confere o texto contra isso. Um
 * número no texto que não esteja aqui não veio de consulta nenhuma, e é
 * exatamente o que uma aplicação de auditoria não pode exibir.
 *
 * A conferência é por token e não por igualdade numérica de propósito: o modelo
 * cita "28.511,24" como está escrito no fato, e comparar `28511.24 === 28511.24`
 * exigiria reimplementar a formatação pt-BR só para desfazê-la.
 */
/**
 * As citações cujo conteúdo a validação não tem como conferir por número.
 *
 * Um trecho e uma evidência chegam com tudo o que autorizam citar — o texto e a
 * lista de números. Um anexo chega como um PDF: o que ele contém só é conhecido
 * por quem o leu, e não existe lista para comparar. Fingir que existe seria pior
 * que admitir que não existe.
 *
 * A numeração é a de `montarFontes`: trechos, evidências e anexos por último.
 */
function citacoesDeAnexo(dossie: Dossie): Set<number> {
  return new Set(
    itensCitaveis(dossie)
      .filter((i) => i.tipo === "ARQUIVO")
      .map((i) => i.id),
  );
}

/** Quebra o texto em frases, nas mesmas fronteiras que o portão usa. */
function frases(texto: string): string[] {
  return texto.split(/(?<=[.!?])\s+|\n+/).filter((f) => f.trim().length > 0);
}

/**
 * As frases **com o que vem entre elas** — para poder remontar o texto.
 *
 * `frases` serve para conferir; esta serve para reescrever. A diferença é que
 * aqui `join("")` devolve o original byte a byte, o que é o que permite tirar
 * uma frase do meio de uma resposta sem estragar a pontuação e os parágrafos
 * das que ficam.
 */
export function emFrases(texto: string): string[] {
  const saida: string[] = [];
  let inicio = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    const fecha =
      c === "\n" ||
      ((c === "." || c === "!" || c === "?") && /\s/.test(texto[i + 1] ?? " "));
    if (!fecha) continue;
    let j = i + 1;
    while (j < texto.length && /\s/.test(texto[j]!)) j += 1;
    saida.push(texto.slice(inicio, j));
    inicio = j;
    i = j - 1;
  }
  if (inicio < texto.length) saida.push(texto.slice(inicio));
  return saida;
}

/**
 * O que uma unidade de poda é — e por que não é a frase.
 *
 * `emFrases` quebra em `\n`, o que é certo para conferir e errado para
 * remover: **cada linha de uma tabela markdown é uma frase**. Podar a linha de
 * uma placa deixava o cabeçalho, o separador e as outras linhas de pé, e o
 * parágrafo seguinte continuava dizendo "nos dois casos" para um leitor que via
 * um caso. Medido na rodada 2B: 6 respostas com tabela só de cabeçalho.
 *
 * O erro não estava na trava — os números recusados eram mesmo sem lastro. O
 * erro estava em tratar como independente o que é uma afirmação só. Uma linha
 * de tabela não significa nada sem o cabeçalho que nomeia suas colunas, e um
 * bloco de citação não significa nada partido ao meio.
 */
export type TipoDeBloco =
  /** Cabeçalho, separador e linhas: cai inteira ou fica inteira. */
  | "TABELA"
  /** Uma citação `>` de várias linhas — inclusive os `[!info]`. */
  | "CITACAO"
  /** Um item de lista, com as continuações indentadas que pertencem a ele. */
  | "ITEM_DE_LISTA"
  /** Qualquer outra frase — a unidade de antes, preservada. */
  | "FRASE";

export interface Bloco {
  texto: string;
  tipo: TipoDeBloco;
}

/** A linha, sem a indentação, para decidir a que bloco ela pertence. */
function nu(pedaco: string): string {
  return pedaco.trim();
}

const LINHA_DE_TABELA = /^\|/;
const LINHA_DE_CITACAO = /^>/;
const ITEM_DE_LISTA = /^(?:[-*+]|\d{1,3}[.)])\s/;

/**
 * O texto em unidades coerentes de poda. `map(b => b.texto).join("")` devolve o
 * original byte a byte, pela mesma razão que `emFrases` devolve — remontar sem
 * estragar pontuação é o que permite tirar um bloco do meio.
 */
export function emBlocos(texto: string): Bloco[] {
  const pedacos = emFrases(texto);
  const saida: Bloco[] = [];
  let i = 0;

  while (i < pedacos.length) {
    const atual = nu(pedacos[i]!);

    /*
      Tabela: a partir da primeira linha que começa com `|`, todas as seguintes
      que também começam engordam o mesmo bloco. O cabeçalho e o separador
      entram por serem linhas de tabela como as outras — não há caso especial.
    */
    if (LINHA_DE_TABELA.test(atual)) {
      let j = i;
      while (j < pedacos.length && LINHA_DE_TABELA.test(nu(pedacos[j]!))) j += 1;
      saida.push({ texto: pedacos.slice(i, j).join(""), tipo: "TABELA" });
      i = j;
      continue;
    }

    if (LINHA_DE_CITACAO.test(atual)) {
      let j = i;
      while (j < pedacos.length && LINHA_DE_CITACAO.test(nu(pedacos[j]!))) j += 1;
      saida.push({ texto: pedacos.slice(i, j).join(""), tipo: "CITACAO" });
      i = j;
      continue;
    }

    /*
      Item de lista: o item e o que vem colado nele. Uma frase que continua o
      item sem marcador próprio — e sem linha em branco antes — pertence ao
      item, e sair sozinha deixaria a mesma órfã que a linha de tabela deixava.
      Um item novo, uma linha em branco ou um bloco de outro tipo encerram.
    */
    if (ITEM_DE_LISTA.test(atual)) {
      let j = i + 1;
      while (j < pedacos.length) {
        const prox = pedacos[j]!;
        const limpo = nu(prox);
        if (
          limpo.length === 0 ||
          ITEM_DE_LISTA.test(limpo) ||
          LINHA_DE_TABELA.test(limpo) ||
          LINHA_DE_CITACAO.test(limpo) ||
          /\n\s*\n/.test(pedacos[j - 1]!)
        ) {
          break;
        }
        j += 1;
      }
      saida.push({ texto: pedacos.slice(i, j).join(""), tipo: "ITEM_DE_LISTA" });
      i = j;
      continue;
    }

    saida.push({ texto: pedacos[i]!, tipo: "FRASE" });
    i += 1;
  }
  return saida;
}

/**
 * O que fica no lugar do que saiu.
 *
 * **Sumir em silêncio é pior do que recusar.** Quem lê uma resposta com um
 * buraco invisível não sabe que há um buraco: lê o que sobrou como se fosse a
 * resposta inteira, e é assim que "o IPVA subiu ou desceu?" volta sem a palavra
 * "subiu" e ninguém percebe. O marcador devolve ao leitor a informação de que
 * falta algo ali, e por quê.
 *
 * **O marcador não pode citar o que recusou.** Escrever o número que não tinha
 * lastro seria publicá-lo — exatamente o que a trava existe para impedir. Ele
 * diz que houve recusa e de que tipo era o bloco; o número recusado vai para o
 * painel técnico, que é onde se investiga.
 */
function marcadorDe(tipo: TipoDeBloco): string {
  const motivo = "não tem lastro no que foi apurado";
  if (tipo === "TABELA") return `\n_[tabela removida: um valor dela ${motivo}]_\n\n`;
  if (tipo === "CITACAO") return `\n_[destaque removido: um valor dele ${motivo}]_\n\n`;
  if (tipo === "ITEM_DE_LISTA") return `\n_[item removido: um valor dele ${motivo}]_\n`;
  return `_[trecho removido: um valor dele ${motivo}]_ `;
}

export interface Saneamento {
  /** O texto sem as frases que não se sustentam. */
  texto: string;
  /** Quantas frases saíram, e de quantas. */
  removidas: number;
  total: number;
  /** O que fez cada uma sair — para o painel técnico. */
  recusados: string[];
  /** Sobrou pouco demais: o que vale é a redação em código. */
  irrecuperavel: boolean;
}

/**
 * Tira da resposta o que ela não sustenta — e só isso.
 *
 * **O que havia antes.** Um único número sem lastro descartava a resposta
 * inteira. A regra era defensável e o preço era alto e invisível: medido sobre
 * saídas realistas, duas em cada dez respostas eram jogadas fora por causa de
 * uma data de vigência ou de um valor arredondado — texto bom, fiel ao dossiê,
 * substituído por uma redação em código que responde a mesma pergunta com
 * menos. Quanto melhor a redação, maior a chance de ela cair.
 *
 * **O que a garantia sempre foi.** "Nenhum número sem lastro chega à tela" —
 * uma afirmação sobre o que a pessoa lê, não sobre o tamanho da unidade
 * descartada. Tirar a frase que não se sustenta cumpre a promessa por inteiro,
 * e é a única leitura em que o custo do erro é proporcional a ele.
 *
 * **Quando ainda se descarta tudo.** Quando o que sai passa de um terço das
 * frases. Aí o problema não é um número: é uma resposta construída sobre
 * material que não existe, e remendá-la produziria um texto que não conclui o
 * que começou a dizer.
 */
export function sanear(texto: string, dossie: Dossie): Saneamento {
  const blocos = emBlocos(texto);
  // Uma travessia do dossiê para o texto inteiro, e não uma por frase.
  const tipadas = autorizacoesTipadas(dossie);
  const mantidas: string[] = [];
  const recusados: string[] = [];
  let removidas = 0;
  let charsRemovidos = 0;

  for (const bloco of blocos) {
    const pedaco = bloco.texto;
    const semLastro = numerosSemLastro(pedaco, dossie);
    const semFonte = citacoesSemFonte(pedaco, dossie);
    /*
      A terceira régua: identificador. Ver `identificadoresSemLastro` — uma placa
      que não voltou de consulta aponta para o caminhão errado, e isso não é
      menos grave que um número inventado.
    */
    const semIdentidade = identificadoresSemLastro(pedaco, dossie);
    /*
      A quarta régua: **tipo**. Ver `lastro.ts` — o dossiê que apurou `62
      veículos` não autoriza a frase `62%`, e o que apurou `R$ 52.500` não
      autoriza `52.500 veículos`. Ela é a última porque é a mais estreita: só
      opina sobre número com tipo declarado no próprio texto, e as três de cima
      já decidiram tudo o mais.
    */
    const semTipo = afirmacoesSemLastro(pedaco, tipadas);
    /*
      A quinta régua: **afirmação composta**. Ver `lastro.ts` — o dossiê que
      apurou `12.998,65` para uma placa não autoriza a frase que dá esse valor a
      outra. É a régua que fecha o buraco de "número verdadeiro, afirmação
      falsa", e ela é a última porque precisa que as quatro de cima já tenham
      aceito cada número isoladamente.
    */
    const semVinculo = vinculosSemLastro(pedaco, dossie);
    if (
      semLastro.length === 0 &&
      semFonte.length === 0 &&
      semIdentidade.length === 0 &&
      semTipo.length === 0 &&
      semVinculo.length === 0
    ) {
      mantidas.push(pedaco);
      continue;
    }
    recusados.push(...semLastro, ...semFonte, ...semIdentidade, ...semTipo, ...semVinculo);
    removidas += 1;
    charsRemovidos += pedaco.trim().length;
    /*
      O marcador entra no lugar do bloco, e não depois de todos: é a posição
      dele que diz ao leitor **onde** falta coisa. Sem isso o texto remontado
      parece íntegro, que é o defeito que esta mudança existe para fechar.
    */
    mantidas.push(marcadorDe(bloco.tipo));
  }

  const total = blocos.length;
  const saneado = mantidas.join("").trim();
  /*
    O teto de descarte passa a ser medido em **texto**, não em contagem de
    unidades. Com a poda por bloco uma tabela de seis linhas virou uma unidade
    só, e um teto por unidade descartaria a resposta inteira sempre que a
    tabela caísse numa resposta curta — trocando a tabela vazia pelo despejo de
    fallback, que é estritamente pior. Um terço continua sendo um terço; o que
    muda é a régua com que se mede o terço.
  */
  const charsTotais = blocos.reduce((a, b) => a + b.texto.trim().length, 0);
  return {
    texto: saneado,
    removidas,
    total,
    recusados: [...new Set(recusados)],
    irrecuperavel: saneado.length === 0 || charsRemovidos * 3 > charsTotais,
  };
}

/**
 * Nenhum número sem lastro — **e o que fazer quando o lastro é um documento.**
 *
 * Sem anexo, nada muda: todo número do texto é conferido contra o conjunto que
 * as evidências autorizam. Com anexo, a frase que **cita o anexo** fica de fora
 * da conferência numérica, e só ela.
 *
 * Isto não é um furo aberto na trava; é o único desenho que mantém a promessa
 * quando a fonte é um arquivo. A promessa nunca foi "todo número foi conferido
 * por nós" — foi "todo número é conferível por quem lê". Um número que sai de
 * uma consulta é conferível contra a evidência ao lado; um número que sai do
 * contrato é conferível abrindo o contrato, que está numerado nas fontes e a um
 * clique na tela do Book. O que continua proibido é o número **sem** citação, que
 * é o caso em que quem lê não tem para onde ir — e esse segue sendo descartado.
 */
/**
 * O que o dossiê **declarou** sobre cada grandeza — para a régua por tipo.
 *
 * Percorre exatamente as mesmas fontes que `numerosSemLastro` percorre para
 * montar os tokens permitidos. Uma segunda travessia, escrita à parte, sairia
 * de sincronia no primeiro campo novo — e as duas leriam dossiês diferentes
 * achando que leem o mesmo.
 */
export function autorizacoesTipadas(dossie: Dossie): Autorizacoes {
  const saida: Autorizacoes = { percentual: [], moeda: [], contagem: [] };
  const ler = (texto: string | undefined | null) => {
    if (texto) autorizacoesDoTexto(String(texto), saida);
  };

  for (const e of dossie.evidencias) {
    ler(e.titulo);
    ler(e.nota);
    ler(e.origem);
    for (const f of e.fatos) {
      /*
        O rótulo entra junto do valor, colados, porque é o rótulo que diz o que
        o número conta: "Alterações" + "267" é uma contagem, e nenhum dos dois
        sozinho declara isso. A ordem é `valor rotulo` para a adjacência —
        "267 alterações" — que é a forma que o classificador lê.
      */
      ler(`${f.valor} ${f.rotulo}`);
      ler(f.valor);
      ler(f.detalhe);
    }
  }
  for (const t of dossie.trechos) ler(t.trecho.texto);
  for (const d of dossie.documentos) ler(d.trecho.texto);
  for (const l of dossie.lacunas) ler(l.explicacao);
  return saida;
}

export function numerosSemLastro(texto: string, dossie: Dossie): string[] {
  /*
    O marcador de citação não é uma afirmação numérica.

    `[10]` é "a décima fonte", não a quantia dez. Sem tirá-lo daqui, a própria
    instrução de citar produziria respostas descartadas por número sem lastro a
    partir da décima fonte — um defeito que só apareceria em respostas ricas,
    que são exatamente as que mais interessam.
  */
  /*
    Com anexo no dossiê, a conferência passa a ser por frase — porque a licença
    é por frase. Sem anexo, o caminho é o de sempre, sobre o texto inteiro: um
    dossiê sem arquivo não tem frase isenta, e dividir em frases só criaria uma
    diferença de comportamento onde não há diferença de regra.
  */
  const deAnexo = citacoesDeAnexo(dossie);
  if (deAnexo.size > 0) {
    const semLastro: string[] = [];
    for (const frase of frases(texto)) {
      const citadas = (frase.match(/\[\d{1,2}\]/g) ?? []).map((c) => Number(c.slice(1, -1)));
      if (citadas.some((n) => deAnexo.has(n))) continue;
      semLastro.push(...numerosSemLastro(frase, { ...dossie, anexos: [] }));
    }
    return semLastro;
  }

  /*
    A placa sai do texto antes da extração numérica — **autorizada ou não**.

    Uma string com a forma de placa não é uma afirmação numérica em nenhum dos
    dois casos, e quem decide sobre ela é `identificadoresSemLastro`. Deixar a
    placa não autorizada aqui produziria a recusa certa pelo motivo errado: a
    resposta seria podada por "99", e quem lesse o painel técnico procuraria um
    valor de noventa e nove reais que não existe em lugar nenhum. Uma régua por
    tipo de afirmação, e o motivo da recusa dito com o nome certo.

    O que isto **não** afrouxa: a placa inventada continua derrubando a frase,
    pela outra trava, e agora sempre — antes ela dependia de os dígitos dela não
    coincidirem por acaso com algum valor apurado.
  */
  const semPlacas = texto.replace(PLACA, " ");
  const semCitacoes = semPlacas.replace(/\[\d{1,2}\]/g, " ");
  const permitidos = new Set<string>();
  /** Os mesmos números como grandeza, para conferir arredondamento. */
  const valores: number[] = [];

  const registrar = (valor: string | number | undefined | null) => {
    if (valor === undefined || valor === null) return;
    for (const token of numerosDoTexto(String(valor))) {
      permitidos.add(token);
      // A mesma grandeza sem separador de milhar, para o caso de o modelo
      // reescrever "28.511,24" como "28511,24".
      permitidos.add(token.replace(/\./g, ""));
    }
  };

  for (const e of dossie.evidencias) {
    registrar(e.titulo);
    registrar(e.nota);
    registrar(e.origem);
    for (const n of e.numeros) {
      valores.push(n);
      registrar(n);
      registrar(n.toLocaleString("pt-BR"));
      registrar(n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
      registrar(Math.abs(n));
      registrar(Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    }
    for (const f of e.fatos) {
      registrar(f.rotulo);
      registrar(f.valor);
      registrar(f.detalhe);
    }
    if (e.recorte) {
      registrar(e.recorte.vigencia);
      registrar(e.recorte.intervalo);
      registrar(e.recorte.contexto);
    }
  }
  for (const t of dossie.trechos) {
    registrar(t.trecho.texto);
    registrar(t.trecho.titulo);
  }
  /*
    Os números do Book têm lastro: eles estão escritos no documento.

    Este é o efeito mais importante de o conteúdo do Book entrar no dossiê como
    texto. Antes, um documento chegava como anexo — um arquivo que a trava não
    tinha como conferir —, e a licença precisava ser dada por frase, a quem
    citasse o anexo. Uma resposta que transcrevesse a tabela de critérios em
    lista, com a citação só na última linha, era descartada inteira. Agora o
    texto que o modelo leu está no dossiê, e conferir "bimestral" ou "R$ 1.234"
    contra ele é a mesma operação de sempre: procurar o token na evidência.
  */
  for (const d of dossie.documentos) {
    registrar(d.trecho.texto);
    registrar(d.trecho.bloco);
    registrar(d.trecho.secao ?? "");
  }
  for (const l of dossie.lacunas) registrar(l.explicacao);

  return numerosDoTexto(semOsJaConferidos(semCitacoes, permitidos, valores)).filter((token) => {
    if (permitidos.has(token) || permitidos.has(token.replace(/\./g, ""))) return false;
    // Um algarismo isolado é numeração de lista ou ordinal, não afirmação.
    if (token.length === 1) return false;
    return true;
  });
}

/**
 * Citações que apontam para fonte que não existe.
 *
 * A numeração vem de `montarFontes`: trechos primeiro, evidências depois. Uma
 * resposta que escreve `[4]` com três fontes no dossiê está oferecendo à pessoa
 * um lugar para conferir que não existe — e conferir é a única coisa que a
 * citação promete. Vale a mesma regra dos números: a resposta é descartada
 * inteira, porque o texto foi construído em cima daquela suposta fonte.
 */
export function citacoesSemFonte(texto: string, dossie: Dossie): string[] {
  const quantas = itensCitaveis(dossie).length;
  const citadas: string[] = texto.match(/\[\d{1,2}\]/g) ?? [];
  return [
    ...new Set(
      citadas.filter((c) => {
        const n = Number(c.slice(1, -1));
        return n < 1 || n > quantas;
      }),
    ),
  ];
}

/** O contexto que esta resposta descreve — para a tela dizê-lo. */
export function recorteDoDossie(dossie: Dossie): string | null {
  const comRecorte = dossie.evidencias.find((e) => e.recorte);
  if (comRecorte?.recorte) {
    const r = comRecorte.recorte;
    return r.vigencia ? `${r.contexto} · ${r.vigencia}` : r.contexto;
  }
  return dossie.plano.contexto?.info.label ?? null;
}

/** O nome legível da vigência resolvida, quando houve uma. */
export function vigenciaDoDossie(dossie: Dossie): string | null {
  return dossie.plano.periodo ? rotuloDoPeriodo(dossie.plano.periodo) : null;
}

/** Só para os testes de isolamento: os contextos citados em qualquer evidência. */
export function contextosCitados(dossie: Dossie): string[] {
  return [
    ...new Set(
      dossie.evidencias
        .map((e) => e.recorte?.contexto)
        .filter((c): c is string => Boolean(c))
        .map(normalizar),
    ),
  ];
}
