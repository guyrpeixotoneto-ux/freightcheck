/**
 * A remuneração que sustenta cada preço-alvo — lida do acervo, nunca inventada.
 *
 * O motor econômico (`motor.ts`) é puro: ele recebe uma {@link BaseRemunerada}
 * e devolve os números. Este arquivo é quem vai buscá-la, e ele **não tem
 * caminho próprio até o valor**: chama `remuneradoDaPlaca`, `matrizDaFrota` e
 * `remuneradoDoQlp` — as mesmas três leituras que a tela Remunerado usa. É a
 * regra que `frota.ts` documenta e que aqui vale duplicado: existisse um
 * segundo caminho, o preço-alvo que vai à mesa de negociação se apoiaria num
 * remunerado que a auditoria não reconhece.
 *
 * **Sem placa, o que responde é a média da frota — e ela é declarada.** Um
 * pedido de pneu raramente é de um veículo: é de oitenta unidades para a frota.
 * A base, então, é `total da coluna ÷ veículos com valor`, e o escopo diz
 * exatamente isso, com a contagem. O que **não** se faz é somar a coluna inteira
 * e chamar de "o que a Ambev remunera em pneu": aquele total é da frota, e
 * dividi-lo por unidade sem dizer por quantos veículos produziria um preço-alvo
 * oitenta vezes maior que o certo.
 */

import type { Database } from "@workspace/db";
import { produtoDe, type EscopoDaConsulta } from "../catalogo";
import { remuneradoDaPlaca } from "../frota";
import { matrizDaFrota } from "../matriz";
import { remuneradoDoQlp } from "../qlp";
import { ROTULO_SEM_ALVO, type BaseRemunerada } from "../motor";

export interface PedidoDeBase {
  /** A chave do produto no catálogo. */
  chave: string;
  /** Quando informada, a base é a daquele veículo, e não a média da frota. */
  placa?: string | null;
  period?: string | undefined;
  context?: EscopoDaConsulta | undefined;
}

/** A base, mais o que a leitura encontrou de contexto para a resposta citar. */
export interface BaseDoItem {
  base: BaseRemunerada;
  /** A vigência lida, para a navegação contextual apontar para ela. */
  effectiveDate: string | null;
  /** Quantos veículos entraram na média, quando a base é a da frota. */
  veiculos: number | null;
  /** A placa, quando a base é de um veículo. */
  placa: string | null;
  /**
   * A unidade do recorte — e ela é um **lugar**, não uma operação.
   *
   * É o que a pesquisa de mercado usa como região de entrega, e a distinção
   * custou uma busca inteira: passando a operação, a consulta saía com
   * "entrega em EMPURRADA", que não é um endereço e não seleciona fornecedor
   * nenhum. "Camaçari/BA" seleciona.
   */
  unidade: string | null;
}

/** A base vazia que se devolve quando o acervo não tem o que responder. */
function semBase(chave: string, porque: string, vigencia = "—"): BaseDoItem {
  return {
    base: {
      valor: null,
      gaveta: null,
      escopo: "—",
      fonte: porque,
      vigencia,
      ressalva: null,
    },
    effectiveDate: null,
    veiculos: null,
    placa: null,
    unidade: null,
  };
}

/**
 * De um produto do catálogo para o que a Ambev remunera nele.
 *
 * Três caminhos, escolhidos pelo balcão do produto — e não por quem pergunta:
 * pneu não tem cargo e uniforme não tem placa. O produto do balcão operacional
 * sai sem base, dizendo o que falta, porque aquele balcão ainda não abriu.
 */
export async function baseDoItem(
  db: Database,
  pedido: PedidoDeBase,
): Promise<BaseDoItem> {
  const produto = produtoDe(pedido.chave);
  if (!produto)
    return semBase(
      pedido.chave,
      `"${pedido.chave}" não está no catálogo de compras.`,
    );

  if (produto.balcao === "QLP_OPERACIONAL") {
    return semBase(
      pedido.chave,
      "O balcão do QLP operacional ainda não abriu: o export não traz quantidade nem valor por faixa.",
    );
  }

  if (produto.balcao === "QLP_ADMINISTRATIVO")
    return baseDoQlp(db, pedido, produto.ressalva?.texto ?? null);
  return baseDaFrota(db, pedido, produto.ressalva?.texto ?? null);
}

