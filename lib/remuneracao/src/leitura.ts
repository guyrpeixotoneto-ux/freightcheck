import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ContextNotFoundError,
  aplicarJanela,
  channelSql,
  contextFilter,
  listContexts,
  periodLabel,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "@workspace/comparison";
import {
  CODIGOS_DO_CAVALO,
  CODIGOS_DO_TRECHO,
  COLUNA,
  TIPO_CAVALO,
  TIPO_TRECHO,
} from "./colunas";
import type { CavaloDaVigencia, TrechoDaVigencia } from "./medicao";
import { montarCadastro, type CadastroMontado } from "./montagem";
import {
  canaisComPlanilha,
  chaveDaPlanilha,
  copiarPlanilha,
  gravarPlanilha,
  lerPlanilha,
  lerPlanilhasEmLote,
  type PlanilhaDaVigencia,
} from "./planilha";
import type { PlanilhaDeclarada } from "./informado";
import { compararCadastros, type CadastroComparado } from "./comparacao";
import { medirSituacao, type EstadoDoCadastro, type SituacaoDoCadastro } from "./situacao";

/**
 * A leitura do acervo da Auditoria — a única parte deste módulo que vai ao
 * banco.
 *
 * Quatro consultas, e **nenhuma delas por ativo nem por unidade**: a mesma
 * escolha de `lerVigencia` em `@workspace/composition`, pela mesma razão — uma
 * consulta por cavalo daria sessenta idas ao banco para desenhar uma aba de
 * cadastro, e uma por unidade daria trinta para desenhar a lista que vem antes
 * dela. São quatro e não três porque a frota precisa de duas: uma para os fatos
 * de `ativo` e outra para **quem existe**, que é maior — ver
 * `lerCavalosEmLote`.
 *
 * As quatro recebem uma lista de {@link Alvo} — pares (unidade, vigência) — em
 * vez de uma unidade e uma data. Com um alvo, respondem o cadastro de uma
 * unidade; com todos, a lista das unidades. É um SQL só nos dois casos, e é o
 * que garante que a lista e a tela nunca discordem sobre o que a unidade
 * entregou.
 *
 * **Por que este módulo lê os fatos direto, e não pela Composição.** A
 * Composição responde "quanto este equipamento recebe", e para isso passa cada
 * número pelo portão da semântica: só entra no total o que a curadoria já
 * confirmou como monetário, somável e com periodicidade. O cadastro pergunta
 * outra coisa — quantos veículos estão ativos, qual a alíquota do trecho —, e
 * nenhuma dessas respostas é um total de remuneração. Passá-las pelo portão do
 * total as excluiria por não serem dinheiro, que é justamente o certo para lá e
 * o errado para cá.
 *
 * O que **não** muda é a régua: as duas consultas abaixo respeitam
 * `contextFilter` — unidade, canal e janela — como todas as leituras do
 * produto, e nenhuma delas inventa um valor onde o fato é nulo. `is_null`
 * verdadeiro devolve `null`, e é a montagem que decide o que dizer sobre isso.
 */

export interface VigenciaDoCadastro {
  effectiveDate: string;
  periodLabel: string;
}

export interface ContextoDoCadastro {
  scopeHash: string;
  channel: string | null;
  label: string;
  unidade: string | null;
  scopes: { scopeType: string; code: string; name: string | null }[];
}

/** Quantos cavalos e trechos a vigência entregou — o lastro, em números. */
export interface MaterialLido {
  cavalos: number;
  trechos: number;
  trechosEntregues: boolean;
  /**
   * Quantas linhas alguém informou à mão nesta vigência.
   *
   * Fica ao lado dos dois números do acervo de propósito: as três respondem à
   * mesma pergunta — **quanto desta tela tem lastro, e de que tipo** — e
   * separá-las em outro campo faria a tela ter de decidir sozinha se um cadastro
   * com trinta linhas informadas e nenhum arquivo importado está "em dia".
   */
  linhasInformadas: number;
}

export interface CadastroDaUnidade extends CadastroMontado {
  contexto: ContextoDoCadastro;
  effectiveDate: string;
  periodLabel: string;
  /** Todas as vigências desta unidade, para o seletor. */
  vigencias: VigenciaDoCadastro[];
  material: MaterialLido;
}

/** Uma ponta da comparação: a quinzena e o que ela entregou. */
export interface PontaDaComparacao {
  effectiveDate: string;
  periodLabel: string;
  material: MaterialLido;
}

export interface ComparacaoDeCadastros extends CadastroComparado {
  contexto: ContextoDoCadastro;
  /** A quinzena mais antiga do par — a coluna da esquerda. */
  esquerda: PontaDaComparacao;
  /** A mais recente — a coluna da direita, e a que a variação descreve. */
  direita: PontaDaComparacao;
  vigencias: VigenciaDoCadastro[];
}

