/**
 * A REGRA DE AGREGAÇÃO — de lançamento contábil a valor comparável.
 *
 * ---------------------------------------------------------------------------
 * O problema, em uma frase
 * ---------------------------------------------------------------------------
 * O extrato traz N lançamentos por placa por mês, e a auditoria compara **um**
 * valor por placa por mês. Tudo o que este arquivo faz é atravessar essa
 * distância de um jeito que alguém possa conferir depois — e, sobretudo, sem
 * nunca escolher em silêncio entre dois números.
 *
 * ---------------------------------------------------------------------------
 * Por que somar não é a parte difícil
 * ---------------------------------------------------------------------------
 * Somar é trivial. O que é difícil é saber **o que** somar, e aqui há três
 * situações que se parecem e não são a mesma coisa. Medidas no extrato real de
 * 2026 (903 linhas, 104 placas, 9 competências):
 *
 * 1. **Um documento, duas rubricas.** 73 chaves contábeis trazem duas linhas
 *    com o **mesmo** `NUMDOC` e valores diferentes — a RPH-9E62 de maio, por
 *    exemplo, com R$ 5.450,76 e R$ 16.352,26. São principal e juros do mesmo
 *    pagamento. **Somam.**
 * 2. **Dois documentos, mesmo valor.** 14 pares têm a mesma placa, o mesmo mês
 *    e o mesmo valor, diferindo em `NUMDOC` e `DATATU`. São dois pagamentos que
 *    por acaso têm a mesma parcela. **Somam** — e é exatamente por isso que a
 *    impressão digital de uma linha inclui a data de escrituração.
 * 3. **A linha repetida.** 5 pares são idênticos em **todas** as 43 colunas.
 *    Todos da mesma placa (RZG-5A37), um por mês de maio a setembro, com
 *    `NUMDOC` sequencial. O padrão — uma placa, todo mês, sempre duplicada — é
 *    assinatura de repetição do export, não de dois pagamentos iguais no mesmo
 *    dia sob o mesmo documento.
 *
 * O caso 3 é o único que **não** soma. E ele não é decidido aqui: a linha
 * repetida fica de fora da soma, preservada e marcada, e alguém confirma. O que
 * este módulo garante é que ela nunca desapareça em silêncio — nem somada como
 * se fosse pagamento, nem descartada como se fosse lixo.
 *
 * ---------------------------------------------------------------------------
 * O sinal
 * ---------------------------------------------------------------------------
 * `VLRREA` é negativo no extrato inteiro: é débito. O remunerado é positivo.
 * Comparar os dois sem inverter faria a auditoria acusar, em toda a frota, uma
 * diferença de duas vezes o valor. O consolidado é apresentado em positivo, e o
 * valor original com o sinal fica gravado ao lado — a reconciliação contra o
 * extrato se faz por ele.
 */

import { arredondarCentavos } from "../dinheiro";
import type { LinhaDoExtrato } from "./extrato";

/** O que uma linha virou depois da classificação. */
export type StatusDoLancamento =
  | "ACEITO"
  | "DUPLICATA_PROVAVEL"
  | "PENDENTE_DE_CLASSIFICACAO"
  | "REJEITADO";

/**
 * O que uma pessoa já decidiu, e que a classificação tem de respeitar.
 *
 * `DUPLICATA_CONFIRMADA` quer dizer "sim, o export repetiu a linha" — a cópia
 * é rejeitada e não entra na soma, agora por decisão e não por precaução.
 * `LANCAMENTOS_DISTINTOS` quer dizer o contrário: são dois pagamentos, somam.
 * `CLASSIFICAR_ATIVO` diz de que tipo é uma placa que o cadastro não resolveu.
 */
export type TipoDeDecisao =
  | "DUPLICATA_CONFIRMADA"
  | "LANCAMENTOS_DISTINTOS"
  | "CLASSIFICAR_ATIVO";

export interface DecisaoTomada {
  tipo: TipoDeDecisao;
  /** A impressão digital do grupo repetido, ou a placa normalizada. */
  chave: string;
  /** O `entity_type` escolhido, em `CLASSIFICAR_ATIVO`. */
  valor?: string | null;
}

/**
 * De que tipo é o ativo desta placa — respondido pelo acervo, nunca pela conta.
 *
 * Devolve `null` quando não sabe, e é essencial que devolva: `C.D.C. - VP` é
 * "crédito direto ao consumidor, veículo pesado", e pesado é cavalo, é caminhão
 * e é carreta. Deduzir o tipo dali acertaria na maioria e erraria calado no
 * resto — e o erro só apareceria como um cavalo somado entre as carretas.
 */
