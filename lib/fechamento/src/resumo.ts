import { centavos, type Canal } from "./dominio";
import {
  CANAIS_COM_PAINEL,
  type Ausencia,
  type DeParaConferido,
  type Papel,
  type Quadro,
  type QuadroConferido,
} from "./de-para";
import { comoDestravar, type DiagnosticoDoCadastro } from "./cadastro-porta";
import type { LinhaDoMapa, MapaDaQuinzena, QuadroDoMapa } from "./mapa-rota";
import { levantarInconsistencias, type Inconsistencia } from "./inconsistencias";
import type { NaturezaDaVerba } from "./verbas";

/**
 * O mês inteiro numa página — o `RESUMO GERAL` da planilha, sem planilha.
 *
 * A apuração responde por **uma** quinzena, que é o grão do fechamento. Mas o
 * documento que a transportadora discute com a Ambev é mensal: a aba `Resumo
 * Geral` da `.xlsb` põe 1ª quinzena, 2ª quinzena e TOTAL lado a lado, e é
 * olhando para as três colunas que alguém decide se o mês fecha. Sem esta
 * consolidação, comparar exigia abrir duas telas e somar à mão — e somar à mão
 * o que o sistema já sabe é exatamente o trabalho que ele existe para tirar.
 *
 * **Por que a aritmética mora aqui e não na tela.** Pela mesma razão de
 * `lib/fechamento-gerencial`: uma soma feita no navegador é uma segunda opinião
 * sobre remuneração, e o produto não pode ter duas. Este módulo é puro — recebe
 * o que o banco guardou e devolve as três colunas —, o que permite conferir o
 * mês inteiro num teste sem subir nada.
 *
 * **Por que `null` e não `0` na quinzena que não apurou.** Uma quinzena sem
 * competência aberta e uma quinzena que valeu zero são coisas diferentes, e a
 * planilha confunde as duas (a célula vazia e a célula com `R$ -` têm a mesma
 * cara). Aqui a coluna vazia é `null` até o fim, e o total de uma quinzena só
 * é a soma das duas quando as duas existem — a alternativa seria apresentar
 * meio mês com cara de mês inteiro.
 *
 * **Por que o fecho compara com o 03.08.20, e não com o que a planilha chama de
 * `TOTAL GERAL UNIDADE`.** Aquela coluna é a reconstrução da própria planilha,
 * feita com um fator de conversão digitado (1,366960) que não sai de nenhum dos
 * arquivos. Reproduzi-la seria reproduzir o erro. O que este resumo põe lado a
 * lado são os dois números que têm documento: o que a Ambev **emitiu** em CT-e
 * (03.08.15) e o que o demonstrativo **assinado** diz que ela pagaria
 * (03.08.20).
 */

/** Um valor nas três colunas da planilha. `null` é ausência, nunca zero. */
export interface TresColunas {
  primeira: number | null;
  segunda: number | null;
  /** A soma das que existem, ou `null` quando nenhuma existe. */
  total: number | null;
}

/** Uma verba no mês, nas três colunas. */
export interface LinhaDoResumo {
  vbz: number;
  nome: string;
  natureza: NaturezaDaVerba | string;
  emitido: TresColunas;
  apurado: TresColunas;
}

/** As verbas de uma natureza, somadas — os quadros da planilha. */
export interface BlocoDoResumo {
  natureza: NaturezaDaVerba | string;
  titulo: string;
  linhas: LinhaDoResumo[];
  emitido: TresColunas;
  apurado: TresColunas;
}

/**
 * Um desconto do 03.08.20 no mês.
 *
 * Eles entram no resumo porque são as linhas que o `RESUMO GERAL` da planilha
 * traz entre as verbas e o total — `DESCONTO DE DEVOLUÇÃO`, `DESCONTO DE
 * DISPONIBILIDADE`, `DESCONTO COMPLEMENTAR NEGATIVO`. E entram **fora** das
 * somas: o relatório diz, em cada linha, que o valor já foi subtraído da verba
 * correspondente. Somá-los ao emitido descontaria duas vezes.
 */
export interface DescontoDoResumo {
  tipo: string;
  /** O rótulo curto, o que a tela mostra na coluna da esquerda. */
  nome: string;
  valores: TresColunas;
}

/* ---------------------------------------------------------------------------
   O painel da planilha, nas mesmas três colunas
   ------------------------------------------------------------------------ */

/**
 * Uma linha do `RESUMO` da planilha, no mês.
 *
 * A diferença para {@link LinhaDoResumo} não é de formato, é de pergunta. A
 * linha do resumo é uma **verba** — o recorte com que o fechamento apura, e o
 * único que os arquivos sustentam um a um. Esta é uma **linha da planilha** —
 * o recorte com que a Ambev e a transportadora discutem, que corta a mesma
 * conta por tipo de frota e por atividade. As duas dizem o mesmo dinheiro e
 * não dizem as mesmas linhas, e é por isso que existem as duas.
 */
export interface LinhaDoPainel {
  chave: string;
  /** O rótulo como a planilha o grita — para conferir contra o arquivo. */
  rotulo: string;
  /** O mesmo rótulo escrito como se escreve — o que a tela mostra. */
  nome: string;
  papel: Papel;
  /** `null` quando o número é do conjunto, ou quando não há número. */
  valores: TresColunas;
  /** A chave do conjunto quando o número é de várias linhas juntas. */
  conjunto: string | null;
  /** Por que não há número. `null` quando há. */
  ausencia: Ausencia | null;
  porque: string;
}