/**
 * Uma unidade na lista, com o que o cadastro dela alcança na vigência mais
 * recente que ela entregou.
 *
 * A vigência é sempre a mais recente, e não uma escolhida por quem chama: a
 * pergunta desta lista é "o cadastro desta unidade está de pé **hoje**", e
 * responder por uma quinzena antiga faria a unidade que parou de entregar
 * parecer em dia. Qual quinzena respondeu está em `effectiveDate`, ao lado da
 * resposta, para que a lista nunca escolha em silêncio.
 */
export interface SituacaoDaUnidade extends ContextoDoCadastro {
  /** A vigência mais recente da unidade — a que esta situação descreve. */
  effectiveDate: string;
  periodLabel: string;
  /** Quantas vigências a unidade tem no acervo, todas elas. */
  vigencias: number;
  material: MaterialLido;
  cadastro: SituacaoDoCadastro;
}

export interface SituacaoDasUnidades {
  unidades: SituacaoDaUnidade[];
  /**
   * Quantas unidades em cada estado — os quatro somam `unidades`.
   *
   * Somados aqui, e não na tela, pela mesma razão que os totais do Fechamento
   * vêm do servidor: uma contagem feita na interface é uma segunda conta sobre
   * o mesmo material, e as duas divergem no dia em que um estado novo nascer.
   */
  resumo: {
    unidades: number;
    frotaEAliquotas: number;
    soFrota: number;
    soAliquotas: number;
    semLastro: number;
  };
}

/** Erro de recusa: a vigência pedida não existe nesta unidade. Rota traduz em 404. */
export class VigenciaDoCadastroNaoEncontrada extends Error {
  constructor(pedida: string, disponiveis: string[]) {
    super(
      `A vigência pedida (${pedida}) não existe nesta unidade. ` +
        `Disponíveis: ${disponiveis.join(", ") || "nenhuma"}.`,
    );
    this.name = "VigenciaDoCadastroNaoEncontrada";
  }
}

/**
 * Erro de recusa: esta unidade só entregou uma vigência. Rota traduz em 422.
 *
 * Não é 404 — a unidade existe e o cadastro dela também. O que não existe é o
 * par, e responder 404 mandaria quem está olhando procurar uma unidade que está
 * bem ali. Também não é 400: o pedido está correto, o acervo é que ainda não
 * tem duas quinzenas.
 */
export class ComparacaoSemDuasVigencias extends Error {
  constructor(unidade: string, disponiveis: string[]) {
    super(
      `Comparar duas quinzenas exige duas vigências, e ${unidade} entregou ` +
        `${disponiveis.length === 0 ? "nenhuma" : "uma só"}` +
        `${disponiveis.length === 1 ? ` (${disponiveis[0]})` : ""}. ` +
        "Importe a quinzena seguinte para ver as duas lado a lado.",
    );
    this.name = "ComparacaoSemDuasVigencias";
  }
}

export { ContextNotFoundError };

/**
 * As unidades e canais que este módulo conhece — o acervo **mais** a planilha.
 *
 * `listContexts` responde "quem entregou vigência", e essa era a lista inteira
 * enquanto o cadastro só lia o acervo. Com a planilha informada ela deixou de
 * ser: a aba de Excel de um canal existe antes do export dele, e é justamente
 * nesse intervalo que digitá-la vale a pena. Uma unidade que só entregou
 * `EMPURRADA` pode ter uma planilha de `ROTA` — e, lida só pelo acervo, essa
 * planilha ficaria gravada e sem tela nenhuma que a mostrasse.
 *
 * **O que o canal só-da-planilha herda, e o que ele não herda.** Herda a
 * unidade: escopo, rótulo e as vigências são os da unidade, porque é a mesma
 * unidade — o canal descreve a operação, não outro cliente. Não herda material
 * nenhum: `lerCavalosEmLote` e `lerTrechosEmLote` filtram por canal e devolvem
 * vazio, então todas as trinta linhas nascem sem lastro e só o que foi digitado
 * tem número. É a resposta certa: o acervo de fato não diz nada sobre aquele
 * canal.
 *
 * **Por que a unidade tem de existir no acervo mesmo assim.** Porque o escopo
 * é dela: sem uma série importada não há `scope_hash`, não há CNPJ e não há
 * rótulo — a planilha ficaria pendurada num identificador que ninguém sabe ler.
 * Canal novo em unidade conhecida é declaração; unidade nova é importação.
 */
async function contextosDoModulo(db: Database): Promise<ContextInfo[]> {
  const [doAcervo, daPlanilha] = await Promise.all([listContexts(db), canaisComPlanilha(db)]);
  if (daPlanilha.length === 0) return doAcervo;

  const jaExiste = new Set(doAcervo.map((c) => chaveDoAlvo(c.scopeHash, c.channel)));
  const irmaoDoEscopo = new Map<string, ContextInfo>();
  for (const c of doAcervo) if (!irmaoDoEscopo.has(c.scopeHash)) irmaoDoEscopo.set(c.scopeHash, c);

  const sinteticos: ContextInfo[] = [];
  for (const canal of daPlanilha) {
    if (jaExiste.has(chaveDoAlvo(canal.scopeHash, canal.canal))) continue;
    const irmao = irmaoDoEscopo.get(canal.scopeHash);
    /*
      Sem irmão, a unidade saiu do acervo depois de a planilha ser gravada — uma
      importação excluída, por exemplo. A planilha continua no banco e some da
      lista, e é o comportamento certo: o rótulo e o escopo dela viviam na
      série que deixou de existir, e inventá-los aqui seria escrever um nome de
      unidade que nenhum arquivo sustenta.
    */
    if (!irmao) continue;
    sinteticos.push({
      ...irmao,
      channel: canal.canal,
      label: rotuloComCanal(irmao, canal.canal),
    });
  }

  return [...doAcervo, ...sinteticos];
}