export type ResolvedorDeTipo = (placa: string) => string | null;

export interface LancamentoClassificado extends LinhaDoExtrato {
  status: StatusDoLancamento;
  motivo: string | null;
  /** O tipo resolvido pelo cadastro, ou `null` na fila de classificação. */
  entityType: string | null;
  /** `(CODFIL, NUMDOC, SERIE, TIPDOC, ANALIT, placa, competência)`. */
  chaveContabil: string;
  /** O grupo que vira um consolidado: competência + placa + tipo + rubrica. */
  grupo: string;
}

export interface ValorConsolidado {
  competencia: string;
  placa: string;
  entityType: string;
  rubrica: string;
  /** A despesa do mês, em positivo. */
  valor: number;
  /** Quantos lançamentos entraram nesta soma. Nunca escondido da tela. */
  lancamentos: number;
  /** A linha de menor `rowIndex` do grupo — a âncora do rastreio. */
  rowIndexAncora: number;
  /** As contas analíticas que compõem o valor, sem repetição. */
  contas: string[];
  /** Os documentos que o compõem, sem repetição e em ordem. */
  documentos: string[];
}

export interface CompetenciaApurada {
  competencia: string;
  lancamentosAceitos: number;
  placas: number;
  valor: number;
  /** Ver {@link marcarCompetenciasParciais}. */
  parcial: boolean;
  motivoParcial: string | null;
}

export interface RelatorioDaApuracao {
  linhasRecebidas: number;
  linhasAceitas: number;
  linhasRejeitadas: number;
  linhasDuplicadas: number;
  linhasPendentesDeClassificacao: number;
  valoresConsolidados: number;
  /** Quantos consolidados vieram de mais de um lançamento. */
  gruposAgregados: number;
  placasSemClassificacao: string[];
  /** A soma dos valores que ficaram de fora por duplicata provável. */
  valorEmDuplicatas: number;
  competencias: CompetenciaApurada[];
}

export interface Apuracao {
  lancamentos: LancamentoClassificado[];
  consolidados: ValorConsolidado[];
  relatorio: RelatorioDaApuracao;
}

/** A rubrica que o extrato alimenta hoje. Uma só, e nomeada. */
export const RUBRICA_FINAME_REAL = "finame_real";

const SEP = "\u0001";

/**
 * A chave contábil: o que faz duas linhas serem o **mesmo lançamento**.
 *
 * Note o que ela **não** decide: duas linhas com a mesma chave não são
 * duplicata por isso. O extrato lança principal e juros sob o mesmo documento,
 * e as duas somam. A chave serve para agrupar e para nomear — é por ela que uma
 * pendência é endereçada —, não para descartar.
 */
export function chaveContabilDe(linha: LinhaDoExtrato): string {
  return [
    linha.codfil ?? "",
    linha.numdoc,
    linha.serie ?? "",
    linha.tipdoc ?? "",
    linha.contaAnaliticaCodigo ?? "",
    linha.placa,
    linha.competencia,
  ].join(SEP);
}

function grupoDe(linha: LinhaDoExtrato, entityType: string): string {
  return [linha.competencia, linha.placa, entityType, RUBRICA_FINAME_REAL].join(SEP);
}

function decisaoDe(
  decisoes: readonly DecisaoTomada[],
  tipo: TipoDeDecisao,
  chave: string,
): DecisaoTomada | undefined {
  /*
    A última decisão daquela chave é a que vale. A lista chega em ordem
    cronológica de quem a leu, e percorrê-la de trás para a frente é o que faz
    uma revisão de opinião valer sem apagar a anterior — no banco elas são
    append-only exatamente para isso.
  */
  for (let i = decisoes.length - 1; i >= 0; i--) {
    const d = decisoes[i];
    if (d.tipo === tipo && d.chave === chave) return d;
  }
  return undefined;
}

/**
 * A apuração inteira: classificar, consolidar e contar.
 *
 * Função pura — as mesmas linhas produzem sempre a mesma apuração. É isso que
 * torna a reimportação idempotente no grão do valor: reler o arquivo não pode
 * dar outro número, e o teste que roda sobre a planilha real é o que sustenta
 * essa afirmação.
 */