/** Um número do 03.08.20 que vale para várias linhas da planilha ao mesmo tempo. */
export interface ConjuntoDoPainel {
  chave: string;
  nome: string;
  /** Os nomes das linhas que dividem este número, na ordem da planilha. */
  linhas: string[];
  valores: TresColunas;
  porque: string;
}

export interface QuadroDoPainel {
  quadro: Quadro;
  titulo: string;
  linhas: LinhaDoPainel[];
  conjuntos: ConjuntoDoPainel[];
  /** O que o 03.08.20 fecha para o quadro. */
  total: TresColunas;
  /** O que o de-para preencheu — parcelas menos descontos, conjunto uma vez. */
  somado: TresColunas;
  /** `total − somado`. Zero é o quadro fechando. */
  residuo: TresColunas;
  /** Os nomes das linhas da planilha entre as quais o resíduo se divide. */
  semLastro: string[];
  /**
   * As verbas que estão no total do quadro e que nenhuma linha da planilha
   * nomeia — a outra metade do resíduo.
   *
   * Sem ela, um resíduo teimoso manda procurar no lugar errado: `semLastro` diz
   * "falta enquadrar uma linha nossa" e esta diz "falta uma linha no painel
   * deles", que são problemas opostos com o mesmo sintoma.
   */
  verbasSemLinha: { vbz: number; nome: string; valores: TresColunas }[];
}

/**
 * O painel da planilha de um canal, no mês.
 *
 * **Por que ele carrega dois totais.** `soma` é a soma dos quadros na coluna
 * que o de-para lê — sem imposto, que é a moeda em que a planilha escreve. O
 * `demonstrativo` é o `Total Remuneração` que o relatório fecha, com imposto —
 * e é o mesmo número que a conferência por verba mostra no seu fecho. Ter os
 * dois lado a lado, com a diferença entre eles nomeada, é o que permite às duas
 * leituras baterem sem que nenhuma converta nada: a diferença é subtração de
 * dois números do mesmo arquivo, não um fator digitado.
 */
export interface PainelDaPlanilha {
  canal: Canal;
  quadros: QuadroDoPainel[];
  /** A soma dos quadros, na coluna que a planilha usa (sem imposto). */
  soma: TresColunas;
  /** O imposto — `demonstrativo − soma`, medido, nunca presumido. */
  imposto: TresColunas;
  /** O `Total Remuneração` do 03.08.20 — o número que as duas abas partilham. */
  demonstrativo: TresColunas;
}

/* ---------------------------------------------------------------------------
   O devido — o mesmo painel, calculado do contrato
   ------------------------------------------------------------------------ */

/**
 * Uma linha do painel nas três leituras que o fechamento discute.
 *
 * **Devido** é o que o contrato manda pagar: o motor (`mapa-rota.ts`) calcula
 * do cadastro e do diário, sem olhar o demonstrativo. **Demonstrado** é o que o
 * 03.08.20 diz que a Ambev vai pagar. A **diferença** é a conversa.
 *
 * Ter as duas colunas vindas de fontes independentes é o que faz a comparação
 * valer alguma coisa. Enquanto o painel era só uma releitura do 03.08.20, ele
 * concordava consigo mesmo por construção — e uma conferência que não pode
 * discordar não confere nada.
 */
export interface LinhaComparada {
  chave: string;
  rotulo: string;
  papel: string;
  /** O que o contrato manda pagar. `null` quando falta cadastro ou documento. */
  devido: TresColunas;
  /** O que o 03.08.20 demonstra. `null` quando ele não foi importado. */
  demonstrado: TresColunas;
  /** `devido − demonstrado`. `null` quando falta qualquer um dos dois. */
  diferenca: TresColunas;
  /**
   * O número que o 03.08.20 traz para esta linha **junto com outras**.
   *
   * **É o campo que impede a coluna do demonstrado de mentir por omissão.** Seis
   * das linhas do quadro fixo dividem um número só no relatório — ele traz a
   * frota fixa somada e não a parte por tipo —, e o demonstrado delas é `null`
   * por isso, não por falta de arquivo. Sem este campo as duas ausências
   * chegavam à tela como o mesmo traço, e a diferença é enorme: uma pede um
   * relatório que não existe, a outra não pede nada.
   *
   * O devido, esse, aparece linha a linha — ele sai do contrato, que **tem** a
   * partição por tipo de frota. É essa assimetria que o painel comparado
   * mostra, e ela é o produto: a planilha pede seis números, o demonstrativo dá
   * um, o contrato dá os seis.
   *
   * `null` na linha que o relatório sustenta sozinha.
   */
  conjunto: ConjuntoDoPainel | null;
  /** A conta que produziu o devido, por quinzena — a memória de cálculo. */
  memoria: { primeira: string | null; segunda: string | null };
  /** O que falta para o devido existir. `null` quando ele existe. */
  falta: string | null;
}