/**
 * O rótulo da unidade com outro canal — "CAMAÇARI · ROTA".
 *
 * O rótulo do irmão vem como "CAMAÇARI · EMPURRADA", e trocar o canal exige
 * cortar o que veio depois do separador. Quando o irmão não tem canal, o
 * rótulo é só o da unidade e o canal entra depois dele.
 */
function rotuloComCanal(irmao: ContextInfo, canal: string | null): string {
  const daUnidade = irmao.channel === null ? irmao.label : irmao.label.split(" · ")[0]!;
  return canal === null ? daUnidade : `${daUnidade} · ${canal}`;
}

/** As unidades que já entregaram vigência, e os canais que só a planilha tem. */
export function listarUnidades(db: Database): Promise<ContextInfo[]> {
  return contextosDoModulo(db);
}

/**
 * O cadastro de uma unidade numa vigência.
 *
 * `null` quando o acervo não tem nenhuma unidade — a rota traduz na frase que
 * aponta para Importações. Unidade pedida e inexistente é
 * `ContextNotFoundError`; vigência pedida e inexistente é
 * {@link VigenciaDoCadastroNaoEncontrada}. Recusa escrita, nunca cadastro
 * vazio: as trinta linhas em branco de um contexto que não existe são
 * indistinguíveis das trinta linhas em branco de uma vigência sem dados, e as
 * duas situações pedem coisas diferentes de quem está olhando.
 */
export async function lerCadastroDaUnidade(
  db: Database,
  pedido?: RequestedContext & {
    period?: string;
    /**
     * Aceitar um canal que ainda não existe, desde que a unidade exista.
     *
     * Só a **tela que cadastra a planilha** pede assim, e ela precisa: é o
     * lugar onde o canal nasce. Abrir o formulário de `ROTA` numa unidade que
     * só entregou `EMPURRADA` tem de mostrar as trinta linhas em branco para
     * que alguém possa preenchê-las — recusar antes de a primeira célula ser
     * digitada tornaria a escrita, que já aceita o canal novo, inalcançável.
     *
     * Fora dela o padrão continua sendo recusar, e é o certo: um canal digitado
     * errado num link tem de responder 404, e não um cadastro vazio que se
     * parece com uma unidade que perdeu o lastro.
     */
    aceitarCanalNovo?: boolean;
  },
): Promise<CadastroDaUnidade | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const contexto = pedido?.aceitarCanalNovo
    ? await resolverParaEscrita(db, contextos, pedido)
    : (await resolveContext(db, pedido, contextos))!;
  const effectiveDate = conferirVigencia(contexto, pedido?.period ?? contexto.latestPeriod);
  const { montado, material } = await montarDaVigencia(db, effectiveDate, contexto);

  return {
    ...montado,
    contexto: retratoDo(contexto),
    effectiveDate,
    periodLabel: periodLabel(effectiveDate),
    vigencias: vigenciasDe(contexto),
    material,
  };
}

/**
 * Duas quinzenas da mesma unidade, lado a lado.
 *
 * É a forma da planilha: a aba de cadastro traz os dois blocos um ao lado do
 * outro, e quem confere lê as duas colunas juntas. Sem pedido explícito, o par
 * são as **duas vigências mais recentes** da unidade — que é o que a pessoa
 * quer ver ao abrir, e é o par que a planilha do mês corrente mostra.
 *
 * A ordem é sempre cronológica, e não a ordem em que o pedido chegou: a coluna
 * da esquerda é a mais antiga, a da direita a mais nova, e a variação descreve
 * o caminho de uma para a outra. Aceitar o par invertido faria a mesma tela
 * dizer "subiu 8%" e "desceu 7,4%" sobre o mesmo movimento, conforme a ordem em
 * que alguém clicou nos seletores.
 *
 * `null` quando o acervo não tem unidade nenhuma; recusa escrita quando a
 * unidade só tem uma vigência ({@link ComparacaoSemDuasVigencias}) ou quando
 * uma das pontas pedidas não existe ({@link VigenciaDoCadastroNaoEncontrada}).
 */
