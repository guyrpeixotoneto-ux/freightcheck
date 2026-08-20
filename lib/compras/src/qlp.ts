/**
 * O BALCÃO DO QLP — o que a Ambev remunera na estrutura, rubrica a rubrica.
 *
 * Este é o balcão que um pedido de compra visita mais, e o único lugar do
 * modelo em que a fonte entrega **o preço unitário do que se compra**. Uniforme,
 * telefonia, frota leve e benefício chegam em três colunas cada um — valor
 * unitário, quantidade remunerada e a despesa que as duas produzem —, que é
 * exatamente a forma de que precisa quem está com uma nota na mão: "a Ambev
 * remunera R$ X por uniforme, reconhece Y uniformes, e paga R$ Z no total".
 *
 * **Os papéis são declarados, nunca deduzidos do nome da coluna.** É a lição
 * mais cara deste repositório — `ipvaLicenciamento` e `ipvaLicenciamentoMensal`
 * contradizem os próprios nomes, e a arquitetura registra o caso por extenso.
 * Aqui a folga não existe porque o dicionário do export nomeia cada coluna pelo
 * que ela calcula, e {@link PAPEL_DA_COLUNA} cita a frase dele em cada entrada.
 * Uma coluna nova cai fora do mapa e aparece sem papel, que é o comportamento
 * certo: sem papel declarado ela não entra na conferência, e ninguém a lê como
 * preço unitário por ela começar com "Valor".
 *
 * **A conferência que este balcão faz, e a que ele recusa.** Ele confere a
 * fonte contra ela mesma — `despesa ≟ unitário × quantidade` — e diz quando não
 * fecha. Ele **não** compara com o preço do pedido: o pedido não está no banco,
 * e um "cobre / não cobre" calculado sobre um preço que o produto não conhece
 * seria um veredito com cara de conta.
 */

import type { Database } from "@workspace/db";
import {
  getQuadroAdministrativo,
  type AtributoDoQuadro,
  type CargoDoQuadro,
  type ValorDeFato,
} from "@workspace/qlp";
import { placementOf } from "@workspace/comparison";
import {
  BALCAO_SEM_DADO,
  produtosDoBalcao,
  type EscopoDaConsulta,
  type ProdutoDeCompra,
} from "./catalogo";

// ---------------------------------------------------------------------------
// Os papéis
// ---------------------------------------------------------------------------

/**
 * O que uma coluna do QLP é dentro do seu produto.
 *
 * `UNITARIO` é o preço de um — o número que responde "quanto vale um uniforme".
 * `QUANTIDADE` é quantos o modelo reconhece. `DESPESA` é o produto dos dois,
 * como a própria fonte o calcula.
 */
export type Papel = "UNITARIO" | "QUANTIDADE" | "DESPESA";

export const ROTULO_DO_PAPEL: Record<Papel, string> = {
  UNITARIO: "Valor unitário",
  QUANTIDADE: "Quantidade remunerada",
  DESPESA: "Despesa",
};

/**
 * `attribute.code → papel`, com a frase do dicionário que sustenta cada linha.
 *
 * A fonte é `docs/tabela-de-qlp-adm-dicionario.csv`, coluna "Nome Gerencial".
 * Duas entradas merecem leitura porque dizem a aritmética por extenso, e são
 * elas que autorizam a conferência de {@link Conferencia}:
 *
 * - *Despesa Benefício* — "CALCULO DO BENEFICIO REMUNERADO MULTIPLICADO PELA
 *   QUANTIDADE DE BENEFICIOS REMUNERADOS".
 * - *Despesa Ordenados* — "CALCULO DE SALARIO ORDENADO POR QUANTIDADES
 *   ORDENADAS DO QLP".
 *
 * As duas descrevem `unitário × quantidade`, e a planilha sintética de
 * `@workspace/ingest/testing/planilha` reproduz a identidade nos três cargos
 * que usa (1×9800=9800, 3×4600=13800, 4×2400=9600).
 */
