import { competencia, dentroDaCompetencia, type Competencia } from "./periodo";
import type { Canal } from "./dominio";
import type { EntradaDoFaturado } from "./faturado";
import {
  fatorDeImposto,
  valorDaDisponibilidade,
  type ParametrosDoCadastro,
  type ViagemDoMapa,
} from "./mapa-rota";

/** Um valor sem imposto na moeda em que a planilha o imprime. */
function brutar(valor: number, p: ParametrosDoCadastro): number {
  return valor * fatorDeImposto(p.aliquotas, p.parcelaDentroDoMunicipio);
}
import { basesDaQuinzena } from "./persistencia";
import type {
  BasesDaPlanilha,
  DiaDaPlanilha,
  ProcedenciaDosInsumos,
  QuinzenaDaPlanilha,
} from "./reconciliacao";
import { lerConciliacao, valorDe } from "./leitores/conciliacao";
import {
  descontoDeDisponibilidadeDoMes,
  lerDisponibilidade,
  type DescontoDeDisponibilidadeDoMes,
} from "./leitores/disponibilidade";
import { lerCtes } from "./leitores/cte";
import { lerOperacao } from "./leitores/operacao";
import { lerPagamento } from "./leitores/pagamento";
import { lerRequisicoes } from "./leitores/requisicoes";

/**
 * A PROVA PONTA A PONTA — os relatórios e o cadastro, sem a planilha no meio.
 *
 * `reconciliacao.ts` prova uma coisa boa e insuficiente: **dadas as entradas da
 * própria planilha**, o motor chega ao mesmo resultado. Isso é equivalência de
 * fórmula. O que decide a substituição da planilha é outra pergunta: *os
 * relatórios que a operação importa, mais o cadastro que ela digita, chegam ao
 * mesmo resultado?* — e essa a reconciliação não respondia, porque os insumos
 * dela saíam do gabarito.
 *
 * Este módulo monta a **mesma** estrutura `QuinzenaDaPlanilha` que a
 * reconciliação consome, com uma diferença que é o módulo inteiro: os
 * parâmetros vêm do cadastro do sistema, as viagens vêm do 2Art, e as bases vêm
 * do 03.08.20 e do 03.08.12.09 — pelo **mesmo caminho que a produção usa**
 * (`basesDaQuinzena`, de `persistencia.ts`, sem passar perto de banco). Só as
 * colunas do gabarito continuam saindo da `.xlsb`, que é o papel dela.
 *
 * **Por que isso não é um detalhe de teste.** A diferença entre os dois
 * caminhos já apareceu, e é material: na 1ª quinzena de julho/2026 a planilha
 * digita R$ 11.649,87 na linha da **disponibilidade**, e esse número é o
 * `Desconto Frete mínimo` do 03.08.20 — que o sistema, corretamente, põe na
 * linha do **complementar negativo**. Rodando pelo gabarito as duas leituras
 * coincidem por construção; rodando pelos relatórios elas discordam, e é a
 * discordância que precisa estar na mesa.
 *
 * **Nada aqui inventa entrada que falte.** Um relatório ausente vira `null` na
 * base correspondente, e o motor apaga a linha que dependia dele — como faz em
 * produção.
 */

/** Os arquivos de uma quinzena, já lidos em bytes. */
export interface RelatoriosDaQuinzena {
  quinzena: 1 | 2;
  /** O 2Art — uma linha por viagem. */
  operacao?: Buffer;
  /** O 03.08.20 — demonstrativo de pagamento. */
  pagamento?: Buffer;
  /** O 03.08.12.09 — requisições de despesa. */
  requisicoes?: Buffer;
  /**
   * O 03.08.18 — disponibilidade de frota.
   *
   * **É do mês, e não da quinzena.** O desconto que ele mede é acumulado no mês
   * inteiro e aplicado uma vez, no fechamento da 2ª. A prova soma o arquivo das
   * duas quinzenas e desduplica por `(aba, dia)`, de modo que enviá-lo inteiro
   * numa delas, partido nas duas, ou repetido nas duas dá o mesmo total. Ver
   * `descontoDeDisponibilidadeDoMes`.
   */
  disponibilidade?: Buffer;
  /** O 03.08.15 — CT-es por verba. */
  ctes?: Buffer;
  /** O 03.02.59.02 — conciliação CT-e × SRTrans. */
  conciliacao?: Buffer;
}

