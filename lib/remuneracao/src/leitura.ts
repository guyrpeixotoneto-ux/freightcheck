import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  ContextNotFoundError,
  aplicarJanela,
  channelSql,
  contextFilter,
  contextLabel,
  listContexts,
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
  apagarPlanilha,
  canaisComPlanilha,
  chaveDaPlanilha,
  copiarPlanilha,
  gravarPlanilha,
  lerPlanilha,
  lerPlanilhasEmLote,
  type CanalComPlanilha,
  type PlanilhaDaVigencia,
} from "./planilha";
import type { PlanilhaDeclarada } from "./informado";
import { compararCadastros, type CadastroComparado } from "./comparacao";
import { ehInicioDeQuinzena, rotuloDaVigencia } from "./vigencia";
import { unidadesRegistradas, vigenciasDaUnidade } from "./unidade";
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
  /**
   * Como a vigência se escreve na tela — e aqui não é o rótulo genérico.
   *
   * A planilha é quinzenal, e duas entregas do mesmo mês precisam de textos
   * diferentes para que o seletor não ofereça dois itens iguais. Quem decide é
   * `rotuloDaVigencia`, em `vigencia.ts`, e a decisão depende do que a unidade
   * entregou naquele mês.
   */
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
 * Uma unidade **numa vigência**, com o que o cadastro dela alcança lá.
 *
 * **Uma linha por vigência, e não uma por unidade.** Foi uma por unidade — a
 * mais recente que ela entregou — enquanto a lista respondia só "o cadastro
 * está de pé hoje", e essa resposta escondia trabalho que já tinha sido feito:
 * quem digitou a planilha de julho e voltou em agosto via a unidade sem
 * planilha nenhuma, porque a linha tinha passado a responder pela quinzena
 * seguinte, que estava em branco. O que estava certo naquela forma continua
 * certo nesta — a lista é reunida por vigência, e o mês mais recente vem
 * primeiro —, e o que era perda deixou de ser: a quinzena preenchida continua
 * na tela, na vigência dela.
 *
 * Qual vigência esta linha responde está em `effectiveDate`, ao lado da
 * resposta, para que a lista nunca escolha em silêncio.
 */
export interface SituacaoDaUnidade extends ContextoDoCadastro {
  /** A vigência que esta linha responde. */
  effectiveDate: string;
  periodLabel: string;
  material: MaterialLido;
  cadastro: SituacaoDoCadastro;
  /**
   * A unidade existe porque alguém a registrou, e não porque um export a
   * trouxe.
   *
   * Existe para a tela **não mentir por frase feita**. Ela escrevia "N unidades
   * no acervo" e "3 vigências no acervo" para toda linha, o que era verdade
   * enquanto toda unidade vinha de arquivo. Numa registrada as duas frases são
   * falsas, e falsas do jeito pior: dizem que existe material importado onde
   * não existe nenhum, justamente na unidade cuja única fonte é o que alguém
   * digitou.
   */
  registradaAMao: boolean;
  /**
   * Esta linha existe **porque a planilha existe** — e por mais nada.
   *
   * Nem acervo, nem registro: o par (escopo, canal) desapareceu das duas
   * fontes que dizem quem é a unidade, e o que restou foi o que alguém digitou.
   * Acontece quando a importação que sustentava a unidade é excluída, ou quando
   * o banco volta de um restauro sem ela.
   *
   * Ela era descartada em silêncio, e o silêncio é o defeito: a planilha ficava
   * no banco, com autor e data, sem aparecer em lista nenhuma e sem poder ser
   * reaberta — quem tinha preenchido trinta linhas via "sumiu". A marca existe
   * para a tela poder dizer a única coisa honesta sobre a linha: os números
   * continuam aqui, a unidade que os explicava é que não está mais.
   *
   * É diferente de {@link registradaAMao}, e a diferença é o conserto: lá falta
   * o export de uma unidade que alguém cadastrou, e ele chega importando; aqui
   * falta a unidade, e o que reata as duas pontas é reimportar a série ou
   * cadastrar a unidade com o mesmo código.
   */
  planilhaOrfa: boolean;
}