const PAPEL_DA_COLUNA: Record<string, Papel> = {
  // Uniformes — "VALOR DO UNIFORME REMUNERADO" / "QUANTIDADE DE UNIFORMES
  // REMUNERADOS" / "CALCULO DO UNIFORMES REMUNERADA".
  "qlp_administrativo.valor_uniformes": "UNITARIO",
  "qlp_administrativo.quantidade_uniformes": "QUANTIDADE",
  "qlp_administrativo.despesa_uniformes": "DESPESA",

  // Telefonia — "VALOR DE TELEFONIA REMUNERADA" / "QUANTIDADE DE TELEFONIA
  // REMUNERADO" / "CALCULO DE TELEFONIA REMUNERADA".
  "qlp_administrativo.valor_telefonia": "UNITARIO",
  "qlp_administrativo.quantidade_telefonia": "QUANTIDADE",
  "qlp_administrativo.despesa_telefonia": "DESPESA",

  // Frota leve — "VALOR DE FROTA LEVE REMUNERADO" / "QUANTIDADE DE FROTA LEVE
  // REMUNERADO" / "CALCULO DE FROTA LEVE REMUNERADO".
  "qlp_administrativo.valor_frota_leve": "UNITARIO",
  "qlp_administrativo.quantidade_frota_leve": "QUANTIDADE",
  "qlp_administrativo.despesa_frota_leve": "DESPESA",

  // Benefícios — ver a nota acima: a despesa é declarada como o produto.
  "qlp_administrativo.valor_beneficio": "UNITARIO",
  "qlp_administrativo.quantidade_beneficio": "QUANTIDADE",
  "qlp_administrativo.despesa_beneficio": "DESPESA",

  /*
    Vale-transporte tem uma coluna só — "CALCULO DO VALE TRANSPORTE ORDENADO".
    É despesa, e não preço unitário: não há quantidade ao lado dela, e por isso
    a conferência a deixa de fora em vez de comparar contra um fator ausente.
  */
  "qlp_administrativo.vale_transporte": "DESPESA",

  // Ordenados — "QUANTIDADE DE QLP REMUNERADO" é o efetivo reconhecido.
  "qlp_administrativo.quantidade_ordenados": "QUANTIDADE",
  "qlp_administrativo.salario_ordenados": "UNITARIO",
  "qlp_administrativo.despesa_ordenados": "DESPESA",

  // Encargos — "QUANTIDADE DE BENEFICIO ENCARGO REMUNERADO" / "CALCULO DE
  // SALARIOS MAIS ENCARGOS" / "CALCULO DO ENCARGO REMUNERADO".
  "qlp_administrativo.quantidade_encargos": "QUANTIDADE",
  "qlp_administrativo.salario_encargos": "UNITARIO",
  "qlp_administrativo.despesa_encargos": "DESPESA",

  // Benchmark — a régua da auditoria, não um gasto.
  "qlp_administrativo.qlp_benchmark_quantidade": "QUANTIDADE",
  "qlp_administrativo.qlp_benchmark_salario": "UNITARIO",
};

/** O papel declarado de uma coluna, ou `null` quando não há um. */
export function papelDaColuna(code: string): Papel | null {
  return PAPEL_DA_COLUNA[code] ?? null;
}

// ---------------------------------------------------------------------------
// O que sai na tela
// ---------------------------------------------------------------------------

/** Uma coluna do produto, para um cargo de uma unidade. */
export interface CelulaDoProduto {
  code: string;
  titulo: string;
  papel: Papel;
  valor: ValorDeFato;
  /**
   * A semântica curada da coluna, como o quadro a entrega.
   *
   * Viaja junto porque é ela que decide se o número pode ser escrito com cifrão:
   * chamar de dinheiro o que ninguém confirmou é interpretação, e a formatação
   * da tela usa exatamente esta informação — ver `formatarValor` em
   * `components/qlp/apresentacao.ts`, que este balcão reaproveita em vez de
   * abrir uma segunda régua.
   */
  semantica: AtributoDoQuadro["semantica"];
}