/** O que o cadastro do sistema responde para a quinzena. */
export interface CadastroDaProva {
  quinzena: 1 | 2;
  parametros: ParametrosDoCadastro;
  custoVariavelPrevistoPor25Viagens: number;
}

export interface EntradaDaProva {
  ano: number;
  mes: number;
  canal: Canal;
  cadastro: CadastroDaProva[];
  relatorios: RelatoriosDaQuinzena[];
  /** As colunas do gabarito, extraídas da `.xlsb` — o que a planilha publica. */
  gabarito: QuinzenaDaPlanilha[];
}

/**
 * Agrupa as viagens do 2Art por dia, na forma que o motor consome.
 *
 * É a mesma transformação que `viagensPorDia` faz lendo do banco, e por isso
 * carrega os mesmos seis campos — inclusive `caixasDeRota`, que decide se a
 * viagem é da Rota ou do AS (ver `ehDaRota`), e `tipoDeIndisponibilidade`, de
 * onde sai a linha `INDISPONIBILIDADE`.
 */
export function diarioPorDia(
  bytes: Buffer,
  periodo: Competencia,
): { viagens: ViagemDoMapa[] }[] {
  const { linhas } = lerOperacao(bytes);
  const porDia = new Map<string, ViagemDoMapa[]>();
  for (const v of linhas) {
    if (!v.dia || !dentroDaCompetencia(periodo, v.dia)) continue;
    const doDia = porDia.get(v.dia) ?? [];
    /*
      As colunas que o motor lê do diário moram em `detalhe` — `lerOperacao` põe
      ali tudo o que a apuração não soma. É a mesma leitura que `viagensPorDia`
      faz do banco, campo por campo.
    */
    const d = v.detalhe;
    doDia.push({
      frota: String(v.frota ?? ""),
      cargaAtual: d?.cargaAtual ?? "",
      tipoDeImposto: d?.tipoDeImposto ?? "",
      valorFaturado: Number(v.valorFaturado ?? 0),
      /* `null` atravessa: coluna ausente não é "carregou zero caixa de Rota". */
      caixasDeRota:
        d?.caixasDeRota === null || d?.caixasDeRota === undefined
          ? null
          : Number(d.caixasDeRota),
      /* O segundo termo do corte do canal — ver `ehDaRota`, em `mapa-rota.ts`. */
      caixasDeAs:
        d?.caixasDeAs === null || d?.caixasDeAs === undefined ? null : Number(d.caixasDeAs),
      tipoDeIndisponibilidade: d?.tipoDeIndisponibilidade ?? "",
    });
    porDia.set(v.dia, doDia);
  }
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, viagens]) => ({ viagens }));
}