export async function lerComparacaoDeCadastros(
  db: Database,
  pedido?: RequestedContext & { de?: string; ate?: string },
): Promise<ComparacaoDeCadastros | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const contexto = (await resolveContext(db, pedido, contextos))!;
  const disponiveis = contexto.periodosDisponiveis;
  if (disponiveis.length < 2) {
    throw new ComparacaoSemDuasVigencias(contexto.label, disponiveis);
  }

  /*
    O padrão são as duas últimas, nesta ordem. `periodosDisponiveis` já vem da
    mais antiga para a mais nova, então as duas últimas posições são o par
    cronológico sem nenhum `sort` a mais.
  */
  const padraoEsquerda = disponiveis[disponiveis.length - 2];
  const padraoDireita = disponiveis[disponiveis.length - 1];

  const pedidas = [
    conferirVigencia(contexto, pedido?.de ?? padraoEsquerda),
    conferirVigencia(contexto, pedido?.ate ?? padraoDireita),
  ].sort();
  const [dataEsquerda, dataDireita] = pedidas;

  const [esquerda, direita] = await Promise.all([
    montarDaVigencia(db, dataEsquerda, contexto),
    montarDaVigencia(db, dataDireita, contexto),
  ]);

  return {
    ...compararCadastros(esquerda.montado, direita.montado),
    contexto: retratoDo(contexto),
    esquerda: {
      effectiveDate: dataEsquerda,
      periodLabel: periodLabel(dataEsquerda),
      material: esquerda.material,
    },
    direita: {
      effectiveDate: dataDireita,
      periodLabel: periodLabel(dataDireita),
      material: direita.material,
    },
    vigencias: vigenciasDe(contexto),
  };
}

/**
 * As unidades do acervo, cada uma com o que o cadastro dela alcança hoje.
 *
 * É a tela que vem **antes** do cadastro: quem abre Remuneração na virada da
 * quinzena não quer uma unidade — quer saber quais já estão de pé e quais
 * ainda não. Sem esta leitura, descobrir que um CDD entregou a frota e não
 * entregou os trechos custa abrir o CDD, e com trinta unidades custa abrir
 * trinta telas para achar as duas que faltam.
 *
 * **Quatro consultas, e não quatro por unidade.** Cada uma responde por todas
 * as unidades de uma vez, pelo par (unidade, vigência mais recente) que
 * {@link filtroDosAlvos} monta — a mesma decisão de `lerCavalosEmLote`,
 * escalada de "não uma consulta por cavalo" para "não um cadastro por
 * unidade". O trabalho
 * de montagem continua sendo o de trinta unidades, porque é ele que garante que
 * a lista e a tela do cadastro digam a mesma coisa: quem responde "esta linha
 * tem lastro" nos dois lugares é a mesma `montarCadastro`.
 *
 * Acervo vazio devolve lista vazia e resumo zerado, e não `null`: aqui não há
 * unidade pedida que possa não existir — a pergunta é sobre o conjunto, e o
 * conjunto vazio é uma resposta legítima que a tela sabe escrever.
 */
export async function lerSituacaoDasUnidades(db: Database): Promise<SituacaoDasUnidades> {
  const contextos = await contextosDoModulo(db);
  const alvos: Alvo[] = contextos.map((contexto) => ({
    contexto,
    effectiveDate: contexto.latestPeriod,
  }));

  const [cavalos, trechos, entregues, planilhas] = await Promise.all([
    lerCavalosEmLote(db, alvos),
    lerTrechosEmLote(db, alvos),
    serieEntregueEmLote(db, TIPO_TRECHO, alvos),
    lerPlanilhasEmLote(
      db,
      alvos.map((alvo) => ({
        scopeHash: alvo.contexto.scopeHash,
        canal: alvo.contexto.channel,
        effectiveDate: alvo.effectiveDate,
      })),
    ),
  ]);

  const unidades = contextos.map((contexto): SituacaoDaUnidade => {
    const chave = chaveDoAlvo(contexto.scopeHash, contexto.channel);
    const { montado, material } = materialDe(
      cavalos.get(chave) ?? [],
      trechos.get(chave) ?? [],
      entregues.has(chave),
      planilhas.get(
        chaveDaPlanilha(contexto.scopeHash, contexto.channel, contexto.latestPeriod),
      ),
    );
    return {
      ...retratoDo(contexto),
      effectiveDate: contexto.latestPeriod,
      periodLabel: periodLabel(contexto.latestPeriod),
      vigencias: contexto.periods,
      material,
      cadastro: medirSituacao(montado),
    };
  });

  const quantas = (estado: EstadoDoCadastro) =>
    unidades.filter((u) => u.cadastro.estado === estado).length;

  return {
    unidades,
    resumo: {
      unidades: unidades.length,
      frotaEAliquotas: quantas("FROTA_E_ALIQUOTAS"),
      soFrota: quantas("SO_FROTA"),
      soAliquotas: quantas("SO_ALIQUOTAS"),
      semLastro: quantas("SEM_LASTRO"),
    },
  };
}

/**
 * A planilha informada de uma unidade numa vigência — o que a tela de cadastro
 * edita.
 *
 * Resolve o contexto e confere a vigência pelo mesmo caminho das leituras
 * acima, e por isso recusa pelas mesmas classes: unidade que não existe é
 * `ContextNotFoundError`, vigência que a unidade não entregou é
 * {@link VigenciaDoCadastroNaoEncontrada}. Uma escrita que aceitasse qualquer
 * data criaria planilha para uma quinzena que nenhuma tela mostra — dado que
 * ninguém encontra depois, e que ninguém sabe que existe.
 */