/**
 * A comparação no único nível em que as duas fontes falam a mesma língua.
 *
 * **O problema que ela resolve.** Seis linhas do quadro fixo dividem um número
 * só no 03.08.20 — o relatório traz a frota fixa somada e não a parte por tipo.
 * O contrato **tem** a partição, e por isso o devido delas aparece linha a
 * linha; o demonstrado, não. Linha a linha, portanto, a diferença é
 * incalculável, e a coluna fica vazia — o que é correto e é pouco: quem está
 * conferindo quer saber se o conjunto fecha.
 *
 * Fecha ou não fecha, e dá para medir: a soma do devido das seis contra o
 * número que o relatório traz para as seis. **É a única subtração honesta
 * disponível**, e ela não rateia nada — não afirma quanto do agregado é de
 * `PADRONIZADO` e quanto é de `VANS`, que é exatamente o que o demonstrativo
 * não diz e ninguém deve inventar.
 *
 * `devido` é `null` se **qualquer** linha do conjunto estiver sem devido: cinco
 * sextos de uma soma não é a soma, e compará-la com o total do relatório
 * produziria uma diferença que mede a nossa lacuna em vez da divergência real.
 */
export interface ConjuntoComparado {
  chave: string;
  nome: string;
  /** Os nomes das linhas que dividem o número do demonstrativo. */
  linhas: string[];
  /** A soma do devido das linhas do conjunto. `null` se faltar alguma. */
  devido: TresColunas;
  /** O que o 03.08.20 traz para todas elas juntas. */
  demonstrado: TresColunas;
  diferenca: TresColunas;
  /** Por que o relatório não parte este número — a frase do de-para. */
  porque: string;
}

export interface QuadroComparado {
  quadro: string;
  titulo: string;
  linhas: LinhaComparada[];
  /** Os números que o relatório traz para várias linhas de uma vez. */
  conjuntos: ConjuntoComparado[];
  devido: TresColunas;
  demonstrado: TresColunas;
  diferenca: TresColunas;
}

/**
 * O painel do canal com as duas leituras lado a lado.
 *
 * `cadastro` diz qual contrato produziu o devido — sem isso, um número que
 * surpreende não tem onde ser conferido.
 */
export interface PainelComparado {
  canal: Canal;
  quadros: QuadroComparado[];
  /** De qual cadastro veio cada quinzena. `null` na que não tem. */
  cadastro: {
    primeira: { cadastroId: string; vigenteDe: string } | null;
    segunda: { cadastroId: string; vigenteDe: string } | null;
  };
  /** O que falta para o mês fechar inteiro, sem repetição. */
  pendencias: string[];
  /**
   * O que as duas leituras não conciliam, nomeado e ordenado por tamanho.
   *
   * Derivado das linhas acima, e não uma quarta fonte — ver
   * `inconsistencias.ts`. **Não soma, e não deve somar**: os itens se
   * sobrepõem, e uma lista que fechasse a conta faria o painel concordar
   * consigo mesmo por construção.
   */
  inconsistencias: Inconsistencia[];
}

export interface CanalDoResumo {
  canal: Canal;
  blocos: BlocoDoResumo[];
  /**
   * Os descontos do demonstrativo, sem imposto e já subtraídos das verbas.
   * Informativos: existem para conferir contra a planilha, não para somar.
   */
  descontos: DescontoDoResumo[];
  emitido: TresColunas;
  /** O que a apuração reconstruiu — a soma dos apurados. */
  conferido: TresColunas;
  /** O emitido que nenhuma fonte sustenta. */
  semFonte: TresColunas;
  /** `Total Remuneração` do 03.08.20 — o lado que a Ambev assina. */
  demonstrativo: TresColunas;
  /** `emitido − demonstrativo`. Positivo: emitiu-se mais do que o combinado. */
  diferenca: TresColunas;
  /**
   * O mesmo mês nas linhas da planilha. `null` quando não há painel deste canal.
   */
  painel: PainelDaPlanilha | null;
  /**
   * Por que não há painel — e é por isso que existe, em vez de a tela deduzir.
   *
   * As duas ausências têm o mesmo sintoma e exigem coisas opostas de quem olha.
   * `CANAL_SEM_CATALOGO` é trabalho nosso: os rótulos do painel do AS não foram
   * transcritos, e escrevê-los por analogia com os da Rota inventaria a metade
   * que falta. `SEM_DEMONSTRATIVO` é trabalho de quem importa: o catálogo do
   * canal existe e o 03.08.20 da quinzena não chegou.
   *
   * Sem esta distinção a tela dizia "ainda não foi transcrito" nos dois casos —
   * inclusive para a **própria Rota**, que está transcrita —, e mandava procurar
   * no lugar errado quem só precisava subir um arquivo.
   */
  semPainel: "CANAL_SEM_CATALOGO" | "SEM_DEMONSTRATIVO" | null;
  /**
   * O painel calculado do contrato, ao lado do demonstrado.
   *
   * `null` quando não há cadastro vigente em nenhuma das duas quinzenas — e aí
   * a tela mostra o que sempre mostrou, sem inventar uma coluna vazia com cara
   * de zero. Ver `cadastro-porta.ts`.
   */
  comparado: PainelComparado | null;
  /**
   * Por que há (ou não há) devido, quinzena a quinzena.
   *
   * **É o campo que aposenta a frase genérica.** A tela dizia "nenhum cadastro
   * respondeu por esta unidade nesta competência" para três causas diferentes —
   * unidade não cadastrada, aba digitada no mês errado, linha obrigatória em
   * branco —, e as três mandam procurar em lugares diferentes. Agora cada
   * quinzena traz a porta em que parou, e `comoDestravar` escreve o conserto.
   *
   * É por quinzena, e não uma por canal, porque as portas fecham de formas
   * diferentes nas duas metades do mês: a aba da 1ª responde pela 2ª por
   * herança, e um mês aberto só na 2ª não tem primeira porta nenhuma. `null` na
   * quinzena que não existe — que é diferente de existir e não ter cadastro.
   */
  cadastro: {
    primeira: CadastroNaTela | null;
    segunda: CadastroNaTela | null;
  };
}

