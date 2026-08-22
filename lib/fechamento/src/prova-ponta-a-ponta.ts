import { competencia, dentroDaCompetencia, type Competencia } from "./periodo";
import type { Canal } from "./dominio";
import type { EntradaDoFaturado } from "./faturado";
import type { ParametrosDoCadastro, ViagemDoMapa } from "./mapa-rota";
import { basesDaQuinzena } from "./persistencia";
import type {
  BasesDaPlanilha,
  DiaDaPlanilha,
  ProcedenciaDosInsumos,
  QuinzenaDaPlanilha,
} from "./reconciliacao";
import { lerConciliacao, valorDe } from "./leitores/conciliacao";
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
      }))
    : null;

  /*
    O mesmo `basesDaQuinzena` da produção, e não uma segunda versão dele. É a
    razão de este módulo importar `persistencia.ts` por uma função pura: se a
    regra de qual desconto alimenta qual base mudar lá, a prova muda junto — que
    é exatamente o que se quer de um gate.
  */
  const doMotor = basesDaQuinzena(descontos, canal, diario, requisicoes);

  return {
    devolucao: doMotor.devolucao,
    disponibilidade: doMotor.disponibilidade,
    complementarNegativo: doMotor.complementarNegativo,
    outrosCustos:
      doMotor.outrosCustos === null
        ? null
        : doMotor.outrosCustos.fonte === "REQUISICOES"
          ? doMotor.outrosCustos.medida.valor
          : doMotor.outrosCustos.valor,
    indisponibilidade:
      doMotor.indisponibilidade === null
        ? null
        : doMotor.indisponibilidade.fonte === "DIARIO"
          ? doMotor.indisponibilidade.medida.valor
          : doMotor.indisponibilidade.valor,
  };
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
      bases: basesDosRelatorios(relatorios, entrada.canal, diario),
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