export async function lerPlanilhaDaUnidade(
  db: Database,
  pedido?: RequestedContext & { period?: string },
): Promise<PlanilhaDaVigencia | null> {
  const alvo = await resolverAlvoDaPlanilha(db, pedido);
  if (alvo === null) return null;
  return lerPlanilha(db, alvo);
}

/**
 * Grava a planilha informada de uma unidade numa vigência.
 *
 * As trinta linhas de uma aba são um ato só — ver `gravarPlanilha`. Aqui a
 * responsabilidade é outra e é anterior: garantir que a unidade e a vigência
 * existem antes de qualquer escrita, para que a planilha só possa ser
 * preenchida onde ela vai ser lida.
 */
export async function gravarPlanilhaDaUnidade(
  db: Database,
  pedido: RequestedContext & {
    period?: string;
    celulas: { chave: unknown; valor: unknown; observacao?: unknown }[];
    autor?: { id: string | null; nome: string | null };
  },
): Promise<PlanilhaDaVigencia | null> {
  const alvo = await resolverAlvoDaPlanilha(db, pedido);
  if (alvo === null) return null;
  return gravarPlanilha(db, {
    ...alvo,
    celulas: pedido.celulas,
    ...(pedido.autor ? { autor: pedido.autor } : {}),
  });
}

/**
 * Copia a planilha de uma vigência da unidade para outra.
 *
 * As duas pontas são conferidas contra a lista de vigências daquela unidade,
 * pela mesma razão da escrita — e a de origem tanto quanto a de destino: copiar
 * de uma quinzena que a unidade não tem devolveria "nada a copiar" em silêncio,
 * quando o que aconteceu foi um endereço errado.
 */
export async function copiarPlanilhaDaUnidade(
  db: Database,
  pedido: RequestedContext & {
    de: string;
    para: string;
    autor?: { id: string | null; nome: string | null };
  },
): Promise<PlanilhaDaVigencia | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const contexto = await resolverParaEscrita(db, contextos, pedido);
  return copiarPlanilha(db, {
    scopeHash: contexto.scopeHash,
    canal: contexto.channel,
    de: conferirVigencia(contexto, pedido.de),
    para: conferirVigencia(contexto, pedido.para),
    ...(pedido.autor ? { autor: pedido.autor } : {}),
  });
}

/** A unidade e a vigência de um pedido de planilha, já conferidas. */
async function resolverAlvoDaPlanilha(
  db: Database,
  pedido?: RequestedContext & { period?: string },
): Promise<{ scopeHash: string; canal: string | null; effectiveDate: string } | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const contexto = await resolverParaEscrita(db, contextos, pedido);
  return {
    scopeHash: contexto.scopeHash,
    canal: contexto.channel,
    effectiveDate: conferirVigencia(contexto, pedido?.period ?? contexto.latestPeriod),
  };
}

/**
 * O contexto de uma **escrita** de planilha — e a única regra em que ele é mais
 * permissivo que o de uma leitura.
 *
 * Numa leitura, um canal que não existe é um pedido por algo que não existe, e
 * `resolveContext` recusa. Numa escrita, é o gesto de **criar** a planilha
 * daquele canal: a aba de ROTA existe antes de o export de ROTA chegar, e
 * exigir a série importada antes de aceitar a aba inverteria a ordem em que a
 * operação de fato acontece — a planilha é o que se recebe primeiro.
 *
 * O que continua sendo exigido é a **unidade**: o escopo, o CNPJ e o rótulo são
 * dela, e sem uma série importada nada disso existe. Canal novo em unidade
 * conhecida é declaração; unidade nova é importação, e continua 404.
 *
 * As vigências oferecidas ao canal novo são as da unidade, herdadas do irmão —
 * é a resposta certa: a quinzena é do calendário do cliente, não da série.
 */
async function resolverParaEscrita(
  db: Database,
  contextos: ContextInfo[],
  pedido?: RequestedContext,
): Promise<ContextInfo> {
  const canalPedido = pedido?.channel;
  const escopoPedido = pedido?.scopeHash;

  const exato = contextos.find(
    (c) =>
      (escopoPedido === undefined || c.scopeHash === escopoPedido) &&
      (canalPedido === undefined || c.channel === canalPedido),
  );
  if (exato) return aplicarJanela(exato, pedido?.janela ?? null);

  const irmao =
    escopoPedido === undefined ? undefined : contextos.find((c) => c.scopeHash === escopoPedido);
  if (!irmao || canalPedido === undefined) {
    /*
      Sem irmão a unidade não existe, e a recusa é a mesma de sempre — inclusive
      a mensagem, que lista as unidades disponíveis. Delegar a `resolveContext`
      em vez de construir o erro aqui é o que garante que as duas portas digam a
      mesma frase.
    */
    return (await resolveContext(db, pedido, contextos))!;
  }

  return {
    ...irmao,
    channel: canalPedido,
    label: rotuloComCanal(irmao, canalPedido),
  };
}