/**
 * O diagnóstico com o texto já escrito — o que a tela recebe.
 *
 * `destrava` vem pronto do domínio, e não montado no navegador, pela mesma
 * razão que a aritmética: qual é o conserto de "faltam três obrigatórias" é
 * conhecimento de negócio, e escrevê-lo no `.tsx` daria duas versões da mesma
 * instrução — a testada e a que a pessoa lê. É `null` quando o cadastro
 * respondeu, porque não há o que destravar.
 */
export interface CadastroNaTela extends DiagnosticoDoCadastro {
  destrava: { problema: string; conserto: string } | null;
}

/** O que uma quinzena traz para o resumo — o que o banco guardou dela. */
export interface QuinzenaApurada {
  quinzena: 1 | 2;
  competenciaId: string;
  chave: string;
  estado: string;
  /** Nulo quando a competência existe e ainda não apurou. */
  verbas:
    | {
        vbz: number;
        canal: string;
        nome: string;
        natureza: string;
        emitido: number;
        esperado: number | null;
      }[]
    | null;
  /**
   * O `Total Remuneração` do 03.08.20, por canal.
   *
   * Vem da soma de `valor_faturado` dos itens gravados, que é como o próprio
   * relatório o fecha (frete + outros custos). Nulo quando o 03.08.20 não foi
   * importado — e aí a coluna do fecho fica vazia em vez de zerada.
   */
  demonstrativo: { canal: Canal; total: number }[] | null;
  /** Os descontos do 03.08.20, somados por canal e tipo. */
  descontos: { canal: Canal; tipo: string; valor: number }[] | null;
  /**
   * O painel da planilha desta quinzena, já conferido contra o 03.08.20.
   *
   * Nulo quando o demonstrativo não foi importado — e nulo é o certo: um painel
   * de zeros diria que a quinzena não pagou nada, que é outra afirmação.
   */
  paineis?: DeParaConferido[] | null;
  /**
   * O painel **calculado** desta quinzena, por canal — o que o contrato deve.
   *
   * Vem montado de fora, e não calculado aqui, pela mesma razão que as verbas:
   * este módulo consolida o que o banco guardou e não roda a conta de novo.
   * Quem monta é `lerResumoDoMes`, que sabe pedir o cadastro à porta e ler as
   * viagens. Nulo quando não há cadastro vigente para a quinzena.
   */
  calculados?: { canal: Canal; mapa: MapaDaQuinzena }[] | null;
  /** Qual cadastro produziu os `calculados`. Nulo quando não houve. */
  cadastroUsado?: { cadastroId: string; vigenteDe: string } | null;
  /**
   * Por que o cadastro respondeu — ou em qual das três portas ele parou.
   *
   * Anda ao lado de `calculados` e não dentro dele porque é justamente quando
   * `calculados` é nulo que este campo importa. Ver `cadastro-porta.ts`.
   */
  diagnosticoDoCadastro?: { canal: Canal; diagnostico: DiagnosticoDoCadastro }[] | null;
}

export interface ResumoDoMes {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  /** As duas quinzenas do mês, existam elas ou não. */
  quinzenas: {
    quinzena: 1 | 2;
    competenciaId: string | null;
    chave: string | null;
    estado: string | null;
    apurada: boolean;
    temDemonstrativo: boolean;
  }[];
  canais: CanalDoResumo[];
}

/** Os quadros, na ordem em que a planilha os empilha. */
const BLOCOS: { natureza: string; titulo: string }[] = [
  { natureza: "FIXO", titulo: "Fixo — a parcela contratada da frota e da equipe" },
  { natureza: "ADMINISTRATIVO", titulo: "Administrativo — o repasse fixo" },
  { natureza: "VARIAVEL", titulo: "Variável — o que a operação rodou" },
  { natureza: "COMPLEMENTAR", titulo: "Complementar — a despesa extra aprovada" },
];

/**
 * Soma duas colunas que podem não existir.
 *
 * `null + 5` não é `5`: é `5` com a ressalva de que metade do mês não foi
 * apurada. A ressalva viaja no próprio dado — o total só some quando as duas
 * quinzenas somem —, porque uma tela que recebe um número não tem como saber
 * que ele é meio.
 */
function somar(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return centavos((a ?? 0) + (b ?? 0));
}

function tresColunas(primeira: number | null, segunda: number | null): TresColunas {
  return { primeira, segunda, total: somar(primeira, segunda) };
}

function acumular(alvo: TresColunas, parcela: TresColunas): TresColunas {
  return {
    primeira: somar(alvo.primeira, parcela.primeira),
    segunda: somar(alvo.segunda, parcela.segunda),
    total: somar(alvo.total, parcela.total),
  };
}