/**
 * A conferência da fonte contra ela mesma: `despesa ≟ unitário × quantidade`.
 *
 * Só existe quando os três números existem. `fecha` é falso quando a diferença
 * passa de um centavo — e, quando é falso, **o número exibido continua sendo o
 * da fonte**, porque é ele que a Ambev paga. A conferência informa; ela não
 * corrige.
 */
export interface Conferencia {
  esperado: number;
  declarado: number;
  diferenca: number;
  fecha: boolean;
}

/** Um cargo de uma unidade, dentro de um produto. */
export interface LinhaDoQuadro {
  entityId: string;
  cargo: string;
  unidadeCnpj: string;
  unidadeCnpjLegivel: string;
  unidadeNome: string | null;
  celulas: CelulaDoProduto[];
  conferencia: Conferencia | null;
}

export interface ProdutoDoQlp {
  produto: ProdutoDeCompra;
  /** As colunas que este export entrega para o produto, na ordem dos papéis. */
  colunas: { code: string; titulo: string; papel: Papel }[];
  linhas: LinhaDoQuadro[];
  /** Verdadeiro quando o export desta vigência não traz coluna nenhuma do produto. */
  semColuna: boolean;
}

export interface ConsultaDoQlp {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  produtos: ProdutoDoQlp[];
  /** O balcão que ainda não abriu, e o que falta para abrir. */
  operacional: typeof BALCAO_SEM_DADO;
  /**
   * Quantos registros a importação deixou de fora desta vigência.
   *
   * Repassado do quadro, e não recalculado. Maior que zero, **este balcão está
   * incompleto**: um cargo em quarentena não aparece aqui e não é distinguível,
   * no desenho, de um cargo que a unidade não tem.
   */
  registrosFaltando: number;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

/** A ordem em que as colunas de um produto se leem. */
const ORDEM_DO_PAPEL: Record<Papel, number> = {
  UNITARIO: 0,
  QUANTIDADE: 1,
  DESPESA: 2,
};

const numeroDe = (valor: ValorDeFato): number | null =>
  typeof valor === "number" && Number.isFinite(valor) ? valor : null;

/**
 * A conferência de um cargo, quando os três números existem.
 *
 * `null` em três situações que são a mesma: falta o unitário, falta a
 * quantidade, ou falta a despesa. Nenhuma delas é defeito — vale-transporte não
 * tem quantidade por desenho da fonte —, e por isso nenhuma vira alerta.
 */
function conferir(celulas: CelulaDoProduto[]): Conferencia | null {
  const unitario = numeroDe(celulas.find((c) => c.papel === "UNITARIO")?.valor ?? null);
  const quantidade = numeroDe(celulas.find((c) => c.papel === "QUANTIDADE")?.valor ?? null);
  const despesa = numeroDe(celulas.find((c) => c.papel === "DESPESA")?.valor ?? null);
  if (unitario === null || quantidade === null || despesa === null) return null;

  const esperado = Number((unitario * quantidade).toFixed(2));
  const diferenca = Number((despesa - esperado).toFixed(2));
  return { esperado, declarado: despesa, diferenca, fecha: Math.abs(diferenca) <= 0.01 };
}

/**
 * O remunerado da estrutura, produto a produto.
 *
 * Devolve `null` quando o contexto não tem vigência de QLP nenhuma — a rota
 * traduz em 404 e a tela convida a importar, que é a mesma decisão de
 * `/qlp/administrativo`.
 */
export async function remuneradoDoQlp(
  db: Database,
  opcoes: { period?: string; context?: EscopoDaConsulta } = {},
): Promise<ConsultaDoQlp | null> {
  const quadro = await getQuadroAdministrativo(db, {
    ...(opcoes.period !== undefined ? { period: opcoes.period } : {}),
    ...(opcoes.context !== undefined ? { context: opcoes.context } : {}),
  });
  if (!quadro) return null;

  /*
    Um índice das colunas por produto, montado sobre os atributos que **este
    export** trouxe — e não sobre o catálogo. A diferença aparece na vigência em
    que a Ambev para de mandar uma coluna: o produto continua na tela, e a
    ausência fica dita em `semColuna` em vez de a linha sumir sem explicação.

    A rubrica sai de `placementOf`, como no balcão da frota, para que os dois
    balcões classifiquem pelo mesmo mapa. O papel sai do mapa declarado acima:
    uma coluna reconhecida pela rubrica mas sem papel não entra, porque sem papel
    não há como dizer se ela é preço, contagem ou total.
  */
  const atributoPorCodigo = new Map(quadro.atributos.map((a) => [a.code, a]));
  const colunasPorProduto = new Map<string, { code: string; titulo: string; papel: Papel }[]>();

  for (const produto of produtosDoBalcao("QLP_ADMINISTRATIVO")) {
    const rubricas = new Set(produto.parametros);
    const colunas = quadro.atributos
      .filter((a) => rubricas.has(placementOf(a.code).parameter))
      .flatMap((a) => {
        const papel = papelDaColuna(a.code);
        return papel === null
          ? []
          : [{ code: a.code, titulo: a.displayName ?? a.sourceName, papel }];
      })
      .sort((a, b) => ORDEM_DO_PAPEL[a.papel] - ORDEM_DO_PAPEL[b.papel]);
    colunasPorProduto.set(produto.chave, colunas);
  }

  const cargos: { cargo: CargoDoQuadro; unidadeNome: string | null }[] = quadro.unidades.flatMap(
    (unidade) => unidade.cargos.map((cargo) => ({ cargo, unidadeNome: unidade.nome })),
  );

  const produtos: ProdutoDoQlp[] = produtosDoBalcao("QLP_ADMINISTRATIVO").map((produto) => {
    const colunas = colunasPorProduto.get(produto.chave) ?? [];
    if (colunas.length === 0) {
      return { produto, colunas, linhas: [], semColuna: true };
    }

    const linhas = cargos.flatMap(({ cargo, unidadeNome }) => {
      const celulas: CelulaDoProduto[] = colunas.map((coluna) => ({
        code: coluna.code,
        titulo: coluna.titulo,
        papel: coluna.papel,
        /*
          Ausente do mapa de valores é célula vazia, e `null` é como esta
          leitura a escreve. Não é zero: zero é um número que a fonte declarou,
          e a diferença entre os dois é a que decide se alguém compra achando
          que não recebe nada.
        */
        valor: cargo.valores[coluna.code] ?? null,
        semantica: atributoPorCodigo.get(coluna.code)!.semantica,
      }));

      /*
        Um cargo sem nenhum valor deste produto não vira linha. É o caso comum
        no export real — nem todo cargo tem frota leve —, e uma tabela com
        dezenas de linhas de travessão esconderia as que têm número.
      */
      if (celulas.every((c) => c.valor === null)) return [];

      return [
        {
          entityId: cargo.entityId,
          cargo: cargo.cargo,
          unidadeCnpj: cargo.unidadeCnpj,
          unidadeCnpjLegivel: cargo.unidadeCnpjLegivel,
          unidadeNome,
          celulas,
          conferencia: conferir(celulas),
        },
      ];
    });

    return { produto, colunas, linhas, semColuna: false };
  });

  return {
    effectiveDate: quadro.effectiveDate,
    periodLabel: quadro.periodLabel,
    contextLabel: quadro.context.label,
    produtos,
    operacional: BALCAO_SEM_DADO,
    registrosFaltando: quadro.registrosFaltando,
  };
}