/** As bases pelo caminho de produção, ou `null` em cada uma que faltar. */
function basesDosRelatorios(
  relatorios: RelatoriosDaQuinzena,
  canal: Canal,
  diario: { viagens: ViagemDoMapa[] }[],
  /** A quinzena e a disponibilidade do **mês** — ver `disponibilidadeDoMesDaProva`. */
  periodo: { quinzena: 1 | 2; disponibilidadeDoMes: DescontoDeDisponibilidadeDoMes | null },
  /** O contrato da quinzena — só o fator de imposto é lido aqui. */
  parametros: ParametrosDoCadastro,
): BasesDaPlanilha {
  const descontos = relatorios.pagamento
    ? lerPagamento(relatorios.pagamento).descontos.map((d) => ({
        canal: d.canal,
        tipo: d.tipo as string,
        valor: d.valor,
      }))
    : null;
  const requisicoes = relatorios.requisicoes
    ? lerRequisicoes(relatorios.requisicoes).linhas.map((r) => ({
        canal: r.canal,
        status: r.status,
        valor: r.valor,
        /* Decide em que quadro a requisição cai — ver `quadroDaEquipeDeEntrega`. */
        vbz: r.verba.vbz,
      }))
    : null;

  /*
    O mesmo `basesDaQuinzena` da produção, e não uma segunda versão dele. É a
    razão de este módulo importar `persistencia.ts` por uma função pura: se a
    regra de qual desconto alimenta qual base mudar lá, a prova muda junto — que
    é exatamente o que se quer de um gate.
  */
  const doMotor = basesDaQuinzena(descontos, canal, diario, requisicoes, periodo);

  return {
    devolucao: doMotor.devolucao,
    disponibilidade:
      doMotor.disponibilidade === null ? null : valorDaDisponibilidade(doMotor.disponibilidade),
    complementarNegativo: doMotor.complementarNegativo,
    /*
      **Convertidos para a moeda da planilha antes de entrar aqui.**
      `BasesDaPlanilha` é, por contrato, "as bases como a `.xlsb` as traz" — e a
      `.xlsb` traz `Outros Custos!F4` já **brutado**, enquanto o 03.08.12.09 traz
      o valor **sem imposto**. As outras três bases não têm esse problema: a
      planilha e os relatórios as escrevem na mesma moeda (sem imposto), e é a
      linha do motor que as bruta.

      Sem esta conversão a prova entregava R$ 80.247,66 onde a planilha imprime
      R$ 109.695,38, e o `TOTAL GERAL UNIDADE` saía R$ 97.515,48 menor — com a
      diferença aparecendo como defeito nosso, que é o que ela deixaria de ser
      no instante em que alguém olhasse a moeda.
    */
    outrosCustos:
      doMotor.outrosCustos === null
        ? null
        : doMotor.outrosCustos.fonte === "REQUISICOES"
          ? brutar(doMotor.outrosCustos.medida.valor, parametros)
          : doMotor.outrosCustos.valor,
    indisponibilidade:
      doMotor.indisponibilidade === null
        ? null
        : doMotor.indisponibilidade.fonte === "DIARIO"
          ? doMotor.indisponibilidade.medida.valor
          : doMotor.indisponibilidade.valor,
    /*
      A `VBZ 06` sai do mesmo 03.08.12.09 que os outros custos e vai para o
      quarto quadro. Sem esta linha ela chegaria à reconciliação como zero — e o
      `TOTAL GERAL UNIDADE` sairia R$ 248.834,84 menor sem nada acusar, porque a
      planilha também não escreve nada ali.
    */
    equipeDeEntrega:
      doMotor.equipeDeEntrega === null
        ? null
        : doMotor.equipeDeEntrega.fonte === "REQUISICOES"
          ? brutar(doMotor.equipeDeEntrega.medida.valor, parametros)
          : doMotor.equipeDeEntrega.valor,
  };
}

/**
 * O 03.08.18 do mês, somado das remessas das duas quinzenas — **cada uma
 * cortada pelo seu período**.
 *
 * É o mesmo corte que `disponibilidadeDoMes` faz no banco, e existe aqui pelo
 * mesmo motivo: a remessa da 2ª quinzena costuma vir com o mês inteiro, e a da
 * 1ª às vezes também. Somando as duas cruas, os dias comuns entrariam duas
 * vezes; deixando a desduplicação resolver, o total passaria a depender de qual
 * remessa foi lida primeiro. Cortando cada uma no período dela, a sobreposição
 * não chega a existir: a 1ª contribui com os dias 1 a 15 do que recebeu, a 2ª
 * com os dias 16 ao fim.
 *
 * O gate roda por aqui, e é por isso que o corte tem de estar nos dois lugares:
 * uma prova que lê diferente do produto não prova o produto.
 *
 * `null` quando nenhuma das duas remessas trouxe o arquivo.
 */
function disponibilidadeDoMesDaProva(
  relatorios: RelatoriosDaQuinzena[],
  canal: Canal,
  ano: number,
  mes: number,
): DescontoDeDisponibilidadeDoMes | null {
  const remessas = relatorios.filter((r) => r.disponibilidade);
  if (remessas.length === 0) return null;
  const dias = remessas.flatMap((r) => {
    const periodo = competencia(ano, mes, r.quinzena);
    return lerDisponibilidade(r.disponibilidade!).linhas.filter((l) =>
      dentroDaCompetencia(periodo, l.dia),
    );
  });
  return descontoDeDisponibilidadeDoMes(dias, canal);
}