const VAZIO: TresColunas = { primeira: null, segunda: null, total: null };

function subtrair(a: TresColunas, b: TresColunas): TresColunas {
  const menos = (x: number | null, y: number | null) =>
    x === null || y === null ? null : centavos(x - y);
  return {
    primeira: menos(a.primeira, b.primeira),
    segunda: menos(a.segunda, b.segunda),
    total: menos(a.total, b.total),
  };
}

/**
 * O painel da planilha de um canal, com as duas quinzenas lado a lado.
 *
 * A estrutura — quais quadros, quais linhas, em que ordem — é do catálogo do
 * de-para e é a mesma nas duas quinzenas; o que muda de uma para a outra é só o
 * número. Por isso o esqueleto vem da quinzena que existir, e a que faltar
 * deixa a coluna dela vazia — igual ao resto desta tela, e pelo mesmo motivo:
 * meio mês importado é o estado normal de quem está trabalhando.
 */
function montarPainel(
  canal: Canal,
  primeira: DeParaConferido | null,
  segunda: DeParaConferido | null,
): PainelDaPlanilha | null {
  const esqueleto = primeira ?? segunda;
  if (!esqueleto) return null;

  /* A mesma chave nas duas quinzenas é a mesma linha — é para isso que ela existe. */
  const linhaDe = (painel: DeParaConferido | null, chave: string) =>
    painel?.quadros.flatMap((q) => q.linhas).find((l) => l.chave === chave) ?? null;
  const quadroDe = (painel: DeParaConferido | null, quadro: Quadro) =>
    painel?.quadros.find((q) => q.quadro === quadro) ?? null;

  const quadros: QuadroDoPainel[] = esqueleto.quadros.map((modelo) => {
    const q1 = quadroDe(primeira, modelo.quadro);
    const q2 = quadroDe(segunda, modelo.quadro);

    const linhas: LinhaDoPainel[] = modelo.linhas.map((modeloDaLinha) => {
      const l1 = linhaDe(primeira, modeloDaLinha.chave);
      const l2 = linhaDe(segunda, modeloDaLinha.chave);
      return {
        chave: modeloDaLinha.chave,
        rotulo: modeloDaLinha.rotulo,
        nome: modeloDaLinha.nome,
        papel: modeloDaLinha.papel,
        valores: tresColunas(l1?.valor ?? null, l2?.valor ?? null),
        conjunto: l1?.conjunto?.chave ?? l2?.conjunto?.chave ?? null,
        /* A ausência é a mesma nas duas quando as duas a têm; basta dizer uma vez. */
        ausencia: l1?.ausencia ?? l2?.ausencia ?? null,
        porque: modeloDaLinha.porque,
      };
    });

    /*
      Os conjuntos aparecem uma vez cada, na ordem da primeira linha que os
      cita — que é a ordem da planilha. Repeti-los por linha multiplicaria na
      tela um número que existe uma vez só.
    */
    const conjuntos: ConjuntoDoPainel[] = [];
    for (const linha of modelo.linhas) {
      const chave = linha.conjunto?.chave;
      if (!chave || conjuntos.some((c) => c.chave === chave)) continue;
      const c1 = linhaDe(primeira, linha.chave)?.conjunto ?? null;
      const c2 = linhaDe(segunda, linha.chave)?.conjunto ?? null;
      const modeloDoConjunto = c1 ?? c2;
      if (!modeloDoConjunto) continue;
      conjuntos.push({
        chave,
        nome: modeloDoConjunto.rotulo,
        linhas: modeloDoConjunto.linhas.map(
          (c) => linhas.find((l) => l.chave === c)?.nome ?? c,
        ),
        valores: tresColunas(c1?.valor ?? null, c2?.valor ?? null),
        porque: modeloDoConjunto.porque,
      });
    }

    /* O que uma quinzena não sustenta, a outra ainda pode: a lista é a união. */
    const semLastro = [...new Set([...(q1?.semLastro ?? []), ...(q2?.semLastro ?? [])])];

    /* Idem para a verba que o painel não nomeia: uma vez por VBZ, nas duas colunas. */
    const vbzsSemLinha = [
      ...new Map(
        [...(q1?.verbasSemLinha ?? []), ...(q2?.verbasSemLinha ?? [])].map((v) => [v.vbz, v]),
      ).values(),
    ].sort((a, b) => a.vbz - b.vbz);
    const valorSemLinha = (painel: QuadroConferido | null, vbz: number) =>
      painel?.verbasSemLinha.find((v) => v.vbz === vbz)?.valor ?? null;

    return {
      quadro: modelo.quadro,
      titulo: modelo.titulo,
      linhas,
      conjuntos,
      total: tresColunas(q1?.total ?? null, q2?.total ?? null),
      somado: tresColunas(q1?.somado ?? null, q2?.somado ?? null),
      residuo: tresColunas(q1?.residuo ?? null, q2?.residuo ?? null),
      semLastro,
      verbasSemLinha: vbzsSemLinha.map((v) => ({
        vbz: v.vbz,
        nome: v.nome,
        valores: tresColunas(valorSemLinha(q1, v.vbz), valorSemLinha(q2, v.vbz)),
      })),
    };
  });

  return {
    canal,
    quadros,
    soma: tresColunas(primeira?.totalDosQuadros ?? null, segunda?.totalDosQuadros ?? null),
    imposto: tresColunas(primeira?.diferenca ?? null, segunda?.diferenca ?? null),
    demonstrativo: tresColunas(
      primeira?.totalDoRelatorio ?? null,
      segunda?.totalDoRelatorio ?? null,
    ),
  };
}