/**
 * A vigência pedida, ou a recusa escrita.
 *
 * Aparar em silêncio para a mais próxima daria o número certo sob o título
 * errado — a mesma recusa que `resolverContextoDoQuadro` faz no QLP, pelo mesmo
 * motivo.
 */
function conferirVigencia(contexto: ContextInfo, pedida: string): string {
  if (!contexto.periodosDisponiveis.includes(pedida)) {
    throw new VigenciaDoCadastroNaoEncontrada(pedida, contexto.periodosDisponiveis);
  }
  return pedida;
}

/** Lê o material de uma vigência e monta o cadastro dela. */
async function montarDaVigencia(
  db: Database,
  effectiveDate: string,
  contexto: SeriesContext,
): Promise<{ montado: CadastroMontado; material: MaterialLido }> {
  const alvos: Alvo[] = [{ contexto, effectiveDate }];
  const chave = chaveDoAlvo(contexto.scopeHash, contexto.channel);

  const [cavalos, trechos, entregues, planilhas] = await Promise.all([
    lerCavalosEmLote(db, alvos),
    lerTrechosEmLote(db, alvos),
    serieEntregueEmLote(db, TIPO_TRECHO, alvos),
    lerPlanilhasEmLote(db, [
      { scopeHash: contexto.scopeHash, canal: contexto.channel, effectiveDate },
    ]),
  ]);

  return materialDe(
    cavalos.get(chave) ?? [],
    trechos.get(chave) ?? [],
    entregues.has(chave),
    planilhas.get(chaveDaPlanilha(contexto.scopeHash, contexto.channel, effectiveDate)),
  );
}

/**
 * O cadastro montado e o lastro em números, de um material já lido.
 *
 * Existe para que a tela do cadastro e a lista das unidades montem pelo mesmo
 * caminho. Se a lista contasse lastro por conta própria — "tem trecho, logo tem
 * alíquota" —, ela acertaria quase sempre e erraria exatamente no caso que
 * importa: a vigência que entregou trechos sem as colunas em reais, em que a
 * tela diz "sem lastro" e a lista diria "em dia".
 */
function materialDe(
  cavalos: CavaloDaVigencia[],
  trechos: TrechoDaVigencia[],
  trechosEntregues: boolean,
  declarados?: PlanilhaDeclarada,
): { montado: CadastroMontado; material: MaterialLido } {
  return {
    montado: montarCadastro({
      cavalos,
      trechos,
      trechosEntregues,
      ...(declarados ? { declarados } : {}),
    }),
    material: {
      cavalos: cavalos.length,
      trechos: trechos.length,
      trechosEntregues,
      linhasInformadas: declarados?.size ?? 0,
    },
  };
}

function retratoDo(contexto: ContextInfo): ContextoDoCadastro {
  return {
    scopeHash: contexto.scopeHash,
    channel: contexto.channel,
    label: contexto.label,
    unidade: unidadeDe(contexto),
    scopes: contexto.scopes,
  };
}

function vigenciasDe(contexto: ContextInfo): VigenciaDoCadastro[] {
  return contexto.periodosDisponiveis.map((data) => ({
    effectiveDate: data,
    periodLabel: periodLabel(data),
  }));
}

/** O nome da unidade dentro do escopo do contexto, quando ele o declara. */
function unidadeDe(contexto: ContextInfo): string | null {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? null;
}

/**
 * Uma unidade e a vigência dela que será lida.
 *
 * As consultas abaixo recebem uma **lista** destes, e não uma unidade e uma
 * data, e é o que permite o mesmo SQL responder pelo cadastro de uma unidade e
 * pela lista de todas. Duas versões da mesma consulta é como um dos dois lados
 * passa a contar a frota de um jeito que o outro não conta — e nada na tela
 * diria qual dos dois está certo.
 */
interface Alvo {
  contexto: SeriesContext;
  effectiveDate: string;
}

/** A chave que junta a linha lida de volta à unidade que a entregou. */
function chaveDoAlvo(scopeHash: string, channel: string | null): string {
  return `${scopeHash}|${channel ?? ""}`;
}

/**
 * O predicado dos alvos: o `contextFilter` de cada unidade **com a data
 * daquela unidade**, e nunca uma lista de unidades cruzada com uma lista de
 * datas.
 *
 * A diferença é o defeito que este formato existe para não cometer: as unidades
 * não estão todas na mesma vigência — a que parou de entregar em junho tem
 * junho como a mais recente —, e um `IN (datas)` traria junho para dentro da
 * unidade que já está em agosto, somando duas quinzenas numa contagem só. O par
 * anda junto ou não anda.
 */