/** O lado SRTrans pelos relatórios — ver `faturado.ts`. */
function faturadoDosRelatorios(
  relatorios: RelatoriosDaQuinzena,
  canal: Canal,
  periodo: Competencia,
): EntradaDoFaturado {
  const totalDoDemonstrativo = relatorios.pagamento
    ? (lerPagamento(relatorios.pagamento).totais.find((t) => t.canal === canal)?.total ??
      null)
    : null;

  const cte = relatorios.ctes
    ? lerCtes(relatorios.ctes)
        .linhas.filter((l) => l.canal === canal && l.dia && dentroDaCompetencia(periodo, l.dia))
        .reduce((soma, l) => soma + l.valorCte, 0)
    : null;

  /*
    Os dois ajustes que a aba `Abertura` nomeia como sendo do 03.02.59.02. O
    saldo complementar entra com o sinal do relatório — negativo —, e por isso
    não há subtração escrita aqui: somar já desconta.
  */
  let ajustesDaConciliacao: number | null = null;
  if (relatorios.conciliacao) {
    const lida = lerConciliacao(relatorios.conciliacao);
    const semCte = valorDe(lida, {
      secao: canal,
      rubrica: "NF-e sem CT-e na Quinzena",
      coluna: "EMITIDO",
    });
    const saldo = valorDe(lida, {
      secao: canal,
      rubrica: "Desconto Saldo Complementar Negativo",
      coluna: "EMITIDO",
    });
    if (semCte !== null || saldo !== null) {
      ajustesDaConciliacao = (semCte ?? 0) + (saldo ?? 0);
    }
  }

  return {
    canal,
    quinzena: periodo.quinzena === 1 ? 1 : 2,
    totalDoDemonstrativo,
    cte,
    notasFiscais: null /* a série 748 — ver ONDE_INFORMAR_AS_NOTAS */,
    ajustesDaConciliacao,
  };
}

/**
 * Monta o fechamento com insumos **operacionais** e colunas do gabarito.
 *
 * O resultado entra em `montarMatriz` exatamente como o do extrator da `.xlsb`
 * — mesma estrutura, mesma comparação, mesmo relatório. O que muda é
 * `procedencia`, e é ela que faz a matriz dizer se o que rodou foi a prova
 * ponta a ponta ou a equivalência de fórmula.
 */
export function montarProvaPontaAPonta(entrada: EntradaDaProva): QuinzenaDaPlanilha[] {
  /*
    A disponibilidade é do mês, e por isso é somada uma vez, das duas quinzenas,
    antes do laço. Ver `disponibilidadeDoMesDaProva`.
  */
  const doMes = disponibilidadeDoMesDaProva(
    entrada.relatorios,
    entrada.canal,
    entrada.ano,
    entrada.mes,
  );

  return entrada.gabarito.map((doGabarito): QuinzenaDaPlanilha => {
    const q = doGabarito.quinzena;
    const periodo = competencia(entrada.ano, entrada.mes, q);
    const cadastro = entrada.cadastro.find((c) => c.quinzena === q);
    const relatorios = entrada.relatorios.find((r) => r.quinzena === q);

    /* Sem cadastro ou sem 2Art não há prova operacional desta quinzena. */
    if (!cadastro || !relatorios?.operacao) return doGabarito;

    const diario = diarioPorDia(relatorios.operacao, periodo);
    const dias: DiaDaPlanilha[] = [];

    return {
      ...doGabarito,
      parametros: cadastro.parametros,
      custoVariavelPrevistoPor25Viagens: cadastro.custoVariavelPrevistoPor25Viagens,
      /*
        `dias` fica vazio e o diário entra por `diarioOperacional`: a estrutura
        do gabarito guarda viagens **agrupadas** para caber no repositório, e
        reagrupar o 2Art só para desagrupar em seguida seria perder informação
        no meio do caminho por nenhum ganho.
      */
      dias,
      diarioOperacional: diario,
      bases: basesDosRelatorios(
        relatorios,
        entrada.canal,
        diario,
        { quinzena: q, disponibilidadeDoMes: doMes },
        cadastro.parametros,
      ),
      faturado: faturadoDosRelatorios(relatorios, entrada.canal, periodo),
      procedencia: {
        parametros: "CADASTRO_DO_SISTEMA",
        diario: "RELATORIO_2ART",
        bases: relatorios.pagamento
          ? "RELATORIOS_IMPORTADOS"
          : "CELULAS_DIGITADAS_DA_PLANILHA",
      } satisfies ProcedenciaDosInsumos,
    };
  });
}