/**
 * O painel de uma quinzena só, na mesma forma do mensal.
 *
 * A tela da competência aberta faz a mesma pergunta da tela do mês, com uma
 * coluna em vez de três — e uma forma só é o que garante que as duas mostrem a
 * mesma coisa. Reformatá-la no navegador seria pedir para as duas divergirem
 * no dia em que uma delas mudasse.
 */
export function painelDeUmaQuinzena(
  quinzena: 1 | 2,
  conferido: DeParaConferido,
): PainelDaPlanilha {
  return montarPainel(
    conferido.canal,
    quinzena === 1 ? conferido : null,
    quinzena === 2 ? conferido : null,
  )!;
}

/**
 * Os conjuntos de um quadro, com o devido somado das linhas que os dividem.
 *
 * Sai das linhas já comparadas, e não de uma segunda leitura do painel: o
 * conjunto **é** o que aquelas linhas têm em comum, e derivá-lo delas garante
 * que a soma seja das mesmas linhas que a tela mostra. Ver
 * {@link ConjuntoComparado}.
 */
function conjuntosComparados(linhas: LinhaComparada[]): ConjuntoComparado[] {
  const porChave = new Map<string, { conjunto: ConjuntoDoPainel; devido: TresColunas }>();

  for (const linha of linhas) {
    if (!linha.conjunto) continue;
    const atual = porChave.get(linha.conjunto.chave);
    if (!atual) {
      porChave.set(linha.conjunto.chave, { conjunto: linha.conjunto, devido: linha.devido });
      continue;
    }
    atual.devido = acumular(atual.devido, linha.devido);
  }

  return [...porChave.values()].map(({ conjunto, devido }) => {
    /*
      Uma parcela ausente apaga a soma. `acumular` trata `null` como zero para
      poder somar colunas que só uma quinzena tem — o que é certo lá e errado
      aqui: cinco sextos de um conjunto não é o conjunto.
    */
    const completo = (escolher: (v: TresColunas) => number | null) =>
      linhas
        .filter((l) => l.conjunto?.chave === conjunto.chave)
        .every((l) => escolher(l.devido) !== null);
    const doDevido: TresColunas = {
      primeira: completo((v) => v.primeira) ? devido.primeira : null,
      segunda: completo((v) => v.segunda) ? devido.segunda : null,
      total: completo((v) => v.total) ? devido.total : null,
    };
    return {
      chave: conjunto.chave,
      nome: conjunto.nome,
      linhas: conjunto.linhas,
      devido: doDevido,
      demonstrado: conjunto.valores,
      diferenca: subtrair(doDevido, conjunto.valores),
      porque: conjunto.porque,
    };
  });
}

/**
 * Casa o painel calculado com o painel demonstrado, quadro a quadro.
 *
 * As duas leituras já falam a mesma língua — as chaves de linha são as mesmas
 * em `mapa-rota.ts` e em `de-para.ts`, e é para isso que elas foram escritas
 * iguais. O que esta função faz é pôr o número de cada uma na mesma linha e
 * nomear a diferença.
 *
 * **A linha que só uma das duas tem continua aparecendo.** Uma linha sem
 * demonstrado (porque o 03.08.20 não veio) e uma linha sem devido (porque falta
 * cadastro) são estados diferentes e ambos legítimos; escondê-las faria o
 * painel parecer completo quando não está.
 */
