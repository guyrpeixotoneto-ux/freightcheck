/**
 * A MATRIZ DO QLP — a estrutura inteira de um lado, o que se compra do outro.
 *
 * O balcão de `qlp.ts` entrega uma tabela por produto, e cada uma delas é
 * completa: preço unitário, quantidade reconhecida, despesa e a conferência da
 * fonte contra ela mesma. É a forma certa para quem chegou com uma nota de
 * uniforme na mão. Ela não é a forma para a outra pergunta, que é a mesma da
 * frota com outro sujeito: **quanto a Ambev remunera de uniforme na estrutura,
 * e em quais cargos?** Respondê-la hoje é rolar sete tabelas empilhadas e
 * comparar cargos que aparecem em ordens diferentes em cada uma.
 *
 * Este módulo vira o eixo: **linha é cargo, coluna é produto.**
 *
 * **Ele é uma função pura sobre a consulta do balcão** — recebe
 * {@link ConsultaDoQlp} e devolve a mesma informação transposta. Não toca o
 * banco, não formata, não soma nada que o balcão já não tenha somado. É o que
 * garante, sem prova nenhuma a mais, que a célula da matriz e a linha da tabela
 * do produto são o mesmo número: são literalmente o mesmo objeto.
 *
 * **A célula carrega os três papéis, e não um.** A tela escolhe qual mostrar, e
 * troca sem ida ao servidor. A alternativa — a rota devolver o papel pedido —
 * faria três consultas para responder a três perguntas sobre a mesma vigência,
 * e a terceira poderia chegar de uma importação diferente das duas primeiras.
 *
 * **A recusa própria deste eixo: preço unitário não se soma.** Somar o valor de
 * um uniforme com o de um aparelho de telefonia responde a pergunta nenhuma, e
 * um número embaixo da palavra "total" numa coluna de unitários seria lido como
 * o que a Ambev paga. Quantidade e despesa somam; unitário sai sem total
 * dizendo por quê — a mesma família de recusa que as gavetas na matriz da
 * frota.
 */

import type { ProdutoDeCompra } from "./catalogo";
import type {
  CelulaDoProduto,
  Conferencia,
  ConsultaDoQlp,
  Papel,
} from "./qlp";

/** O cruzamento de um cargo com um produto — as colunas da fonte, como vieram. */
export interface CelulaDaMatrizQlp {
  /**
   * As colunas deste produto para este cargo, na ordem dos papéis.
   *
   * Vazio quer dizer que este cargo não tem número nenhum deste produto — o que
   * é o caso comum e não é defeito: nem todo cargo tem frota leve.
   */
  celulas: CelulaDoProduto[];
  /** A conferência `despesa ≟ unitário × quantidade`, quando os três existem. */
  conferencia: Conferencia | null;
}

export interface LinhaDaMatrizQlp {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  unidadeNome: string | null;
  /** Uma por coluna de {@link MatrizDoQlp.colunas}, na mesma ordem. */
  celulas: CelulaDaMatrizQlp[];
}

/** Por que um papel de uma coluna não tem total. */
export type MotivoSemTotalQlp =
  /** Nenhum cargo tem número neste papel. */
  | "SEM_VALOR"
  /** É preço de um. Somar preços unitários de cargos diferentes não é resposta. */
  | "UNITARIO_NAO_SOMA";

export interface TotalDoPapel {
  papel: Papel;
  total: number | null;
  cargosComValor: number;
  semTotal: MotivoSemTotalQlp | null;
}

export interface ColunaDaMatrizQlp {
  produto: ProdutoDeCompra;
  /** Os papéis que **este export** entrega para o produto, na ordem de leitura. */
  papeis: Papel[];
  /** Verdadeiro quando a vigência não trouxe coluna nenhuma deste produto. */
  semColuna: boolean;
  /** Um total por papel — com a recusa escrita quando não há um. */
  totais: TotalDoPapel[];
}

export interface MatrizDoQlp {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  colunas: ColunaDaMatrizQlp[];
  linhas: LinhaDaMatrizQlp[];
  resumo: {
    cargos: number;
    unidades: number;
    /** Quantos cargos têm ao menos uma conferência que não fecha. */
    cargosComDivergencia: number;
  };
  /** Repassado do balcão: maior que zero, este quadro está incompleto. */
  registrosFaltando: number;
}

const numeroDe = (valor: CelulaDoProduto["valor"]): number | null =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : null;