function filtroDosAlvos(alias: string, alvos: Alvo[]) {
  /*
    Sem alvo nenhum, `false`: a consulta continua válida e não devolve linha.
    As leitoras já saem antes de chegar aqui, mas um `sql.join` de lista vazia
    produziria SQL quebrado — e é o tipo de erro que só aparece no dia em que o
    acervo está vazio, que é o pior dia para descobri-lo.
  */
  if (alvos.length === 0) return sql`false`;

  return sql.join(
    alvos.map(
      (alvo) =>
        sql`(${contextFilter(alias, alvo.contexto)}
             AND ${sql.raw(`${alias}.effective_date`)} = ${alvo.effectiveDate}::date)`,
    ),
    sql` OR `,
  );
}

/** As duas colunas que dizem de qual alvo a linha veio. */
function colunasDoAlvo(alias: string) {
  return sql`${sql.raw(`${alias}.scope_hash`)} AS scope_hash,
             ${channelSql(`${alias}.source_label`)} AS canal`;
}

/** O que toda linha lida em lote traz, além do que ela mesma diz. */
interface LinhaComAlvo extends Record<string, unknown> {
  scope_hash: string;
  canal: string | null;
}

/**
 * Quais alvos **declararam** entregar aquela série.
 *
 * Lê `snapshot.entity_type_set` e não a existência de fatos, pela mesma razão
 * de `serieFoiEntregue` na Frota: uma aba entregue vazia é dado; uma aba não
 * entregue é a forma do arquivo. As duas produzem zero trechos e pedem frases
 * diferentes.
 */
async function serieEntregueEmLote(
  db: Database,
  entityType: string,
  alvos: Alvo[],
): Promise<Set<string>> {
  if (alvos.length === 0) return new Set();

  const { rows } = await db.execute<LinhaComAlvo & { entity_type_set: string }>(sql`
    SELECT ${colunasDoAlvo("s")},
           s.entity_type_set
      FROM snapshot s
     WHERE s.status <> 'SUPERSEDED'
       AND (${filtroDosAlvos("s", alvos)})
  `);

  const entregues = new Set<string>();
  for (const row of rows) {
    if ((row.entity_type_set ?? "").split("+").includes(entityType)) {
      entregues.add(chaveDoAlvo(row.scope_hash, row.canal));
    }
  }
  return entregues;
}

interface LinhaDeFato extends Record<string, unknown> {
  entity_id: string;
  code: string;
  value_numeric: string | null;
  value_text: string | null;
  value_boolean: boolean | null;
  is_null: boolean;
}

/** Os fatos de um tipo de entidade nos alvos, restritos aos códigos pedidos. */
async function lerFatosDoTipo(
  db: Database,
  entityType: string,
  codigos: string[],
  alvos: Alvo[],
): Promise<Map<string, Map<string, Map<string, LinhaDeFato>>>> {
  const { rows } = await db.execute<LinhaDeFato & LinhaComAlvo>(sql`
    SELECT ${colunasDoAlvo("s")},
           f.entity_id::text     AS entity_id,
           a.code,
           f.value_numeric::text AS value_numeric,
           f.value_text,
           f.value_boolean,
           f.is_null
      FROM fact f
      JOIN attribute a ON a.id = f.attribute_id
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN entity e    ON e.id = f.entity_id
     WHERE e.entity_type = ${entityType}
       AND a.code IN (${sql.join(
         codigos.map((code) => sql`${code}`),
         sql`, `,
       )})
       AND s.status <> 'SUPERSEDED'
       AND (${filtroDosAlvos("s", alvos)})
  `);

  const porAlvo = new Map<string, Map<string, Map<string, LinhaDeFato>>>();
  for (const row of rows) {
    const chave = chaveDoAlvo(row.scope_hash, row.canal);
    const porAtivo = porAlvo.get(chave) ?? new Map<string, Map<string, LinhaDeFato>>();
    const atual = porAtivo.get(row.entity_id) ?? new Map<string, LinhaDeFato>();
    atual.set(row.code, row);
    porAtivo.set(row.entity_id, atual);
    porAlvo.set(chave, porAtivo);
  }
  return porAlvo;
}

/**
 * O número de um fato, ou nulo.
 *
 * `is_null` verdadeiro devolve nulo mesmo quando há um `value_numeric`: a
 * ausência é declarada pelo canônico e tem motivo próprio (`null_reason`), e
 * ler o número por baixo dela desfaria a distinção entre zero econômico e
 * célula vazia — que é a distinção que o modelo inteiro existe para manter.
 */