export function apurar(
  linhas: readonly LinhaDoExtrato[],
  opcoes: {
    resolverTipo: ResolvedorDeTipo;
    decisoes?: readonly DecisaoTomada[];
    linhasRejeitadasNaLeitura?: number;
    /** A competência corrente, para a marca de mês parcial. `YYYY-MM-01`. */
    competenciaCorrente?: string | null;
  },
): Apuracao {
  const decisoes = opcoes.decisoes ?? [];

  /* Passo 1 — a duplicata provável, antes de qualquer soma.

     Duas linhas idênticas em tudo. A primeira (menor `rowIndex`) fica; as
     demais saem da soma e ficam pendentes. Ordem estável de propósito: qual das
     duas cópias é "a primeira" não pode depender da ordem em que o arquivo foi
     lido, ou a mesma planilha produziria pendências diferentes a cada leitura. */
  const porImpressao = new Map<string, LinhaDoExtrato[]>();
  for (const linha of linhas) {
    const iguais = porImpressao.get(linha.impressaoDigital) ?? [];
    iguais.push(linha);
    porImpressao.set(linha.impressaoDigital, iguais);
  }
  const duplicadas = new Map<number, string>();
  for (const [impressao, iguais] of porImpressao) {
    if (iguais.length < 2) continue;
    const decisao = decisaoDe(decisoes, "LANCAMENTOS_DISTINTOS", impressao);
    if (decisao) continue; // alguém disse que são pagamentos distintos: somam.
    const confirmada = decisaoDe(decisoes, "DUPLICATA_CONFIRMADA", impressao);
    const ordenadas = [...iguais].sort((a, b) => a.rowIndex - b.rowIndex);
    for (const copia of ordenadas.slice(1)) {
      duplicadas.set(
        copia.rowIndex,
        confirmada
          ? `Duplicata confirmada: esta linha repete integralmente a linha ${ordenadas[0].rowIndex}, ` +
            `e foi confirmada como repetição do export. Não entra na soma.`
          : `Duplicata provável: esta linha é idêntica à linha ${ordenadas[0].rowIndex} em todas as ` +
            `colunas, inclusive na data de escrituração. Ficou fora da soma e aguarda confirmação — ` +
            `somá-la sem confirmar cobraria duas vezes o mesmo pagamento, e descartá-la sem ` +
            `confirmar perderia um pagamento que talvez exista.`,
      );
    }
  }

  /* Passo 2 — classificar cada linha. */
  const lancamentos: LancamentoClassificado[] = [];
  for (const linha of linhas) {
    const motivoDuplicata = duplicadas.get(linha.rowIndex);
    const decisaoDeTipo = decisaoDe(decisoes, "CLASSIFICAR_ATIVO", linha.placa);
    const entityType = decisaoDeTipo?.valor ?? opcoes.resolverTipo(linha.placa);

    let status: StatusDoLancamento = "ACEITO";
    let motivo: string | null = null;
    if (motivoDuplicata !== undefined) {
      const confirmada = motivoDuplicata.startsWith("Duplicata confirmada");
      status = confirmada ? "REJEITADO" : "DUPLICATA_PROVAVEL";
      motivo = motivoDuplicata;
    } else if (entityType === null) {
      status = "PENDENTE_DE_CLASSIFICACAO";
      motivo =
        `A placa ${linha.placa} não foi encontrada no acervo nem no cadastro, e o tipo de ativo ` +
        `não é deduzido da conta contábil: "${linha.contaAnalitica ?? "sem conta"}" vale para ` +
        `cavalo, caminhão e carreta igualmente. O lançamento está preservado e aguarda ` +
        `classificação; enquanto isso a competência fica marcada como incompleta.`;
    }

    lancamentos.push({
      ...linha,
      status,
      motivo,
      entityType,
      chaveContabil: chaveContabilDe(linha),
      grupo: entityType === null ? "" : grupoDe(linha, entityType),
    });
  }

  /* Passo 3 — consolidar o que foi aceito. */
  const porGrupo = new Map<string, LancamentoClassificado[]>();
  for (const l of lancamentos) {
    if (l.status !== "ACEITO") continue;
    const grupo = porGrupo.get(l.grupo) ?? [];
    grupo.push(l);
    porGrupo.set(l.grupo, grupo);
  }

  const consolidados: ValorConsolidado[] = [];
  for (const grupo of porGrupo.values()) {
    const ordenado = [...grupo].sort((a, b) => a.rowIndex - b.rowIndex);
    const primeiro = ordenado[0];
    consolidados.push({
      competencia: primeiro.competencia,
      placa: primeiro.placa,
      entityType: primeiro.entityType as string,
      rubrica: RUBRICA_FINAME_REAL,
      /*
        A soma é dos valores **originais**, invertida no fim — e não a soma dos
        módulos.

        Nos dados de hoje dá o mesmo número, porque o extrato inteiro é débito.
        A diferença aparece no dia do **estorno**: um lançamento positivo no
        razão é dinheiro que voltou, e somá-lo em módulo o contaria como custo.
        Inverter o total é reversível e honesto; `Math.abs` por linha não é.

        Arredondado ao centavo na saída, e só na saída. O extrato traz três e
        quatro casas (`-5896.428`), e truncar antes de somar deslocaria o total
        da competência em relação ao razão — que é justamente o que a
        reconciliação existe para pegar.
      */
      valor: arredondar(-ordenado.reduce((s, l) => s + l.valorOriginal, 0)),
      lancamentos: ordenado.length,
      rowIndexAncora: primeiro.rowIndex,
      contas: [...new Set(ordenado.map((l) => l.contaAnalitica ?? "sem conta"))].sort(),
      documentos: [...new Set(ordenado.map((l) => l.numdoc))].sort(),
    });
  }
  consolidados.sort(
    (a, b) =>
      a.competencia.localeCompare(b.competencia) || a.placa.localeCompare(b.placa),
  );

  /* Passo 4 — o relatório, que é o que a tela mostra e o que o teste confere. */
  const aceitos = lancamentos.filter((l) => l.status === "ACEITO");
  const duplicados = lancamentos.filter((l) => l.status === "DUPLICATA_PROVAVEL");
  const rejeitados = lancamentos.filter((l) => l.status === "REJEITADO");
  const pendentes = lancamentos.filter((l) => l.status === "PENDENTE_DE_CLASSIFICACAO");

  const relatorio: RelatorioDaApuracao = {
    linhasRecebidas: linhas.length + (opcoes.linhasRejeitadasNaLeitura ?? 0),
    linhasAceitas: aceitos.length,
    linhasRejeitadas: rejeitados.length + (opcoes.linhasRejeitadasNaLeitura ?? 0),
    linhasDuplicadas: duplicados.length,
    linhasPendentesDeClassificacao: pendentes.length,
    valoresConsolidados: consolidados.length,
    gruposAgregados: consolidados.filter((c) => c.lancamentos > 1).length,
    placasSemClassificacao: [...new Set(pendentes.map((l) => l.placa))].sort(),
    valorEmDuplicatas: arredondar(
      duplicados.reduce((s, l) => s + l.valorAbsoluto, 0),
    ),
    competencias: marcarCompetenciasParciais(
      consolidados,
      opcoes.competenciaCorrente ?? null,
    ),
  };

  return { lancamentos, consolidados, relatorio };
}