export function compararPaineis(
  canal: Canal,
  calculado: { primeira: MapaDaQuinzena | null; segunda: MapaDaQuinzena | null },
  demonstrado: PainelDaPlanilha | null,
  cadastro: PainelComparado["cadastro"],
): PainelComparado | null {
  const esqueleto = calculado.primeira ?? calculado.segunda;
  if (!esqueleto) return null;

  const quadroDe = (m: MapaDaQuinzena | null, quadro: string): QuadroDoMapa | null =>
    m?.quadros.find((q) => q.quadro === quadro) ?? null;
  const linhaDe = (m: MapaDaQuinzena | null, quadro: string, chave: string): LinhaDoMapa | null =>
    quadroDe(m, quadro)?.linhas.find((l) => l.chave === chave) ?? null;

  /* O demonstrado guarda a linha pela mesma chave, num quadro de mesmo nome. */
  const doDemonstrado = (quadro: string, chave: string): TresColunas => {
    const q = demonstrado?.quadros.find((x) => x.quadro === quadro);
    const l = q?.linhas.find((x) => x.chave === chave);
    return l ? l.valores : VAZIO;
  };

  /*
    O conjunto a que a linha pertence no **demonstrado**, quando pertence.

    Sai do painel do 03.08.20 e não do mapa: é uma limitação do relatório, não
    do contrato. Ver `LinhaComparada.conjunto`.
  */
  const conjuntoDoDemonstrado = (quadro: string, chave: string): ConjuntoDoPainel | null => {
    const q = demonstrado?.quadros.find((x) => x.quadro === quadro);
    const l = q?.linhas.find((x) => x.chave === chave);
    if (!l?.conjunto) return null;
    return q?.conjuntos.find((c) => c.chave === l.conjunto) ?? null;
  };

  const quadros: QuadroComparado[] = esqueleto.quadros.map((modelo) => {
    const linhas: LinhaComparada[] = modelo.linhas.map((modeloDaLinha) => {
      const l1 = linhaDe(calculado.primeira, modelo.quadro, modeloDaLinha.chave);
      const l2 = linhaDe(calculado.segunda, modelo.quadro, modeloDaLinha.chave);
      const devido = tresColunas(l1?.valor ?? null, l2?.valor ?? null);
      const dem = doDemonstrado(modelo.quadro, modeloDaLinha.chave);
      return {
        chave: modeloDaLinha.chave,
        rotulo: modeloDaLinha.rotulo,
        papel: modeloDaLinha.papel,
        devido,
        demonstrado: dem,
        diferenca: subtrair(devido, dem),
        conjunto: conjuntoDoDemonstrado(modelo.quadro, modeloDaLinha.chave),
        memoria: { primeira: l1?.memoria ?? null, segunda: l2?.memoria ?? null },
        /* A falta é a mesma nas duas quando as duas a têm; basta dizer uma vez. */
        falta: l1?.falta ?? l2?.falta ?? null,
      };
    });

    const q1 = quadroDe(calculado.primeira, modelo.quadro);
    const q2 = quadroDe(calculado.segunda, modelo.quadro);
    const devido = tresColunas(q1?.total ?? null, q2?.total ?? null);
    const dem =
      demonstrado?.quadros.find((x) => x.quadro === modelo.quadro)?.total ?? VAZIO;

    return {
      quadro: modelo.quadro,
      titulo: modelo.titulo,
      linhas,
      conjuntos: conjuntosComparados(linhas),
      devido,
      demonstrado: dem,
      diferenca: subtrair(devido, dem),
    };
  });

  return {
    canal,
    quadros,
    cadastro,
    pendencias: [
      ...new Set([
        ...(calculado.primeira?.pendencias ?? []),
        ...(calculado.segunda?.pendencias ?? []),
      ]),
    ],
    inconsistencias: levantarInconsistencias(canal, quadros),
  };
}

/**
 * O diagnóstico do cadastro de um canal, na quinzena dada.
 *
 * `null` quando a quinzena não existe no mês — e a distinção importa: uma
 * competência que ninguém abriu não tem cadastro **nem porta**, e dizer
 * "unidade não encontrada" ali mandaria conferir um código que ninguém chegou a
 * procurar.
 */
function diagnosticoDe(q: QuinzenaApurada | null, canal: Canal): CadastroNaTela | null {
  if (!q) return null;
  const achado = q.diagnosticoDoCadastro?.find((d) => d.canal === canal)?.diagnostico;
  if (!achado) return null;
  /* O único funil até a tela — e por isso o único lugar que escreve o texto. */
  return { ...achado, destrava: comoDestravar(achado) };
}

/**
 * Monta o resumo do mês a partir do que o banco guardou de cada quinzena.
 *
 * Recebe zero, uma ou duas quinzenas: o mês em que só a segunda foi importada é
 * o caso comum de quem está no meio do trabalho, e ele tem de aparecer inteiro,
 * com a primeira coluna vazia e dizendo por quê — em vez de esperar as duas
 * para mostrar qualquer coisa.
 */