async function baseDaFrota(
  db: Database,
  pedido: PedidoDeBase,
  ressalva: string | null,
): Promise<BaseDoItem> {
  const opcoes = {
    ...(pedido.period !== undefined ? { period: pedido.period } : {}),
    ...(pedido.context !== undefined ? { context: pedido.context } : {}),
  };

  // ---- um veículo ---------------------------------------------------------
  if (pedido.placa) {
    const consulta = await remuneradoDaPlaca(db, pedido.placa, opcoes);
    if (!consulta) {
      return semBase(
        pedido.chave,
        `Nenhum veículo com a placa ${pedido.placa} neste acervo — ou nenhuma vigência importada.`,
      );
    }
    const produto = consulta.produtos.find(
      (p) => p.produto.chave === pedido.chave,
    );
    const destaque = produto?.destaque ?? null;
    return {
      base: {
        valor: destaque?.valor ?? null,
        gaveta: destaque?.gaveta ?? null,
        escopo: `por veículo (${consulta.placa.placaLegivel})`,
        fonte:
          destaque !== null
            ? `Coluna "${destaque.sourceName}" do export, na ficha da placa ${consulta.placa.placaLegivel}`
            : `A vigência não traz coluna com número para este item na placa ${consulta.placa.placaLegivel}`,
        vigencia: consulta.periodLabel,
        ressalva,
      },
      effectiveDate: consulta.effectiveDate,
      veiculos: 1,
      placa: consulta.placa.placaLegivel,
      unidade: consulta.unidade,
    };
  }

  // ---- a frota ------------------------------------------------------------
  const matriz = await matrizDaFrota(db, opcoes);
  if (!matriz)
    return semBase(pedido.chave, "Nenhuma vigência importada ainda.");

  const coluna = matriz.colunas.find((c) => c.produto.chave === pedido.chave);
  if (!coluna) {
    return semBase(
      pedido.chave,
      "Este item não é um produto da frota.",
      matriz.periodLabel,
    );
  }

  /*
    Sem total não há média, e o motivo importa: SEM_VALOR quer dizer que nenhum
    veículo tem número neste item — e GAVETAS_DIFERENTES quer dizer que há
    números e eles medem coisas diferentes. A segunda é a mais perigosa das
    duas, porque uma média ali pareceria uma resposta.
  */
  if (coluna.total === null || coluna.veiculosComValor === 0) {
    return {
      base: {
        valor: null,
        gaveta: coluna.gaveta,
        escopo: "média por veículo na frota",
        fonte:
          coluna.semTotal === "GAVETAS_DIFERENTES"
            ? "A frota traz este item em periodicidades diferentes; somá-las misturaria mensal e anual."
            : "Nenhum veículo da vigência traz número para este item.",
        vigencia: matriz.periodLabel,
        ressalva,
      },
      effectiveDate: matriz.effectiveDate,
      veiculos: coluna.veiculosComValor,
      placa: null,
      unidade: matriz.unidade,
    };
  }

  return {
    base: {
      valor: coluna.total / coluna.veiculosComValor,
      gaveta: coluna.gaveta,
      escopo: `média por veículo (${coluna.veiculosComValor} de ${matriz.resumo.veiculos} na frota)`,
      fonte:
        `Matriz da frota: total de ${coluna.produto.rotulo} na vigência dividido pelos ` +
        `${coluna.veiculosComValor} veículos que trazem número`,
      vigencia: matriz.periodLabel,
      ressalva,
    },
    effectiveDate: matriz.effectiveDate,
    veiculos: coluna.veiculosComValor,
    placa: null,
    unidade: matriz.unidade,
  };
}

/**
 * A base do QLP administrativo — e por que ela é `porUnidade`.
 *
 * O export do quadro declara o **valor unitário** do uniforme, do aparelho, do
 * carro de apoio: não um fluxo mensal por cargo, mas quanto a Ambev reconhece
 * por peça. Esse número já é o valor econômico da unidade, e por isso a base sai
 * com `porUnidade: true` — não há vida útil a estimar nem unidades por ativo a
 * chutar, e a avaliação nasce com confiabilidade alta. É a diferença estrutural
 * entre este balcão e o da frota, e é o motivo de os dois não compartilharem a
 * mesma função.
 *
 * A média entre cargos é declarada como média, como na frota: um uniforme de
 * motorista e um de conferente têm valores diferentes, e o número que sai daqui
 * é o do conjunto.
 */
async function baseDoQlp(
  db: Database,
  pedido: PedidoDeBase,
  ressalva: string | null,
): Promise<BaseDoItem> {
  const consulta = await remuneradoDoQlp(db, {
    ...(pedido.period !== undefined ? { period: pedido.period } : {}),
    ...(pedido.context !== undefined ? { context: pedido.context } : {}),
  });
  if (!consulta) {
    return semBase(
      pedido.chave,
      "Nenhuma vigência de QLP Administrativo importada ainda.",
    );
  }

  const produto = consulta.produtos.find(
    (p) => p.produto.chave === pedido.chave,
  );
  if (!produto || produto.semColuna) {
    return semBase(
      pedido.chave,
      "O export desta vigência não traz coluna para este item no quadro administrativo.",
      consulta.periodLabel,
    );
  }

  const unitarias = produto.colunas
    .filter((c) => c.papel === "UNITARIO")
    .map((c) => c.code);
  const valores: number[] = [];
  for (const linha of produto.linhas) {
    for (const celula of linha.celulas) {
      if (!unitarias.includes(celula.code)) continue;
      if (typeof celula.valor === "number" && celula.valor > 0)
        valores.push(celula.valor);
    }
  }

  if (valores.length === 0) {
    return {
      base: {
        valor: null,
        gaveta: null,
        escopo: "valor unitário por cargo",
        fonte:
          "As colunas de valor unitário existem e nenhuma trouxe número nesta vigência.",
        vigencia: consulta.periodLabel,
        ressalva,
      },
      effectiveDate: consulta.effectiveDate,
      veiculos: null,
      placa: null,
      unidade: null,
    };
  }

  const soma = valores.reduce((a, b) => a + b, 0);
  return {
    base: {
      valor: soma / valores.length,
      gaveta: "AQUISICAO",
      porUnidade: true,
      escopo:
        valores.length === 1
          ? "valor unitário declarado pela fonte"
          : `média do valor unitário em ${valores.length} cargos`,
      fonte: "Colunas de valor unitário do quadro administrativo",
      vigencia: consulta.periodLabel,
      ressalva,
    },
    effectiveDate: consulta.effectiveDate,
    veiculos: null,
    placa: null,
    unidade: null,
  };
}

/** O motivo escrito, para a resposta citar sem reinventar a frase. */
export { ROTULO_SEM_ALVO };
