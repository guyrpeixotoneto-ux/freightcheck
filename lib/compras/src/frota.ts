/**
 * O BALCÃO DA FROTA — digite a placa, veja o que a Ambev remunera nela.
 *
 * **Esta leitura não calcula remuneração.** Ela chama `montarComposicao` de
 * `@workspace/composition` e reagrupa o que veio. A escolha é deliberada e é a
 * regra mais importante deste arquivo: existisse aqui um segundo caminho até o
 * número, a tela de compra e a ficha do equipamento poderiam divergir, e a
 * pessoa que confere um pedido veria um valor que a auditoria não reconhece.
 * Quem decide o que entra em total continua sendo o portão de semântica; o que
 * este módulo acrescenta é o **eixo do comprador**: da rubrica do modelo para o
 * produto que se compra.
 *
 * O reagrupamento é de graça em consulta ao banco — é o mesmo `SELECT` — e
 * caro em outra moeda, que vale a pena nomear: um atributo pode não pertencer a
 * produto nenhum, e a maior parte não pertence. Região de operação, ciclo do
 * ativo e dimensões do implemento descrevem o veículo e não correspondem a nada
 * que passe por um pedido de compra. Eles não são perdidos nem escondidos —
 * saem em {@link ConsultaDaPlaca.foraDoCatalogo}, contados, para que a tela
 * possa dizer quantos ficaram de fora em vez de deixar a soma parecer o todo.
 */

import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { normalizeIdentifier } from "@workspace/ingest";
import {
  getVinculoDoCavalo,
  montarComposicao,
  type ComponenteNaoApurado,
  type Gaveta,
  type LinhaCalculavel,
  type Origem,
} from "@workspace/composition";
import {
  produtoDaRubrica,
  produtosDoBalcao,
  type EscopoDaConsulta,
  type ProdutoDeCompra,
} from "./catalogo";

// ---------------------------------------------------------------------------
// Encontrar a placa
// ---------------------------------------------------------------------------

/** Um ativo que a busca por placa encontrou. */
export interface PlacaEncontrada {
  entityId: string;
  entityType: string;
  /** A placa normalizada — sem pontuação, em caixa alta. É o que identifica. */
  placa: string;
  /** A placa como o arquivo a escreveu. Evidência, não identidade. */
  placaLegivel: string;
  /**
   * Se este é o identificador **corrente** do ativo.
   *
   * Falso quando a placa foi encerrada — o caso do reemplacamento Mercosul, em
   * que a linha antiga fecha e uma nova abre sobre o mesmo `entity.id`. Quem
   * digita a placa velha tem de chegar ao veículo certo; o que não pode é
   * chegar sem saber que digitou a velha.
   */
  corrente: boolean;
}

/**
 * As placas que casam com o que foi digitado, para o campo de busca.
 *
 * Prefixo, e não substring: quem digita placa digita do começo, e um `LIKE
 * '%...%'` sobre a frota inteira devolveria, para três letras, uma lista que
 * não ajuda a escolher. O limite existe pela mesma razão — a tela oferece
 * escolhas, não um relatório.
 *
 * Ordena as correntes antes das encerradas porque é o que quem digita espera:
 * a placa que está no pátio hoje vem primeiro.
 */
export async function buscarPlacas(
  db: Database,
  termo: string,
  limite = 12,
  /**
   * A operação de quem procura — o recorte das quatro auditorias.
   *
   * A busca é por identificador, e o identificador é do **ativo**, que não tem
   * operação: a mesma placa pode ser remunerada em duas. O que tem operação é o
   * fato — e é por ele que o recorte entra. Sem isto, digitar três letras no
   * balcão de compras da Auditoria Rota sugeria placas que só existem na
   * empurrada, e o comprador abriria uma ficha vazia sem entender por quê.
   */
  operacao?: string | null,
): Promise<PlacaEncontrada[]> {
  const alvo = normalizeIdentifier(termo);
  if (alvo.length < 2) return [];

  const { rows } = await db.execute<{
    entity_id: string;
    entity_type: string;
    identifier_value: string;
    identifier_value_raw: string | null;
    is_current: boolean;
  }>(sql`
    SELECT DISTINCT ON (i.identifier_value)
           i.entity_id::text AS entity_id,
           e.entity_type,
           i.identifier_value,
           i.identifier_value_raw,
           i.is_current
      FROM entity_identifier i
      JOIN entity e ON e.id = i.entity_id
     WHERE i.identifier_type = 'PLACA'
       AND i.identifier_value LIKE ${`${alvo}%`}
       AND (${operacao ?? null}::text IS NULL OR EXISTS (
             SELECT 1 FROM fact f
               JOIN snapshot s ON s.id = f.snapshot_id
              WHERE f.entity_id = i.entity_id AND s.canal = ${operacao ?? null}
           ))
     ORDER BY i.identifier_value, i.is_current DESC, i.effective_from DESC
     LIMIT ${limite}
  `);

  return rows.map((r) => ({
    entityId: r.entity_id,
    entityType: r.entity_type,
    placa: r.identifier_value,
    placaLegivel: r.identifier_value_raw ?? r.identifier_value,
    corrente: r.is_current,
  }));
}