/**
 * Quais competências podem estar parciais — medido, nunca fixado no código.
 *
 * Duas causas, e as duas viram a mesma marca com motivos diferentes:
 *
 * - **o mês ainda corre.** A competência corrente é parcial por definição, e
 *   dizer isso não custa medição nenhuma;
 * - **o arquivo trouxe menos do que costuma trazer.** Abaixo de 70% da mediana
 *   de lançamentos das demais competências do mesmo arquivo. No extrato de
 *   2026, setembro traz 49 lançamentos contra uma mediana de 105 — 47%.
 *
 * O corte é uma medida do próprio arquivo, e não um mês escrito no código, pela
 * razão óbvia: "setembro está parcial" é verdade sobre um arquivo, não sobre
 * setembro. Um mês real com queda de frota cairia aqui também — e é o desfecho
 * certo: a marca diz "confira", não "está errado".
 */
export function marcarCompetenciasParciais(
  consolidados: readonly ValorConsolidado[],
  competenciaCorrente: string | null,
): CompetenciaApurada[] {
  const porCompetencia = new Map<string, ValorConsolidado[]>();
  for (const c of consolidados) {
    const lista = porCompetencia.get(c.competencia) ?? [];
    lista.push(c);
    porCompetencia.set(c.competencia, lista);
  }

  const contagens = [...porCompetencia.values()].map((lista) =>
    lista.reduce((s, c) => s + c.lancamentos, 0),
  );
  const mediana = medianaDe(contagens);

  return [...porCompetencia.entries()]
    .map(([competencia, lista]) => {
      const lancamentos = lista.reduce((s, c) => s + c.lancamentos, 0);
      const proporcao = mediana === 0 ? 1 : lancamentos / mediana;
      const corrente = competenciaCorrente !== null && competencia === competenciaCorrente;
      const rala = porCompetencia.size > 2 && proporcao < 0.7;
      return {
        competencia,
        lancamentosAceitos: lancamentos,
        placas: new Set(lista.map((c) => c.placa)).size,
        valor: arredondar(lista.reduce((s, c) => s + c.valor, 0)),
        parcial: corrente || rala,
        motivoParcial: corrente
          ? "A competência ainda está em curso: o mês não fechou, e novos lançamentos ainda entram."
          : rala
            ? `A competência traz ${lancamentos} lançamentos, ${Math.round(proporcao * 100)}% da ` +
              `mediana das demais (${mediana}). Pode estar parcial — confira antes de comparar.`
            : null,
      };
    })
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
}