/**
 * O total de um papel numa coluna.
 *
 * Duas recusas, e as duas são de conteúdo: **unitário não soma** (é preço de
 * um, e a soma de preços de coisas diferentes não responde a pergunta nenhuma),
 * e **coluna sem valor não vira zero** — a mesma regra que atravessa o produto
 * inteiro desde o catálogo.
 */
function totalizarPapel(
  papel: Papel,
  celulas: CelulaDaMatrizQlp[],
): TotalDoPapel {
  const valores = celulas
    .map((c) => numeroDe(c.celulas.find((x) => x.papel === papel)?.valor ?? null))
    .filter((v): v is number => v !== null);

  if (papel === "UNITARIO") {
    return {
      papel,
      total: null,
      cargosComValor: valores.length,
      semTotal: "UNITARIO_NAO_SOMA",
    };
  }
  if (valores.length === 0) {
    return { papel, total: null, cargosComValor: 0, semTotal: "SEM_VALOR" };
  }
  return {
    papel,
    total: Number(valores.reduce((s, v) => s + v, 0).toFixed(2)),
    cargosComValor: valores.length,
    semTotal: null,
  };
}

/**
 * A consulta do balcão, transposta.
 *
 * A lista de cargos é a **união** dos que aparecem em algum produto, e não a de
 * um produto escolhido como referência: um cargo que só tem vale-transporte
 * existe na estrutura, e sumiria da matriz se a lista saísse do produto ao
 * lado. A ordem é a da unidade e depois a do cargo, que é como o quadro se lê.
 */
export function matrizDoQlp(consulta: ConsultaDoQlp): MatrizDoQlp {
  /* Cabeçalho do cargo, achado uma vez e reusado — a identidade não muda entre produtos. */
  const cabecalhos = new Map<string, Omit<LinhaDaMatrizQlp, "celulas">>();
  for (const produto of consulta.produtos) {
    for (const linha of produto.linhas) {
      if (cabecalhos.has(linha.entityId)) continue;
      cabecalhos.set(linha.entityId, {
        entityId: linha.entityId,
        cargo: linha.cargo,
        unidadeCnpj: linha.unidadeCnpj,
        unidadeCnpjLegivel: linha.unidadeCnpjLegivel,
        unidadeNome: linha.unidadeNome,
      });
    }
  }

  const porProdutoECargo = consulta.produtos.map(
    (produto) => new Map(produto.linhas.map((l) => [l.entityId, l])),
  );

  const linhas: LinhaDaMatrizQlp[] = [...cabecalhos.values()]
    .sort(
      (a, b) =>
        (a.unidadeNome ?? a.unidadeCnpjLegivel).localeCompare(
          b.unidadeNome ?? b.unidadeCnpjLegivel,
          "pt-BR",
        ) || a.cargo.localeCompare(b.cargo, "pt-BR"),
    )
    .map((cabecalho) => ({
      ...cabecalho,
      celulas: consulta.produtos.map((_produto, i) => {
        const linha = porProdutoECargo[i]!.get(cabecalho.entityId);
        return {
          celulas: linha?.celulas ?? [],
          conferencia: linha?.conferencia ?? null,
        };
      }),
    }));

  const colunas: ColunaDaMatrizQlp[] = consulta.produtos.map((produto, i) => {
    const celulas = linhas.map((l) => l.celulas[i]!);
    /*
      Os papéis saem das colunas que **este export** trouxe, e não do catálogo:
      é a mesma decisão do balcão, e a diferença aparece na vigência em que a
      Ambev para de mandar a quantidade de um produto — a coluna continua na
      tela sem inventar um papel que ninguém entregou.
    */
    const papeis = produto.colunas.map((c) => c.papel);
    return {
      produto: produto.produto,
      papeis,
      semColuna: produto.semColuna,
      totais: papeis.map((papel) => totalizarPapel(papel, celulas)),
    };
  });

  return {
    effectiveDate: consulta.effectiveDate,
    periodLabel: consulta.periodLabel,
    contextLabel: consulta.contextLabel,
    colunas,
    linhas,
    resumo: {
      cargos: linhas.length,
      unidades: new Set(linhas.map((l) => l.unidadeCnpj)).size,
      cargosComDivergencia: linhas.filter((l) =>
        l.celulas.some((c) => c.conferencia !== null && !c.conferencia.fecha),
      ).length,
    },
    registrosFaltando: consulta.registrosFaltando,
  };
}