export interface SituacaoDasUnidades {
  /** Um cadastro por (unidade, vigência) — a linha da lista. */
  cadastros: SituacaoDaUnidade[];
  /**
   * Quantos cadastros em cada estado — os quatro somam `cadastros`.
   *
   * Somados aqui, e não na tela, pela mesma razão que os totais do Fechamento
   * vêm do servidor: uma contagem feita na interface é uma segunda conta sobre
   * o mesmo material, e as duas divergem no dia em que um estado novo nascer.
   *
   * `unidades` e `cadastros` são números de grãos diferentes, e por isso os
   * dois estão aqui: a unidade das nove vigências é **uma** unidade e nove
   * cadastros, e uma tela que precisasse dizer "nenhuma das N unidades tem
   * este código" contaria nove onde há uma se tivesse de deduzir o primeiro
   * número do tamanho da lista.
   */
  resumo: {
    /** Unidades distintas — cada uma pode responder por várias vigências. */
    unidades: number;
    /** Linhas da lista: uma por (unidade, vigência). */
    cadastros: number;
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
 * Erro de recusa: a vigência que se quer **criar** não é uma quinzena.
 *
 * Só aparece no caminho que aceita quinzena nova — a tela que cadastra a
 * planilha antes de o export chegar. Ali a vigência não vem de arquivo nenhum:
 * ela vale porque é uma quinzena do calendário, e o calendário deste produto
 * começa a quinzena no dia 1 ou no dia 16 (ver `ehInicioDeQuinzena`, em
 * `vigencia.ts`). 400, e não 404: o pedido é que está errado, e a unidade está
 * onde sempre esteve.
 */
export class VigenciaForaDaQuinzena extends Error {
  constructor(pedida: string) {
    super(
      `${pedida} não é uma quinzena que se possa criar. Uma quinzena começa no dia 1 ou no ` +
        "dia 16, e é por ela que o fechamento procura o cadastro — uma vigência no meio do " +
        "mês guardaria a planilha onde nenhuma tela vai buscá-la. A vigência que vem de " +
        "arquivo continua sendo a que o arquivo trouxer.",
    );
    this.name = "VigenciaForaDaQuinzena";
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
 * **A terceira fonte: a unidade registrada à mão.** Durante um tempo esta
 * função terminava dizendo "canal novo em unidade conhecida é declaração;
 * unidade nova é importação", e a razão era boa — sem série importada não há
 * `scope_hash`, não há código e não há rótulo, e a planilha ficaria pendurada
 * num identificador que ninguém sabe ler. O que mudou não foi a razão: foi
 * passar a existir um lugar onde essas três coisas são **declaradas** por
 * alguém, com nome e data, em vez de inventadas aqui — ver `unidade.ts`. Uma
 * unidade registrada traz o seu próprio escopo e o seu próprio rótulo, e o
 * `scope_hash` dela é o mesmo que a importação calculará para aquele código.
 *
 * **A ordem entre as três é a ordem da procedência.** O acervo vence a
 * planilha e vence o registro, porque medição vence declaração; o registro só
 * responde pelo par que o acervo não tem. Não é preferência de estilo: é o que
 * garante que o dia da primeira importação de uma unidade registrada seja um
 * dia em que nada acontece na tela — o rótulo passa a vir do arquivo, a
 * planilha continua onde estava, e ninguém precisa juntar duas linhas.
 */
async function contextosDoModulo(db: Database): Promise<ContextInfo[]> {
  return (await contextosEProcedencia(db)).contextos;
}

/**
 * Os mesmos contextos, mais **quais deles não têm acervo nenhum**, **quais
 * existem só porque a planilha existe** e **por quais vigências cada um
 * responde na lista**.
 *
 * A separação existe por uma conta: `lerSituacaoDasUnidades` precisa das
 * respostas todas, e pedi-las em outras chamadas custaria um `listContexts` a
 * mais — numa função cujo cabeçalho promete "quatro consultas, e não quatro por
 * unidade". Elas são subproduto da disputa que já acontece aqui; devolvê-las
 * é de graça, e recalculá-las fora custaria a consulta inteira.
 *
 * **`vigenciasNaLista` só existe para o canal que só a planilha tem.** As
 * vigências dele são herdadas do irmão importado — é a resposta certa para o
 * formulário, porque a quinzena é do calendário do cliente e não da série —, e
 * seria a errada para a lista: as nove vigências do irmão virariam nove linhas
 * de um canal em que só uma quinzena foi digitada, oito delas vazias, todas
 * dizendo "sem lastro" sobre um material que nunca existiu. Na lista ele
 * responde pelas quinzenas que a planilha de fato tem. Os outros dois casos
 * não precisam de recorte nenhum: a unidade do acervo tem as vigências que
 * entregou, e a registrada à mão já tem só a inicial mais as que a planilha
 * ganhou.
 */
async function contextosEProcedencia(db: Database): Promise<{
  contextos: ContextInfo[];
  semAcervo: Set<string>;
  orfas: Set<string>;
  vigenciasNaLista: Map<string, string[]>;
}> {
  const [doAcervo, daPlanilha, registradas] = await Promise.all([
    // A casca de trecho sozinho entra aqui: uma unidade cujo cadastro existe
    // só de trecho é dado real deste módulo, não ruído de navegação — ver
    // `incluirCascaDeTrecho`, em `@workspace/comparison/series`.
    listContexts(db, { incluirCascaDeTrecho: true }),
    canaisComPlanilha(db),
    unidadesRegistradas(db),
  ]);
  if (daPlanilha.length === 0 && registradas.length === 0) {
    return {
      contextos: doAcervo,
      semAcervo: new Set(),
      orfas: new Set(),
      vigenciasNaLista: new Map(),
    };
  }

  const vigenciasPorChave = new Map(
    daPlanilha.map((c) => [chaveDaUnidade(c.scopeHash, c.canal), c.vigencias]),
  );

  /*
    A vigência de uma unidade, neste módulo, é o que o acervo entregou **mais**
    o que alguém digitou — e isto vale para toda unidade, e não só para a
    registrada à mão, que já nascia com a união.

    A regra assimétrica custava o defeito que ela parecia evitar: a planilha da
    quinzena que o export ainda não trouxe ficava gravada e sem tela nenhuma.
    Ela não aparecia na lista (que responde pelas vigências do contexto), não
    aparecia no seletor do cadastro (idem), e a escrita seguinte na mesma
    quinzena era recusada por vigência inexistente — a planilha existia no banco
    e não existia em lugar nenhum. Uma vigência que alguém digitou é uma
    vigência que alguém digitou, qualquer que tenha sido a origem da unidade.
  */
  const comAsDigitadas = doAcervo.map((c) =>
    comAsVigenciasDaPlanilha(c, vigenciasPorChave.get(chaveDaUnidade(c.scopeHash, c.channel))),
  );

  const jaExiste = new Set(comAsDigitadas.map((c) => chaveDaUnidade(c.scopeHash, c.channel)));
  /*
    Quem entra por registro e não por arquivo. É medido **aqui**, e não pela
    tabela inteira, porque a pergunta da tela é "este contexto tem snapshot?" —
    uma unidade registrada que já ganhou export continua na tabela e não é mais
    sintética, e marcá-la faria a lista chamá-la de sem acervo tendo acervo.
  */
  const semAcervo = new Set<string>();
  const irmaoDoEscopo = new Map<string, ContextInfo>();
  for (const c of comAsDigitadas) {
    if (!irmaoDoEscopo.has(c.scopeHash)) irmaoDoEscopo.set(c.scopeHash, c);
  }

  const orfas = new Set<string>();
  const sinteticos: ContextInfo[] = [];
  const vigenciasNaLista = new Map<string, string[]>();

  /*
    As registradas entram **antes** dos canais que só a planilha tem, e a ordem
    é o conserto de dois defeitos que a ordem inversa produzia.

    O primeiro era uma linha a mais: a unidade registrada à mão cujo escopo
    ganhou export em **outro** canal aparecia duas vezes — uma vinda da
    planilha, pendurada no irmão importado, e outra vinda do registro —, porque
    o laço da planilha não anotava em `jaExiste` o par que acabara de criar. São
    as "duas CAMAÇARI" que este caminho inteiro existe para não cometer, com a
    diferença de que nada em tela dizia que eram a mesma.

    O segundo era uma linha a menos, e pior: a unidade registrada à mão não
    entrava em `irmaoDoEscopo`, que só via o acervo. Salvar a planilha de um
    canal que ela ainda não tinha — o gesto que o painel de cadastro oferece, e
    que a escrita aceita — gravava as células num par que a leitura descartava
    logo em seguida. A planilha ficava no banco, com autor e data, e sem tela
    nenhuma.

    A procedência não muda: `jaExiste` já nasce com o acervo inteiro, e por isso
    o acervo continua vencendo o registro no par que os dois têm.
  */
  for (const u of registradas) {
    const chave = chaveDaUnidade(u.scopeHash, u.canal);
    if (jaExiste.has(chave)) continue;
    jaExiste.add(chave);
    semAcervo.add(chave);

    const vigencias = vigenciasDaUnidade(u.vigenciaInicial, vigenciasPorChave.get(chave) ?? []);
    const registrada: ContextInfo = {
      scopeHash: u.scopeHash,
      channel: u.canal,
      /*
        Sem `datasetFamily`: ausente já quer dizer equipamento (ver
        `SeriesContext`), que é a família deste módulo. Nomeá-la aqui seria
        repetir o padrão em mais um lugar de onde ele teria de ser mudado.
      */
      label: u.canal === null ? u.nome : `${u.nome} · ${u.canal}`,
      /*
        O escopo é o que foi declarado, e é o mesmo par (tipo, código) de que o
        `scope_hash` foi somado. Quando a importação chegar, ela criará a linha
        de `scope` com este código e o contexto passará a vir do acervo — sem
        que nada aqui precise saber que isso aconteceu.
      */
      scopes: [{ scopeType: u.scopeType, code: u.codigo, name: u.nome }],
      latestPeriod: vigencias[vigencias.length - 1]!,
      periods: vigencias.length,
      periodosDisponiveis: vigencias,
      periodosNaJanela: vigencias.length,
      janela: null,
    };
    sinteticos.push(registrada);
    /*
      Só onde o acervo não respondeu: o irmão importado continua sendo quem
      nomeia os outros canais do escopo, porque medição vence declaração — e é
      o mesmo motivo pelo qual esta linha não sobrescreve a de lá.
    */
    if (!irmaoDoEscopo.has(u.scopeHash)) irmaoDoEscopo.set(u.scopeHash, registrada);
  }

  /*
    Os canais que só a planilha tem, e o que fazer com aquele que não tem irmão
    nenhum.

    Havia um `continue` aqui, e a justificativa era boa: o rótulo e o escopo de
    uma planilha vivem na série que a trouxe, e inventá-los seria escrever um
    nome de unidade que nenhum arquivo sustenta. O que ela não pesava é o preço
    do silêncio. A unidade sai do acervo — uma importação excluída, um banco
    restaurado sem ela — e a planilha que alguém digitou, com autor e data,
    deixa de ter tela: não está na lista, não abre pelo cadastro, e a escrita
    seguinte no mesmo lugar é recusada por unidade inexistente. Quem preencheu
    trinta linhas vê "sumiu", e é literalmente o que aconteceu.

    Nomear não precisa ser inventar. `contextLabel` — o mesmo de `listContexts`
    — já resolve isto para o acervo: nome, senão código, senão o hash, "que é
    feio mas é honesto". O escopo que restou é procurado em `escopoQueRestou`, e
    quando não resta nada a linha se chama pelo hash. Feio, e visível: uma
    planilha que existe no banco tem de existir em tela, ainda que a tela só
    consiga dizer que ela existe.
  */
  const semIrmao = daPlanilha.filter(
    (c) => !jaExiste.has(chaveDaUnidade(c.scopeHash, c.canal)) && !irmaoDoEscopo.has(c.scopeHash),
  );
  const escopoQueRestou = await escoposForaDoAcervo(
    db,
    [...new Set(semIrmao.map((c) => c.scopeHash))],
  );

  for (const canal of daPlanilha) {
    const chave = chaveDaUnidade(canal.scopeHash, canal.canal);
    if (jaExiste.has(chave)) continue;
    jaExiste.add(chave);
    vigenciasNaLista.set(chave, canal.vigencias);

    const irmao = irmaoDoEscopo.get(canal.scopeHash);
    if (irmao) {
      /*
        Sem export no par, venha o irmão de onde vier: a marca é do par (escopo,
        canal), e o canal novo de uma unidade registrada à mão não tem arquivo
        nenhum — dizer o contrário mandaria procurar um export que ninguém
        deixou de mandar.
      */
      if (semAcervo.has(chaveDaUnidade(irmao.scopeHash, irmao.channel))) semAcervo.add(chave);
      sinteticos.push({
        ...irmao,
        channel: canal.canal,
        label: rotuloComCanal(irmao, canal.canal),
      });
      continue;
    }

    orfas.add(chave);
    sinteticos.push(daPlanilhaSozinha(canal, escopoQueRestou.get(canal.scopeHash) ?? []));
  }

  return { contextos: [...comAsDigitadas, ...sinteticos], semAcervo, orfas, vigenciasNaLista };
}

/**
 * O contexto de uma planilha cuja unidade não está em lugar nenhum.
 *
 * As vigências são as que a planilha de fato tem, e não há outra régua
 * possível: não há acervo de onde herdar quinzenas nem registro que declare uma
 * inicial. É também a régua certa — a linha responde exatamente pelas quinzenas
 * em que alguém digitou alguma coisa, que é tudo o que sobrou dela.
 */
function daPlanilhaSozinha(
  canal: CanalComPlanilha,
  scopes: ContextInfo["scopes"],
): ContextInfo {
  const vigencias = [...canal.vigencias].sort();
  return {
    scopeHash: canal.scopeHash,
    channel: canal.canal,
    label: contextLabel(scopes, canal.canal, canal.scopeHash),
    scopes,
    latestPeriod: vigencias[vigencias.length - 1]!,
    periods: vigencias.length,
    periodosDisponiveis: vigencias,
    periodosNaJanela: vigencias.length,
    janela: null,
  };
}

/**
 * O escopo de uma unidade que o acervo de equipamento já não tem.
 *
 * `listContexts` pergunta pelas vigências **ativas de equipamento**, e é a
 * pergunta certa para montar a lista. Esta é outra: "sobrou em algum lugar do
 * banco quem é o dono deste `scope_hash`?" — e por isso não filtra nem por
 * família nem por `status`. Uma vigência substituída por revisão, ou o export
 * de frete da mesma unidade, continuam sabendo o nome que a planilha órfã
 * perdeu.
 *
 * Não é reconstrução de identidade: o `scope_hash` é o mesmo, e o que se lê é
 * a linha de `scope` que a importação gravou. Quando nem isso resta — a
 * importação foi excluída inteira —, o mapa não traz a chave e quem chama
 * resolve com o hash.
 *
 * Uma consulta só, e só quando há órfã: a lista de hashes vem vazia no banco em
 * que toda planilha tem unidade, que é o caso comum.
 */
async function escoposForaDoAcervo(
  db: Database,
  hashes: string[],
): Promise<Map<string, ContextInfo["scopes"]>> {
  const escopos = new Map<string, ContextInfo["scopes"]>();
  if (hashes.length === 0) return escopos;

  const { rows } = await db.execute<{
    scope_hash: string;
    scope_type: string;
    code: string;
    name: string | null;
  }>(sql`
    SELECT DISTINCT s.scope_hash, sc.scope_type, sc.code, sc.name
      FROM snapshot s
      JOIN snapshot_scope ss ON ss.snapshot_id = s.id
      JOIN scope sc          ON sc.id = ss.scope_id
     WHERE s.scope_hash IN (${sql.join(
       hashes.map((h) => sql`${h}`),
       sql`, `,
     )})
     ORDER BY s.scope_hash, sc.scope_type, sc.code
  `);

  for (const linha of rows) {
    const lista = escopos.get(linha.scope_hash) ?? [];
    lista.push({ scopeType: linha.scope_type, code: linha.code, name: linha.name });
    escopos.set(linha.scope_hash, lista);
  }
  return escopos;
}

/**
 * O contexto do acervo com as quinzenas que só a planilha tem.
 *
 * Devolve o mesmo objeto quando não há nada a acrescentar — a maioria dos
 * casos, e o que mantém a lista idêntica para quem nunca digitou uma aba.
 */
function comAsVigenciasDaPlanilha(
  contexto: ContextInfo,
  daPlanilha: readonly string[] | undefined,
): ContextInfo {
  if (!daPlanilha || daPlanilha.length === 0) return contexto;

  const todas = [...new Set([...contexto.periodosDisponiveis, ...daPlanilha])].sort();
  if (todas.length === contexto.periodosDisponiveis.length) return contexto;

  return {
    ...contexto,
    periodosDisponiveis: todas,
    latestPeriod: todas[todas.length - 1]!,
    periods: todas.length,
    periodosNaJanela: todas.length,
  };
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
    /**
     * Aceitar uma quinzena que a unidade ainda não tem.
     *
     * A outra metade de `aceitarCanalNovo`, e pela mesma razão: é a tela que
     * cadastra a planilha que precisa mostrar as trinta linhas em branco da
     * quinzena que ainda não chegou. Fora dela o padrão continua sendo recusar
     * — ver {@link comAQuinzenaNova}.
     */
    aceitarVigenciaNova?: boolean;
  },
): Promise<CadastroDaUnidade | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const daUnidade = pedido?.aceitarCanalNovo
    ? await resolverParaEscrita(db, contextos, pedido)
    : (await resolveContext(db, pedido, contextos))!;
  const pedida = pedido?.period ?? daUnidade.latestPeriod;
  const contexto = pedido?.aceitarVigenciaNova ? comAQuinzenaNova(daUnidade, pedida) : daUnidade;
  const effectiveDate = conferirVigencia(contexto, pedida);
  const { montado, material } = await montarDaVigencia(db, effectiveDate, contexto);

  return {
    ...montado,
    contexto: retratoDo(contexto),
    effectiveDate,
    periodLabel: rotuloDaVigencia(effectiveDate, contexto.periodosDisponiveis),
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
      periodLabel: rotuloDaVigencia(dataEsquerda, disponiveis),
      material: esquerda.material,
    },
    direita: {
      effectiveDate: dataDireita,
      periodLabel: rotuloDaVigencia(dataDireita, disponiveis),
      material: direita.material,
    },
    vigencias: vigenciasDe(contexto),
  };
}

/**
 * Os cadastros que o módulo conhece — **um por unidade e vigência**.
 *
 * É a tela que vem **antes** do cadastro: quem abre Remuneração na virada da
 * quinzena não quer uma unidade — quer saber quais já estão de pé e quais
 * ainda não. Sem esta leitura, descobrir que um CDD entregou a frota e não
 * entregou os trechos custa abrir o CDD, e com trinta unidades custa abrir
 * trinta telas para achar as duas que faltam.
 *
 * **Por vigência, e não uma linha por unidade.** Era uma linha por unidade, na
 * vigência mais recente dela, e o que essa forma escondia é trabalho que já
 * tinha sido feito: quem preencheu a planilha de julho e voltou na virada via
 * a unidade com "nada informado", porque a única linha dela tinha passado a
 * responder por agosto. A quinzena preenchida não some mais — ela é uma linha,
 * na vigência dela, ao lado da que ainda está em branco. Quem quer só o
 * presente lê o primeiro grupo, que continua sendo o mês mais recente.
 *
 * **Quatro consultas, e não quatro por cadastro.** Cada uma responde por todos
 * os alvos de uma vez — o par (unidade, vigência) que {@link filtroDosAlvos}
 * monta, agrupado por unidade —, a mesma decisão de `lerCavalosEmLote`,
 * escalada de "não uma consulta por cavalo" para "não um cadastro por
 * unidade". O que cresceu com a vigência foi o **material lido**, e não o
 * número de idas ao banco: são as mesmas quatro consultas, com mais linhas
 * dentro. O trabalho de montagem continua sendo feito por cadastro, porque é
 * ele que garante que a lista e a tela digam a mesma coisa: quem responde
 * "esta linha tem lastro" nos dois lugares é a mesma `montarCadastro`.
 *
 * As vigências de cada unidade saem da mais recente para a mais antiga. É a
 * ordem em que a tela as reúne, e é também a que faz `find` — o gesto de quem
 * procura uma unidade nesta lista — cair na quinzena que responde por ela
 * hoje, em vez de na primeira que ela entregou.
 *
 * Acervo vazio devolve lista vazia e resumo zerado, e não `null`: aqui não há
 * unidade pedida que possa não existir — a pergunta é sobre o conjunto, e o
 * conjunto vazio é uma resposta legítima que a tela sabe escrever.
 */
export async function lerSituacaoDasUnidades(db: Database): Promise<SituacaoDasUnidades> {
  const { contextos, semAcervo, orfas, vigenciasNaLista } = await contextosEProcedencia(db);

  /*
    O alvo carrega `SeriesContext` — o que as consultas precisam —, e aqui o
    contexto é o inteiro: as linhas montadas pedem o rótulo, os escopos e as
    vigências da unidade, que só o `ContextInfo` tem.
  */
  const alvos: (Alvo & { contexto: ContextInfo })[] = contextos.flatMap((contexto) => {
    const chave = chaveDaUnidade(contexto.scopeHash, contexto.channel);
    const vigencias = vigenciasNaLista.get(chave) ?? contexto.periodosDisponiveis;
    return [...vigencias]
      .sort()
      .reverse()
      .map((effectiveDate) => ({ contexto, effectiveDate }));
  });

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

  const cadastros = alvos.map(({ contexto, effectiveDate }): SituacaoDaUnidade => {
    const chave = chaveDoAlvo(contexto.scopeHash, contexto.channel, effectiveDate);
    const { montado, material } = materialDe(
      cavalos.get(chave) ?? [],
      trechos.get(chave) ?? [],
      entregues.has(chave),
      planilhas.get(chaveDaPlanilha(contexto.scopeHash, contexto.channel, effectiveDate)),
    );
    return {
      ...retratoDo(contexto),
      effectiveDate,
      /*
        O rótulo é medido contra **todas** as vigências da unidade, e não contra
        as que esta lista mostra: é o que a quinzena precisa para se distinguir
        da irmã do mesmo mês, e recortá-lo pelo que a lista traz faria a mesma
        data se chamar "agosto/2026" aqui e "1ª quinzena de agosto de 2026" na
        tela do cadastro.
      */
      periodLabel: rotuloDaVigencia(effectiveDate, contexto.periodosDisponiveis),
      material,
      cadastro: medirSituacao(montado),
      registradaAMao: semAcervo.has(chaveDaUnidade(contexto.scopeHash, contexto.channel)),
      planilhaOrfa: orfas.has(chaveDaUnidade(contexto.scopeHash, contexto.channel)),
    };
  });

  const quantos = (estado: EstadoDoCadastro) =>
    cadastros.filter((c) => c.cadastro.estado === estado).length;

  return {
    cadastros,
    resumo: {
      /*
        Unidades distintas, e não `cadastros.length`: a unidade das nove
        vigências é uma unidade e nove cadastros, e a frase que conta unidades
        — "nenhuma das N unidades tem este código", no Resumo do Fechamento —
        diria nove onde há uma se saísse do tamanho da lista.
      */
      unidades: new Set(cadastros.map((c) => chaveDaUnidade(c.scopeHash, c.channel))).size,
      cadastros: cadastros.length,
      frotaEAliquotas: quantos("FROTA_E_ALIQUOTAS"),
      soFrota: quantos("SO_FROTA"),
      soAliquotas: quantos("SO_ALIQUOTAS"),
      semLastro: quantos("SEM_LASTRO"),
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
/**
 * O lastro de **uma** vigência — o número que o Fechamento precisa citar.
 *
 * A tela da competência precisa poder dizer "o devido saiu do cadastro digitado
 * e nenhuma das onze linhas verificáveis tem documento por trás". Sem isto, ela
 * só sabia se o contrato respondeu — e a diferença entre um devido conferido
 * pelo acervo e um devido só digitado ficava invisível justamente onde ela
 * importa, que é na hora de assinar o fechamento.
 *
 * **Não bloqueia nada, e não pode passar a bloquear.** É uma medida de
 * auditabilidade que viaja ao lado do contrato; o contrato sai do que foi
 * digitado, com ou sem ela. Ver `lastro-e-devido.test.ts`.
 *
 * Monta pelo mesmo caminho da lista e da tela do cadastro — `montarDaVigencia`,
 * `medirSituacao` —, e é essa a razão de existir aqui em vez de no Fechamento:
 * um segundo cálculo de lastro discordaria do primeiro no dia em que uma linha
 * mudasse de origem.
 */
export async function lerSituacaoDaVigencia(
  db: Database,
  pedido: { scopeHash: string; canal: string | null; effectiveDate: string },
): Promise<SituacaoDoCadastro> {
  const { montado } = await montarDaVigencia(db, pedido.effectiveDate, {
    scopeHash: pedido.scopeHash,
    channel: pedido.canal,
  });
  return medirSituacao(montado);
}

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
    /** A quinzena pode ser uma que a unidade ainda não tem — ver a leitura. */
    aceitarVigenciaNova?: boolean;
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
 * Apaga a planilha informada de uma unidade numa vigência.
 *
 * **A quinzena é conferida pelas mesmas portas da leitura** — unidade que não
 * existe é `ContextNotFoundError`, vigência que a unidade não tem é
 * {@link VigenciaDoCadastroNaoEncontrada} —, e **não** existe aqui o
 * `aceitarVigenciaNova` da escrita: criar uma quinzena para apagá-la é o
 * contrário do que quem chama pediu, e um endereço errado que respondesse
 * "apaguei" diria que o trabalho sumiu quando ele continua onde estava.
 *
 * Devolve quantas células saíram, e nunca a planilha resultante: o que sobra é
 * uma quinzena vazia, e devolvê-la como objeto convidaria a tela a mostrá-la
 * como se ainda houvesse cadastro ali.
 */
export async function apagarPlanilhaDaUnidade(
  db: Database,
  pedido?: RequestedContext & { period?: string },
): Promise<number | null> {
  const alvo = await resolverAlvoDaPlanilha(db, pedido);
  if (alvo === null) return null;
  return apagarPlanilha(db, alvo);
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
    /**
     * O **destino** pode ser uma quinzena que a unidade ainda não tem.
     *
     * É o caso mais útil da cópia, e o que ela existe para servir: a quinzena
     * nova começa em branco, e a maior parte da aba repete a anterior. A
     * **origem** nunca entra por aqui — copiar de uma quinzena que não existe
     * é copiar de nada, e a recusa por vigência inexistente continua sendo a
     * resposta certa para ela.
     */
    aceitarVigenciaNova?: boolean;
    autor?: { id: string | null; nome: string | null };
  },
): Promise<PlanilhaDaVigencia | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const contexto = await resolverParaEscrita(db, contextos, pedido);
  const de = conferirVigencia(contexto, pedido.de);
  const noDestino = pedido.aceitarVigenciaNova
    ? comAQuinzenaNova(contexto, pedido.para)
    : contexto;
  return copiarPlanilha(db, {
    scopeHash: contexto.scopeHash,
    canal: contexto.channel,
    de,
    para: conferirVigencia(noDestino, pedido.para),
    ...(pedido.autor ? { autor: pedido.autor } : {}),
  });
}

/** A unidade e a vigência de um pedido de planilha, já conferidas. */
async function resolverAlvoDaPlanilha(
  db: Database,
  pedido?: RequestedContext & { period?: string; aceitarVigenciaNova?: boolean },
): Promise<{ scopeHash: string; canal: string | null; effectiveDate: string } | null> {
  const contextos = await contextosDoModulo(db);
  if (contextos.length === 0) return null;

  const daUnidade = await resolverParaEscrita(db, contextos, pedido);
  const pedida = pedido?.period ?? daUnidade.latestPeriod;
  const contexto = pedido?.aceitarVigenciaNova ? comAQuinzenaNova(daUnidade, pedida) : daUnidade;
  return {
    scopeHash: contexto.scopeHash,
    canal: contexto.channel,
    effectiveDate: conferirVigencia(contexto, pedida),
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
 * O mesmo contexto, **com a quinzena que ainda não existe** dentro dele.
 *
 * É o irmão de `resolverParaEscrita` do lado da vigência, e existe pela mesma
 * razão, um grão adiante: a aba de Excel chega antes do export, e a quinzena
 * que ela descreve não está no acervo justamente enquanto digitá-la vale a
 * pena. Sem isto, a unidade cadastrada à mão ficava presa na quinzena declarada
 * no registro — o formulário só oferecia as vigências que ela já tinha, salvar
 * numa nova era recusado, e a promessa escrita em "Cadastrar unidade" ("as
 * outras aparecem à medida que você salvar planilha nelas") não tinha caminho.
 *
 * A quinzena entra na lista de vigências do contexto, e não só na data pedida,
 * porque é dela que sai o **rótulo**: `rotuloDaVigencia` decide "1ª quinzena de
 * agosto" ou "agosto/2026" olhando o que mais existe naquele mês, e uma lista
 * que ignorasse a recém-criada nomearia as duas de agosto com o mesmo texto no
 * mesmo seletor.
 *
 * O que ela **não** faz é aceitar qualquer data: ver {@link
 * VigenciaForaDaQuinzena}. E nada aqui grava — o contexto estendido só vale
 * para esta chamada; a vigência passa a existir de verdade quando a primeira
 * célula for salva nela, que é o mesmo momento em que um canal novo passa a
 * existir.
 */
function comAQuinzenaNova(contexto: ContextInfo, pedida: string): ContextInfo {
  if (contexto.periodosDisponiveis.includes(pedida)) return contexto;
  if (!ehInicioDeQuinzena(pedida)) throw new VigenciaForaDaQuinzena(pedida);

  const periodosDisponiveis = [...contexto.periodosDisponiveis, pedida].sort();
  return {
    ...contexto,
    periodosDisponiveis,
    latestPeriod: periodosDisponiveis[periodosDisponiveis.length - 1]!,
    periods: periodosDisponiveis.length,
    periodosNaJanela: periodosDisponiveis.length,
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
  const chave = chaveDoAlvo(contexto.scopeHash, contexto.channel, effectiveDate);

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
    periodLabel: rotuloDaVigencia(data, contexto.periodosDisponiveis),
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

/**
 * A chave de uma unidade: o par (escopo, canal), sem data nenhuma.
 *
 * É a identidade da série na disputa de procedência — quem o acervo já
 * responde, qual canal só a planilha tem, qual unidade foi registrada à mão.
 * Nada aqui é sobre vigência, e é por isso que ela não entra.
 */
function chaveDaUnidade(scopeHash: string, channel: string | null): string {
  return `${scopeHash}|${channel ?? ""}`;
}

/**
 * A chave que junta a linha lida de volta ao alvo que a entregou — e a
 * vigência **faz parte dela**.
 *
 * A data entrou na chave no dia em que a lista passou a pedir várias vigências
 * da mesma unidade na mesma consulta. Sem ela, os cavalos de julho e os de
 * agosto caem no mesmo balde: a contagem de uma quinzena passa a incluir a
 * outra, e o número sai plausível em toda a coluna e errado em todas as
 * linhas — o mesmo defeito que {@link filtroDosAlvos} evita do lado do
 * predicado. É a mesma forma de `chaveDaPlanilha`, em `planilha.ts`, e as duas
 * se leem lado a lado em {@link lerSituacaoDasUnidades}.
 */
function chaveDoAlvo(
  scopeHash: string,
  channel: string | null,
  effectiveDate: string,
): string {
  return `${scopeHash}|${channel ?? ""}|${effectiveDate}`;
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

  /*
    As datas da **mesma** unidade viram um `IN` só, e não uma cláusula por
    data. É a mesma condição escrita mais curta — `(A AND d=d1) OR (A AND
    d=d2)` é `A AND d IN (d1,d2)` —, e ela importa desde que a lista pede todas
    as vigências de cada unidade: sem o agrupamento, trinta unidades de nove
    quinzenas dariam duzentas e setenta cláusulas OR num predicado só.

    O contexto do grupo é o do primeiro alvo dele: os alvos de uma unidade
    saem sempre do mesmo `ContextInfo` — é assim que as duas leitoras os
    montam —, e o que varia entre eles é só a data.
  */
  const porUnidade = new Map<string, { contexto: SeriesContext; datas: string[] }>();
  for (const alvo of alvos) {
    const chave = chaveDaUnidade(alvo.contexto.scopeHash, alvo.contexto.channel);
    const grupo = porUnidade.get(chave);
    if (grupo) grupo.datas.push(alvo.effectiveDate);
    else porUnidade.set(chave, { contexto: alvo.contexto, datas: [alvo.effectiveDate] });
  }

  return sql.join(
    [...porUnidade.values()].map(
      ({ contexto, datas }) =>
        sql`(${contextFilter(alias, contexto)}
             AND ${sql.raw(`${alias}.effective_date`)} IN (${sql.join(
               datas.map((data) => sql`${data}::date`),
               sql`, `,
             )}))`,
    ),
    sql` OR `,
  );
}

/**
 * As três colunas que dizem de qual alvo a linha veio.
 *
 * A vigência está entre elas porque a chave a inclui: uma consulta que traz
 * julho e agosto da mesma unidade precisa que cada linha diga de qual das duas
 * ela é — ver {@link chaveDoAlvo}.
 */
function colunasDoAlvo(alias: string) {
  return sql`${sql.raw(`${alias}.scope_hash`)} AS scope_hash,
             ${channelSql(`${alias}.source_label`)} AS canal,
             ${sql.raw(`${alias}.effective_date`)}::text AS vigencia`;
}

/** O que toda linha lida em lote traz, além do que ela mesma diz. */
interface LinhaComAlvo extends Record<string, unknown> {
  scope_hash: string;
  canal: string | null;
  vigencia: string;
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
      entregues.add(chaveDoAlvo(row.scope_hash, row.canal, row.vigencia));
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
    const chave = chaveDoAlvo(row.scope_hash, row.canal, row.vigencia);
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
    const chave = chaveDoAlvo(row.scope_hash, row.canal, row.vigencia);
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