/**
 * O ativo de uma placa exata, ou `null` quando nenhuma casa.
 *
 * A corrente ganha da encerrada quando as duas existem — `entity_identifier_current_uq`
 * garante que no máximo uma esteja aberta por placa, então "as duas existem"
 * quer dizer uma aberta e uma ou mais fechadas, e a aberta é a resposta.
 */
export async function acharPlaca(
  db: Database,
  placa: string,
): Promise<PlacaEncontrada | null> {
  const alvo = normalizeIdentifier(placa);
  if (alvo === "") return null;

  const { rows } = await db.execute<{
    entity_id: string;
    entity_type: string;
    identifier_value: string;
    identifier_value_raw: string | null;
    is_current: boolean;
  }>(sql`
    SELECT i.entity_id::text AS entity_id,
           e.entity_type,
           i.identifier_value,
           i.identifier_value_raw,
           i.is_current
      FROM entity_identifier i
      JOIN entity e ON e.id = i.entity_id
     WHERE i.identifier_type = 'PLACA'
       AND i.identifier_value = ${alvo}
     ORDER BY i.is_current DESC, i.effective_from DESC
     LIMIT 1
  `);

  const linha = rows[0];
  if (!linha) return null;
  return {
    entityId: linha.entity_id,
    entityType: linha.entity_type,
    placa: linha.identifier_value,
    placaLegivel: linha.identifier_value_raw ?? linha.identifier_value,
    corrente: linha.is_current,
  };
}

// ---------------------------------------------------------------------------
// O que sai na tela
// ---------------------------------------------------------------------------

/** Uma coluna da fonte, dentro do produto a que ela pertence. */
export interface LinhaDoProduto {
  code: string;
  titulo: string;
  /** O nome da coluna como o export a escreve. É por ele que se confere. */
  sourceName: string;
  /** O valor já escrito para leitura — com unidade quando a curadoria a confirmou. */
  exibicao: string | null;
  valor: number | null;
  unit: string | null;
  periodicity: string | null;
  /**
   * Em que gaveta o valor cai — mensal, anual ou de aquisição.
   *
   * Sai como o enum, e não como frase pronta, para que a tela escolha o
   * registro sem que este módulo invente um segundo vocabulário para a mesma
   * ideia. `ROTULO_DA_GAVETA` de `@workspace/composition` continua sendo o
   * único lugar onde essas três gavetas têm nome. Nulo quando a linha não foi
   * apurada: sem periodicidade confirmada não há gaveta.
   */
  gaveta: Gaveta | null;
  /**
   * Se esta linha entra no que o ativo recebe nesta vigência.
   *
   * Falso não quer dizer errado nem irrelevante: quer dizer que o número existe
   * e não é somável ao mensal do ativo — por ser razão, por ser parcela de um
   * total que já está na lista, ou por remunerar o conjunto. O motivo vem em
   * `motivo`, e a tela mostra os dois juntos.
   */
  apurado: boolean;
  /** Por que não entra, quando não entra. Nulo quando entra. */
  motivo: string | null;
  origem: Origem | null;
}