export function montarResumo(entrada: {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  quinzenas: QuinzenaApurada[];
}): ResumoDoMes {
  const daQuinzena = (n: 1 | 2) => entrada.quinzenas.find((q) => q.quinzena === n) ?? null;
  const primeira = daQuinzena(1);
  const segunda = daQuinzena(2);

  const valorDe = (q: QuinzenaApurada | null, escolher: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => number | null, filtro: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => boolean) => {
    if (!q?.verbas) return null;
    const alvos = q.verbas.filter(filtro);
    if (alvos.length === 0) return null;
    const valores = alvos.map(escolher).filter((n): n is number => n !== null);
    if (valores.length === 0) return null;
    return centavos(valores.reduce((s, n) => s + n, 0));
  };

  /* O universo de verbas é a união das duas quinzenas: uma verba que só
     apareceu numa delas ainda é linha do mês, com a outra coluna vazia. */
  const canais = new Map<Canal, Map<number, { nome: string; natureza: string }>>();
  for (const q of entrada.quinzenas) {
    for (const v of q.verbas ?? []) {
      const canal = v.canal as Canal;
      const porVbz = canais.get(canal) ?? new Map();
      if (!porVbz.has(v.vbz)) porVbz.set(v.vbz, { nome: v.nome, natureza: v.natureza });
      canais.set(canal, porVbz);
    }
  }

  const montados: CanalDoResumo[] = [];
  for (const [canal, verbas] of [...canais].sort((a, b) => a[0].localeCompare(b[0]))) {
    const blocos: BlocoDoResumo[] = [];
    let emitidoDoCanal = VAZIO;
    let conferidoDoCanal = VAZIO;
    let semFonteDoCanal = VAZIO;

    for (const { natureza, titulo } of BLOCOS) {
      const daNatureza = [...verbas]
        .filter(([, v]) => v.natureza === natureza)
        .sort((a, b) => a[0] - b[0]);
      if (daNatureza.length === 0) continue;

      const linhas: LinhaDoResumo[] = [];
      let emitidoDoBloco = VAZIO;
      let apuradoDoBloco = VAZIO;

      for (const [vbz, { nome }] of daNatureza) {
        const mesma = (v: { vbz: number; canal: string }) => v.vbz === vbz && v.canal === canal;
        const emitido = tresColunas(
          valorDe(primeira, (v) => v.emitido, mesma),
          valorDe(segunda, (v) => v.emitido, mesma),
        );
        const apurado = tresColunas(
          valorDe(primeira, (v) => v.esperado, mesma),
          valorDe(segunda, (v) => v.esperado, mesma),
        );
        linhas.push({ vbz, nome, natureza, emitido, apurado });
        emitidoDoBloco = acumular(emitidoDoBloco, emitido);
        apuradoDoBloco = acumular(apuradoDoBloco, apurado);
      }

      blocos.push({ natureza, titulo, linhas, emitido: emitidoDoBloco, apurado: apuradoDoBloco });
      emitidoDoCanal = acumular(emitidoDoCanal, emitidoDoBloco);
      conferidoDoCanal = acumular(conferidoDoCanal, apuradoDoBloco);
    }

    /* O sem fonte é o emitido das verbas que a apuração não reconstruiu — e é
       contado sobre as verbas, não como `emitido − conferido`: a subtração
       daria o mesmo número por acaso e esconderia a verba que fecha com
       diferença. */
    const semFonte = (q: QuinzenaApurada | null) =>
      valorDe(q, (v) => v.emitido, (v) => v.canal === canal && v.esperado === null);
    semFonteDoCanal = tresColunas(semFonte(primeira), semFonte(segunda));

    /*
      Os descontos aparecem na ordem em que a planilha os empilha, e só os que
      alguma das duas quinzenas trouxe: uma linha de desconto zerada em todo o
      mês é ruído — o relatório traz as quatro de disponibilidade sempre, e
      três delas costumam ser zero.
    */
    const tiposDeDesconto = new Map<string, string>([
      ["DEVOLUCAO", "Desconto de devolução"],
      ["DISPONIBILIDADE_CUSTO_FIXO", "Disponibilidade — custo fixo"],
      ["DISPONIBILIDADE_EQUIPE", "Disponibilidade — equipe de entrega"],
      ["DISPONIBILIDADE_INDIRETO", "Disponibilidade — custo indireto"],
      ["DISPONIBILIDADE_FATOR_AJUDANTE", "Disponibilidade — fator ajudante"],
      ["FRETE_MINIMO", "Desconto de frete mínimo"],
    ]);
    const descontos: DescontoDoResumo[] = [];
    for (const [tipo, nome] of tiposDeDesconto) {
      const valorDoDesconto = (q: QuinzenaApurada | null) => {
        const achado = q?.descontos?.find((d) => d.canal === canal && d.tipo === tipo);
        return achado ? achado.valor : null;
      };
      const valores = tresColunas(valorDoDesconto(primeira), valorDoDesconto(segunda));
      if (valores.total === null || valores.total === 0) continue;
      descontos.push({ tipo, nome, valores });
    }

    const doDemonstrativo = (q: QuinzenaApurada | null) =>
      q?.demonstrativo?.find((d) => d.canal === canal)?.total ?? null;
    const demonstrativo = tresColunas(doDemonstrativo(primeira), doDemonstrativo(segunda));

    const doPainel = (q: QuinzenaApurada | null) =>
      q?.paineis?.find((p) => p.canal === canal) ?? null;
    const painel = montarPainel(canal, doPainel(primeira), doPainel(segunda));

    montados.push({
      canal,
      blocos,
      descontos,
      emitido: emitidoDoCanal,
      conferido: conferidoDoCanal,
      semFonte: semFonteDoCanal,
      demonstrativo,
      diferenca: subtrair(emitidoDoCanal, demonstrativo),
      painel,
      /* O devido, ao lado do demonstrado — ver `compararPaineis`. */
      comparado: compararPaineis(
        canal,
        {
          primeira: primeira?.calculados?.find((c) => c.canal === canal)?.mapa ?? null,
          segunda: segunda?.calculados?.find((c) => c.canal === canal)?.mapa ?? null,
        },
        painel,
        {
          primeira: primeira?.cadastroUsado ?? null,
          segunda: segunda?.cadastroUsado ?? null,
        },
      ),
      semPainel: painel
        ? null
        : CANAIS_COM_PAINEL.includes(canal)
          ? "SEM_DEMONSTRATIVO"
          : "CANAL_SEM_CATALOGO",
      cadastro: {
        primeira: diagnosticoDe(primeira, canal),
        segunda: diagnosticoDe(segunda, canal),
      },
    });
  }

  return {
    ano: entrada.ano,
    mes: entrada.mes,
    unidade: entrada.unidade,
    transportadora: entrada.transportadora,
    quinzenas: ([1, 2] as const).map((n) => {
      const q = daQuinzena(n);
      return {
        quinzena: n,
        competenciaId: q?.competenciaId ?? null,
        chave: q?.chave ?? null,
        estado: q?.estado ?? null,
        apurada: !!q?.verbas,
        temDemonstrativo: !!q?.demonstrativo,
      };
    }),
    canais: montados,
  };
}