/**
 * A reconciliação: o consolidado tem de fechar com o extrato de origem.
 *
 * Toda linha lida está em exatamente um dos três destinos — somada, retida como
 * duplicata provável, ou rejeitada —, e nada mais. É a conferência que impede
 * que uma mudança futura na regra de agregação perca dinheiro em silêncio: se
 * ela deixar de fechar, a importação não fecha.
 */
export function reconciliar(apuracao: Apuracao): {
  fecha: boolean;
  totalDoExtrato: number;
  totalConsolidado: number;
  totalEmDuplicatas: number;
  totalRejeitado: number;
  totalPendente: number;
  diferenca: number;
} {
  const soma = (status: StatusDoLancamento) =>
    apuracao.lancamentos
      .filter((l) => l.status === status)
      .reduce((s, l) => s + l.valorAbsoluto, 0);

  const totalDoExtrato = apuracao.lancamentos.reduce((s, l) => s + l.valorAbsoluto, 0);
  const totalConsolidado = apuracao.consolidados.reduce((s, c) => s + c.valor, 0);
  const totalEmDuplicatas = soma("DUPLICATA_PROVAVEL");
  const totalRejeitado = soma("REJEITADO");
  const totalPendente = soma("PENDENTE_DE_CLASSIFICACAO");
  const diferenca = arredondar(
    totalDoExtrato -
      (totalConsolidado + totalEmDuplicatas + totalRejeitado + totalPendente),
  );

  return {
    /*
      A tolerância é exatamente o que o arredondamento pode acumular, e nada
      além disso.

      Os consolidados são arredondados ao centavo um a um, e o extrato tem três
      e quatro casas decimais — de modo que a soma dos arredondados difere da
      soma dos originais por, no máximo, meio centavo por grupo. Daí
      `0,005 × grupos`, mais um centavo de folga para o erro de ponto flutuante
      da própria soma.

      Era o dobro disso, e o dobro é frouxo demais para o que esta conta existe
      para pegar: num arquivo com 811 grupos, a folga de R$ 8,11 esconderia uma
      diferença real de R$ 8 — que é dinheiro sumido entre a planilha e o banco,
      e é o único defeito que esta função tem a obrigação de encontrar.
    */
    fecha:
      Math.abs(diferenca) <= 0.005 * Math.max(1, apuracao.consolidados.length) + 0.01,
    totalDoExtrato: arredondar(totalDoExtrato),
    totalConsolidado: arredondar(totalConsolidado),
    totalEmDuplicatas: arredondar(totalEmDuplicatas),
    totalRejeitado: arredondar(totalRejeitado),
    totalPendente: arredondar(totalPendente),
    diferenca,
  };
}

/*
  A regra mora em `@workspace/ingest/dinheiro`, e não aqui.

  Esta função era a regra **certa** do produto — meio centavo sobe — e a outra,
  nas rotas HTTP, era a errada. Tirá-la daqui não muda nenhum número desta
  apuração; muda o fato de existirem duas. Ver `docs/DEFINICOES-DO-CONFRONTO-DE-FINAME.md`.
*/
const arredondar = arredondarCentavos;

function medianaDe(valores: readonly number[]): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  return ordenado.length % 2 === 0
    ? (ordenado[meio - 1] + ordenado[meio]) / 2
    : ordenado[meio];
}