/** Um produto do catálogo, respondido para esta placa e esta vigência. */
export interface ProdutoConsultado {
  produto: ProdutoDeCompra;
  linhas: LinhaDoProduto[];
  /**
   * A linha que responde a pergunta, quando exatamente uma responde.
   *
   * **Por que não uma soma.** Duas colunas de um mesmo produto quase nunca são
   * parcelas de um mesmo número, e elas deixam de sê-lo por dois motivos
   * diferentes, os dois medidos no export real:
   *
   * - **São alternativas.** A manutenção tem a taxa do contrato *ou* a da
   *   matriz do BID, conforme o veículo tenha contrato ou compra autorizada
   *   fora dele. Somá-las daria um número que a Ambev não paga em hipótese
   *   nenhuma.
   * - **São fatos distintos.** Na aquisição convivem `valorNfCompra` e
   *   `valorPisCofins` — o valor da nota e o tributo sobre ela. Somá-los
   *   responde a uma pergunta que ninguém fez.
   *
   * Nos dois casos a resposta verdadeira são as linhas, e é o que a tela
   * mostra quando não há destaque.
   */
  destaque: LinhaDoProduto | null;
  /** Verdadeiro quando nenhuma linha do produto tem número nesta vigência. */
  semNumero: boolean;
}

/** Uma rubrica que apareceu na placa e não pertence a produto nenhum. */
export interface ForaDoCatalogo {
  rubrica: string;
  familia: string;
  colunas: number;
}