function numeroDe(fato: LinhaDeFato | undefined): number | null {
  if (!fato || fato.is_null || fato.value_numeric === null) return null;
  const valor = Number(fato.value_numeric);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * O vocabulário que a coluna `ativo` de fato usa.
 *
 * **`ATIVO` e `PARADO` são os dois valores do export real** — medidos no
 * acervo de CAMAÇARI · EMPURRADA em 19/08/2026: 442 linhas `ATIVO` e 116
 * `PARADO`, nas nove vigências, e nenhum terceiro valor. É a palavra da
 * planilha, e é ela que a contagem tem de entender; `PARADO` é exatamente o
 * que a aba chama de "Total Frota Fixa Inativos".
 *
 * As outras entradas estão aqui porque a mesma coluna chega como booleano
 * tipado em outros exports, e porque `SIM`/`NAO` é a forma que a planilha usa
 * em colunas irmãs. Reconhecê-las não custa nada e evita que o cadastro
 * dependa de qual variante o cliente mandou naquele mês.
 *
 * O que **não** está aqui é um padrão. Qualquer outro texto — inclusive o
 * vazio — é nulo, e nulo não é inativo: é "este veículo não respondeu", que a
 * contagem trata como categoria própria. Um `else return false` faria uma frota
 * inteira aparecer parada no dia em que a Ambev escrevesse a palavra de outro
 * jeito, e ninguém veria.
 */
const DIZ_QUE_SIM = new Set(["ATIVO", "SIM", "S", "TRUE", "VERDADEIRO", "1"]);
const DIZ_QUE_NAO = new Set([
  "PARADO",
  "INATIVO",
  "NAO",
  "NÃO",
  "N",
  "FALSE",
  "FALSO",
  "0",
]);

/** O booleano de um fato, ou nulo — pelo vocabulário acima. */
function booleanoDe(fato: LinhaDeFato | undefined): boolean | null {
  if (!fato || fato.is_null) return null;
  if (fato.value_boolean !== null) return fato.value_boolean;

  const texto = (fato.value_text ?? "").trim().toUpperCase();
  if (DIZ_QUE_SIM.has(texto)) return true;
  if (DIZ_QUE_NAO.has(texto)) return false;

  const numero = numeroDe(fato);
  if (numero === 1) return true;
  if (numero === 0) return false;
  return null;
}

async function lerCavalosEmLote(
  db: Database,
  alvos: Alvo[],
): Promise<Map<string, CavaloDaVigencia[]>> {
  if (alvos.length === 0) return new Map();

  const porAlvo = await lerFatosDoTipo(db, TIPO_CAVALO, CODIGOS_DO_CAVALO, alvos);

  /*
    A consulta acima só devolve cavalos que tenham **alguma** das colunas
    pedidas. Um cavalo sem a coluna `ativo` não apareceria, e a frota da
    vigência encolheria em silêncio — exatamente o oposto do que a contagem
    precisa dizer. Por isso a lista de quem existe vem de `entity`, e os fatos
    só a preenchem.
  */
  const { rows } = await db.execute<LinhaComAlvo & { entity_id: string }>(sql`
    SELECT DISTINCT ${colunasDoAlvo("s")},
           f.entity_id::text AS entity_id
      FROM fact f
      JOIN snapshot s ON s.id = f.snapshot_id
      JOIN entity e   ON e.id = f.entity_id
     WHERE e.entity_type = ${TIPO_CAVALO}
       AND s.status <> 'SUPERSEDED'
       AND (${filtroDosAlvos("s", alvos)})
  `);

  const cavalos = new Map<string, CavaloDaVigencia[]>();
  for (const row of rows) {
    const chave = chaveDoAlvo(row.scope_hash, row.canal);
    const lista = cavalos.get(chave) ?? [];
    lista.push({
      entityId: row.entity_id,
      ativo: booleanoDe(porAlvo.get(chave)?.get(row.entity_id)?.get(COLUNA.ativo.code)),
    });
    cavalos.set(chave, lista);
  }
  return cavalos;
}

async function lerTrechosEmLote(
  db: Database,
  alvos: Alvo[],
): Promise<Map<string, TrechoDaVigencia[]>> {
  if (alvos.length === 0) return new Map();

  const porAlvo = await lerFatosDoTipo(db, TIPO_TRECHO, CODIGOS_DO_TRECHO, alvos);

  const trechos = new Map<string, TrechoDaVigencia[]>();
  for (const [chave, porAtivo] of porAlvo) {
    trechos.set(
      chave,
      [...porAtivo.values()].map((fatos) => ({
        tributo: tributoDe(fatos.get(COLUNA.tributo.code)),
        percentualDeclarado: numeroDe(fatos.get(COLUNA.percentualDeclarado.code)),
        freteCtrc: numeroDe(fatos.get(COLUNA.freteCtrc.code)),
        imposto: numeroDe(fatos.get(COLUNA.imposto.code)),
        pisCofins: numeroDe(fatos.get(COLUNA.pisCofins.code)),
        previsaoViagens: numeroDe(fatos.get(COLUNA.previsaoViagens.code)),
      })),
    );
  }
  return trechos;
}

/**
 * O tributo aplicável ao trecho, como a coluna `icmsIss` o escreve.
 *
 * Só reconhece as duas palavras que a coluna existe para dizer. Um terceiro
 * valor não vira "ICMS por padrão" — vira nulo, o trecho sai das duas
 * proporções, e a montagem conta quantos ficaram de fora. É a mesma recusa de
 * `@workspace/fechamento/dominio`: um canal que não reconhecemos não é
 * adivinhado.
 */
function tributoDe(fato: LinhaDeFato | undefined): "ICMS" | "ISS" | null {
  if (!fato || fato.is_null) return null;
  const texto = (fato.value_text ?? "").trim().toUpperCase();
  if (texto === "ICMS") return "ICMS";
  if (texto === "ISS") return "ISS";
  return null;
}