export interface ConsultaDaPlaca {
  placa: PlacaEncontrada;
  entityType: string;
  rotuloDoTipo: string;
  chassi: string | null;
  unidade: string | null;
  operacao: string | null;
  contextLabel: string;
  effectiveDate: string;
  periodLabel: string;
  /** Falso quando o ativo não tem fato nenhum nesta vigência. É resposta, não erro. */
  presente: boolean;
  produtos: ProdutoConsultado[];
  foraDoCatalogo: ForaDoCatalogo[];
  /**
   * A carreta que este cavalo puxa, quando a fonte declara uma.
   *
   * Vai junto porque o pedido de compra não conhece a fronteira entre cavalo e
   * implemento: quem compra pneu compra para o conjunto. É atalho de navegação,
   * e nada dele entra em número nenhum desta consulta.
   */
  vinculo: { placa: string; entityId: string } | null;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

function linhaDeCalculavel(linha: LinhaCalculavel): LinhaDoProduto {
  return {
    code: linha.code,
    titulo: linha.titulo,
    sourceName: linha.sourceName,
    exibicao: null,
    valor: linha.valor,
    unit: linha.unit,
    periodicity: linha.periodicity,
    gaveta: linha.gaveta,
    apurado: true,
    motivo: null,
    origem: linha.origem,
  };
}

function linhaDeNaoApurado(componente: ComponenteNaoApurado): LinhaDoProduto {
  return {
    code: componente.code,
    titulo: componente.titulo,
    sourceName: componente.sourceName,
    exibicao: componente.valorExibido,
    valor: componente.valorNumerico,
    unit: componente.unit,
    periodicity: componente.periodicity,
    gaveta: null,
    apurado: false,
    /*
      A explicação, e não o rótulo do motivo. O rótulo — "Não somável" — é
      taxonomia, escrita para quem varre uma coluna de tabela; a explicação diz
      o que aconteceu com *esta* coluna, e é o que serve a quem tem um pedido na
      mão. Onde há base que destrave, ela entra na mesma frase: saber que falta
      a quilometragem é o que transforma "não dá" em "peça isto à Ambev".
    */
    motivo:
      componente.baseQueFalta === null
        ? componente.explicacao
        : `${componente.explicacao} ${componente.baseQueFalta}`,
    origem: null,
  };
}

/**
 * A linha que vira destaque — ou nenhuma.
 *
 * Só concorre o que passou no portão **e** é dinheiro: uma razão em R$/km e um
 * contador de eixos podem ser a única linha apurada de um produto sem que
 * nenhum dos dois responda "quanto a Ambev remunera isto".
 */
function destaqueDe(linhas: LinhaDoProduto[]): LinhaDoProduto | null {
  const candidatas = linhas.filter((l) => l.apurado && l.unit === "BRL");
  return candidatas.length === 1 ? candidatas[0]! : null;
}

/**
 * O remunerado de uma placa, produto a produto.
 *
 * Devolve `null` quando a placa não existe no banco ou quando o contexto não
 * tem vigência nenhuma — a rota traduz em 404, e a tela diz qual dos dois foi.
 */
export async function remuneradoDaPlaca(
  db: Database,
  placa: string,
  opcoes: { period?: string; context?: EscopoDaConsulta } = {},
): Promise<ConsultaDaPlaca | null> {
  const encontrada = await acharPlaca(db, placa);
  if (!encontrada) return null;

  const composicao = await montarComposicao(db, encontrada.entityId, {
    ...(opcoes.period !== undefined ? { period: opcoes.period } : {}),
    ...(opcoes.context !== undefined ? { context: opcoes.context } : {}),
    comAnterior: false,
  });
  if (!composicao) return null;

  /*
    Um índice por produto, alimentado pelas duas listas que a composição
    devolve. As duas entram, e a ordem entre elas não é arbitrária: a linha
    apurada vem antes da não apurada dentro do mesmo produto, porque é a que
    responde a pergunta. Dentro de cada grupo, a ordem é a que a composição já
    estabeleceu.
  */
  const porProduto = new Map<string, LinhaDoProduto[]>();
  const foraDoCatalogo = new Map<string, ForaDoCatalogo>();

  const registrar = (
    rubrica: string,
    familia: string,
    linha: LinhaDoProduto,
  ): void => {
    const produto = produtoDaRubrica(rubrica);
    if (produto === null) {
      const atual = foraDoCatalogo.get(rubrica);
      if (atual) atual.colunas += 1;
      else foraDoCatalogo.set(rubrica, { rubrica, familia, colunas: 1 });
      return;
    }
    const lista = porProduto.get(produto.chave);
    if (lista) lista.push(linha);
    else porProduto.set(produto.chave, [linha]);
  };

  for (const linha of composicao.linhas) {
    registrar(linha.parametro, linha.familia, linhaDeCalculavel(linha));
  }
  for (const componente of composicao.naoApurados) {
    registrar(componente.parametro, componente.familia, linhaDeNaoApurado(componente));
  }

  /*
    O catálogo dita a ordem, e não os dados. Um produto sem nenhuma coluna nesta
    placa **aparece assim mesmo**, vazio: some-lo faria a tela responder "a
    Ambev não remunera pneu para este veículo" com um silêncio, que é a resposta
    que este produto inteiro existe para não dar.
  */
  const produtos: ProdutoConsultado[] = produtosDoBalcao("FROTA").map((produto) => {
    const linhas = porProduto.get(produto.chave) ?? [];
    return {
      produto,
      linhas,
      destaque: destaqueDe(linhas),
      semNumero: linhas.every((l) => l.valor === null),
    };
  });

  /*
    O vínculo sai da vigência que a composição **já resolveu**, e não do que
    veio na consulta. É a mesma decisão que `routes/composition.ts` documenta:
    reenviar o pedido faria a leitura resolvê-lo uma segunda vez, e duas
    resoluções são duas chances de a consulta e o atalho dela falarem de
    vigências diferentes.

    A ambiguidade — mais de uma carreta corrente com a mesma placa — derruba o
    atalho e não a consulta. Quem tem um pedido na mão precisa do remunerado do
    veículo que digitou; um atalho que não sabe para onde apontar é motivo para
    não oferecer atalho, não para negar a resposta.
  */
  const vinculoDoCavalo =
    composicao.entityType === "CAVALO"
      ? await getVinculoDoCavalo(db, encontrada.entityId, {
          effectiveDate: composicao.effectiveDate,
          context: { scopeHash: composicao.scopeHash, channel: composicao.channel },
        })
      : null;

  const vinculo =
    vinculoDoCavalo?.carretaEntityId && vinculoDoCavalo.ambiguidade === null
      ? {
          placa: vinculoDoCavalo.placaCarreta,
          entityId: vinculoDoCavalo.carretaEntityId,
        }
      : null;

  return {
    placa: encontrada,
    entityType: composicao.entityType,
    rotuloDoTipo: composicao.rotuloDoTipo,
    chassi: composicao.chassi,
    unidade: composicao.unidade,
    operacao: composicao.operacao,
    contextLabel: composicao.contextLabel,
    effectiveDate: composicao.effectiveDate,
    periodLabel: composicao.periodLabel,
    presente: composicao.presente,
    produtos,
    foraDoCatalogo: [...foraDoCatalogo.values()].sort((a, b) => b.colunas - a.colunas),
    vinculo,
  };
}
