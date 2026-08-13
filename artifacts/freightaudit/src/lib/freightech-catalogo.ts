/**
 * O catálogo de cartões do Freightech — as gavetas, na ordem e com os nomes de lá.
 *
 * Este arquivo existe porque a tela de parâmetros passou a ter uma obrigação
 * nova: **mostrar todos os cartões que o Freightech mostra, mesmo os que este
 * export ainda não alimenta.** Antes eles viravam nota de rodapé; a nota era
 * honesta, mas respondia à pergunta errada. Quem abre esta tela está procurando
 * uma gaveta que conhece pelo nome, e não achar o nome é indistinguível de o
 * produto não cobrir o assunto.
 *
 * Então o cartão existe sempre, e o que muda é o que ele diz por dentro:
 *
 * - **com dado** → o impacto, as alterações e os veículos;
 * - **sem dado** → "sem dado neste export", escrito, no lugar de um número.
 *
 * A regra antiga não foi afrouxada, foi transferida: o cartão vazio não pode
 * *fingir* cobertura. Ele aparece cinza, diz que não tem dado e não abre para
 * uma tela de detalhe que não teria o que mostrar.
 *
 * **Por que aqui e não em `lib/comparison`.** Este é o mapa das telas do
 * sistema de origem, não uma projeção dos nossos fatos: ele precisa existir
 * mesmo quando não há vigência nenhuma importada — que é exatamente o momento
 * em que a resposta da API é 404 e não haveria nada para projetar. Um catálogo
 * que some quando o banco está vazio não é catálogo.
 *
 * **Fonte.** Transcrito das telas de Escolha de Segmento do Freightech —
 * CAMAÇARI-OPERALOG, canal EMPURRADA, vigência EMPURRADA_1_8_2026. Onde uma
 * captura anterior de outra unidade divergia, **vale esta**: o conjunto de
 * cartões varia por unidade, e misturar duas produz uma tela que não
 * corresponde a nenhuma das duas.
 *
 * Um parâmetro nosso cujo cartão saiu do catálogo não some — cai na seção do
 * FreightCheck, com o nome que damos a ele.
 */

export interface CartaoCatalogo {
  /** O rótulo exatamente como o Freightech escreve. */
  nome: string;
  /**
   * Os nossos parâmetros que alimentam este cartão, pelo nome que
   * `lib/comparison/src/families.ts` lhes dá.
   *
   * Fica vazio quando não há correspondência de que se tenha certeza. Chutar
   * uma ligação aqui seria pendurar dinheiro na gaveta errada — o erro mais
   * caro que esta tela pode cometer, e invisível para quem lê.
   */
  parametros?: string[];
  /**
   * As colunas da tabela que o Freightech mostra ao abrir este cartão, nos
   * nomes de lá — inclusive os grudados, como `MESINDICEREAJUSTE`.
   *
   * Servem para duas coisas. A primeira é o reconhecimento: a tela abre com o
   * mesmo cabeçalho que a pessoa já conhece, mesmo antes de ter uma linha. A
   * segunda é mais útil e menos óbvia — **elas dizem o que este export não
   * traz**. Quando o Freightech publica `INDICEMENSAL` e `NEGOCIADO` e a nossa
   * planilha não tem nada equivalente, a coluna vazia é a evidência de qual
   * arquivo pedir, e é mais precisa do que "falta dado neste cartão".
   *
   * Preenchido conforme cada tela é conferida contra o Freightech. Cartão sem
   * `colunas` ainda não teve a sua olhada — e a tela diz isso, em vez de
   * inventar um cabeçalho plausível.
   */
  colunas?: string[];
  /**
   * As colunas do export que **são** este cartão, pelo código do atributo.
   *
   * Existe porque `parametros` não alcança todos os casos. O nosso dicionário
   * agrupa colunas em parâmetros — `cavalo.padrao` mora dentro de "Caminhão",
   * junto de chassi, modelo e ano — e há cartão do Freightech que é exatamente
   * *uma* dessas colunas, não o grupo inteiro. PADRÃO é isso: a lista dos
   * padrões de eixo, que no export é uma coluna por ativo.
   *
   * Quando preenchido, a tela do cartão mostra o **domínio** daquela coluna —
   * os valores distintos e quantos ativos em cada — que é a forma que a tela
   * de lá tem. Sem isto, o cartão diria "sem dado neste export" a respeito de
   * uma coluna que chega em toda planilha, o que é simplesmente falso.
   */
  atributos?: string[];
  /**
   * Uma frase sobre a distância entre a tela de lá e o que temos aqui.
   *
   * Só existe quando as duas divergem de um jeito que enganaria em silêncio.
   * ÍNDICE DE REAJUSTE é o caso exemplar: lá é a lista dos índices (IGPM,
   * IPCA); aqui é o percentual e o valor que aquele índice produziu em cada
   * ativo. As duas coisas se chamam igual, respondem perguntas diferentes, e
   * quem abrir esperando uma e receber a outra não tem como perceber sozinho.
   */
  nota?: string;
  /**
   * O tipo de ativo quando o cartão é um **inventário** — uma linha por
   * veículo, e não uma lista de mudanças nem de valores distintos.
   *
   * CARRETA e CAVALO são assim: a placa à esquerda e dezenas de colunas ao
   * lado. Com `entidade` preenchida, `atributos` deixa de ser "a coluna que é
   * este cartão" e passa a ser **a lista de colunas da tabela**, na ordem em
   * que o Freightech as mostra.
   */
  entidade?: string;
}

export interface SecaoCatalogo {
  /** O título da seção, em caixa alta como lá. */
  titulo: string;
  cartoes: CartaoCatalogo[];
}

export const CATALOGO_FREIGHTECH: SecaoCatalogo[] = [
  {
    /*
      GERAL é a primeira seção da tela do Freightech, e a ordem não é detalhe:
      quem rola procurando "Índice de reajuste" espera encontrá-lo antes de
      FROTA, porque é onde ele sempre esteve.

      "Manutenção implemento" existe aqui e em FROTA. São gavetas diferentes no
      Freightech, e continuam duas aqui — a chave do cartão leva a seção junto
      justamente por isso.
    */
    titulo: "Geral",
    cartoes: [
      {
        /*
          O cadastro do índice: uma linha por (índice, ano, mês) com o valor do
          mês e o negociado. É registro de referência, não medida de veículo —
          e é por isso que o export de equipamento não o traz. O que chega aqui
          é o *resultado* dele aplicado a cada ativo, que mora no cartão
          "Índice de reajuste", logo abaixo neste mesmo GERAL.
        */
        nome: "Cadastro índice de reajuste",
        colunas: [
          "Indicedereajuste",
          "Ano",
          "Mesindicereajuste",
          "Indicemensal",
          "Negociado",
        ],
      },
      { nome: "Conjunto" },
      { nome: "Manutenção" },
      { nome: "Manutenção implemento" },
      {
        /*
          O cadastro dos padrões de eixo — 6X4, 6X2, 4X2, 6X6, 8X2. No
          Freightech é uma tabela de uma coluna; no nosso export é
          `cavalo.padrao`, uma coluna por ativo. A mesma informação nas duas
          formas, e a nossa ainda diz quantos caminhões estão em cada padrão.
        */
        nome: "Padrão",
        colunas: ["Descricao"],
        atributos: ["cavalo.padrao"],
      },
      {
        /*
          O benchmark de quadro: uma linha por cargo, com o valor em dois
          patamares (VALOR0 e VALOR15). É cadastro de pessoal, e o export que
          chega aqui é de equipamento — cavalo e carreta, uma linha por ativo.
          Nenhuma coluna dele cai neste cartão, e a família Equipe inteira está
          na mesma situação.

          Na captura conferida, todas as linhas vinham com valor 0 nas duas
          colunas. Isso é observação da tela de lá, não dado nosso, e por isso
          não vira número em lugar nenhum deste produto.
        */
        nome: "QLP benchmark",
        /*
          Conferido em três capturas com rolagem horizontal, e a emenda entre
          VALOR15 e VALOR30 — a única faixa que as capturas não mostravam —
          confirmada depois: não há coluna ali. A lista está completa.

          A sequência é irregular de propósito: não existe VALOR20, VALOR25 nem
          VALOR40. Vale registrar, porque a próxima pessoa a olhar vai achar que
          falta um e ficar tentada a completar.
        */
        colunas: [
          "Cargoqlpempurrada",
          "Valor0",
          "Valor15",
          "Valor30",
          "Valor50",
          "Valor60",
          "Valor70",
          "Valor80",
        ],
      },
      {
        /*
          O irmão do QLP benchmark: as mesmas linhas de cargo, as mesmas faixas,
          e no lugar do valor a **quantidade** de pessoas em cada faixa. Os dois
          cartões são a mesma tabela lida por duas colunas diferentes.

          A faixa entre 15 e 30 não apareceu nas capturas deste cartão, e foi
          herdada da confirmação feita para o QLP BENCHMARK — que tem as mesmas
          sete faixas, na mesma ordem irregular. É inferência, não observação, e
          fica escrito como tal: se este cartão divergir do irmão, é aqui que a
          diferença vai estar.
        */
        nome: "QLP benchmark quantidade",
        colunas: [
          "Cargoqlpempurrada",
          "Quantidade0",
          "Quantidade15",
          "Quantidade30",
          "Quantidade50",
          "Quantidade60",
          "Quantidade70",
          "Quantidade80",
        ],
      },
      { nome: "QLP benchmark valor" },
      { nome: "Tipo conjunto" },
      {
        nome: "Índice de reajuste",
        parametros: ["Índice de reajuste"],
        colunas: ["Descricao"],
        nota:
          "No Freightech esta tela lista os índices cadastrados — IGPM, IPCA. O export " +
          "de equipamento não traz esse cadastro: traz o resultado dele, o percentual " +
          "de reajuste aplicado e o valor reajustado, ativo por ativo. É por isso que a " +
          "tabela abaixo mostra alterações de valor e não uma lista de siglas — e é o " +
          "que o Freightech não mostra em lugar nenhum.",
      },
    ],
  },
  {
    titulo: "Frota",
    cartoes: [
      {
        /*
          O inventário do implemento: uma linha por placa, cinquenta colunas ao
          lado. É a tela mais larga do Freightech que conferimos, e a primeira
          em que o nosso export bate quase coluna a coluna — `carreta.placa`,
          `carreta.chassi`, `carreta.ciclo`, `carreta.tjlp`, todas já chegam.

          As colunas foram lidas de 17 capturas com rolagem horizontal e
          costuradas pelas emendas: cada captura que terminava cortada começava
          a seguinte. Onde duas capturas não se sobrepunham, a ordem entre os
          blocos é a que a rolagem sugeriu e pode estar trocada — os nomes estão
          todos certos, a sequência entre blocos é que não foi vista inteira.
          Uma coluna trocada de lugar atrapalha menos do que uma coluna
          inventada, e por isso nenhuma foi.

          `Statusfinanciamentot1shared` aparecia truncado na captura como
          `Statusfinanciamentot1sha…`. O nome inteiro não veio de um print: veio
          do nosso próprio dicionário, que tem `carreta.status_financiamento_t1_shared`
          — a mesma coluna, no nosso jeito de escrever. Duas fontes
          independentes descrevendo o mesmo export é o que autoriza completar o
          rótulo sem ter visto a tela inteira.
        */
        nome: "Carreta",
        parametros: ["Carreta"],
        entidade: "CARRETA",
        colunas: [
          "Placa", "Data", "Implemento",
          "Modelo", "Tipocarroceriaempurrada", "Capacidadeempurrada",
          "Capacidadepalletsrealempurrada", "Eixoempurrada", "Pneumedidaempurrada",
          "Mesdeentrada", "Ciclo", "Statusfinanciamento", "Statusfinanciamentot1shared",
          "Ipvalicenciamento", "Percentualentrada",
          "Periodofiname", "Carencia", "Tjlp", "Spreadbndes", "Spreadbanco",
          "Taxafiname", "Doubledeck", "Custoaluguel", "Chassi", "Empresalocadora",
          "Frotaemprestada", "Valorpneus",
          "Percentualicms", "Valornfcompra", "Ano",
          "Custofixo", "Lucrovariavelprevisto", "Piscofins", "Icms", "Datafimcontrato",
          "Valorpiscofins", "Valoricms", "Amortizacaoimplemento",
          "Jurosfinameimplemento", "Finameimplemento", "Lucrofixomodelonovociclocarreta",
          "Lucrovariavelprevistocarreta", "Seguro", "Rastreador",
          "Faixareflexiva", "Tacografo", "Revestimento", "Ipvalicenciamentomensal",
          "Finame", "Lucrofixomodelonovociclo",
        ],
        atributos: [
          "carreta.placa", "carreta.data", "carreta.implemento",
          "carreta.modelo", "carreta.tipo_carroceria_empurrada", "carreta.capacidade_empurrada",
          "carreta.capacidade_pallets_real_empurrada", "carreta.eixo_empurrada",
          "carreta.mes_de_entrada", "carreta.ciclo",
          "carreta.status_financiamento", "carreta.status_financiamento_t1_shared",
          "carreta.ipva_licenciamento", "carreta.percentual_entrada",
          "carreta.periodo_finame", "carreta.carencia", "carreta.tjlp",
          "carreta.double_deck", "carreta.custo_aluguel", "carreta.chassi",
          "carreta.empresa_locadora", "carreta.frota_emprestada",
          "carreta.percentual_icms", "carreta.ano",
          "carreta.custo_fixo", "carreta.lucro_variavel_previsto",
          "carreta.pis_cofins", "carreta.icms", "carreta.data_fim_contrato",
          "carreta.amortizacao_implemento", "carreta.juros_finame_implemento",
          "carreta.finame_implemento", "carreta.lucro_fixomodelo_novo_ciclo_carreta",
          "carreta.lucro_variavel_previsto_carreta",
          "carreta.faixa_reflexiva", "carreta.ipva_licenciamento_mensal",
          "carreta.finame", "carreta.lucro_fixomodelo_novo_ciclo",
        ],
      },
      {
        /*
          O inventário do cavalo mecânico — a tela mais larga do Freightech, e
          a que o nosso export cobre melhor: 75 atributos `cavalo.*` chegam.

          Costurada de capturas com rolagem horizontal, pelas emendas, como a
          CARRETA. Onde duas capturas não se sobrepunham, a ordem *entre* os
          blocos é a que a rolagem sugeriu e pode estar trocada; dentro de cada
          bloco a sequência foi vista. Coluna trocada de lugar atrapalha menos
          do que coluna inventada, e nenhuma foi inventada.

          Sete rótulos apareceram cortados na tela e foram completados pelo
          nosso próprio dicionário, não por chute: `MANUTENCAOCOMPRAFORADO…` é
          `cavalo.manutencao_compra_fora_do_bid_autorizada`,
          `COMBUSTIVELPERCENTUALPER…` é `cavalo.combustivel_percentual_perda_vida`,
          e assim por diante. Duas fontes independentes descrevendo o mesmo
          export é o que autoriza completar um rótulo sem ter visto a tela
          inteira.

          Uma coluna ficou de fora de propósito: numa das capturas ela aparecia
          como `N…` e mais nada. Não dá para completar um nome a partir de uma
          letra, e um nome errado no cabeçalho é pior do que uma coluna a menos.

          O Freightech tem AÇÕES preso na direita (editar, excluir) e os botões
          TELEMETRIA / TROCAR CARRETA / ADICIONAR no topo. Nenhum deles entra
          aqui: o FreightCheck lê a planilha exportada e não escreve no
          Freightech, e um botão que parece agir e não age é pior do que a
          ausência dele. A coluna presa virou a placa, à esquerda — o que
          realmente resolve o problema de rolar setenta colunas.
        */
        nome: "Cavalo",
        parametros: ["Caminhão"],
        entidade: "CAVALO",
        nota:
          "Statusfinanciamento, Padraoshared e Consumoremunerado aparecem no Freightech e não têm coluna correspondente no export — por isso não estão na tabela.",
        colunas: [
          "Placa", "Placacarreta", "Ativo",
          "Freemaintenance", "Data", "Montadora",
          "Odometroentrada", "Faixakm", "Reaiskm",
          "Padrao", "Modeloempurrada", "Cambio", "Tipocombustivelempurrada",
          "Eixoempurrada", "Pneumedidaempurrada",
          "Mesdeentrada", "Ciclo", "Statusfinanciamento",
          "Statusfinanciamentot1shared", "Ipvalicenciamento", "Percentualentrada",
          "Periodofiname", "Carencia", "Tjlp", "Spreadbndes", "Spreadbanco",
          "Taxafiname",
          "Custoaluguel", "Frotaemprestada", "Empresalocadora",
          "Percentualicms", "Valornfcompra", "Ano",
          "Valorpneu", "Valorpiscofins", "Valoricms", "Amortizacaocavalo",
          "Jurosfinamecavalo", "Finamecavalo", "Lucrofixomodelonovociclocavalo",
          "Lucrovariavelprevistocavalo", "Regiaoempurrada",
          "Padraoshared", "Valorreajustado", "Percentualreajusteaplicado",
          "Anobid", "Chassi", "Custovariavelsimulado",
          "Manutencaoano", "Manutencaovidameses", "Manutencaofreemaintenance",
          "Consumoremunerado", "Manutencaocompraforadobidautorizada",
          "Manutencaoganhadorbid",
          "Combustivelconsumobenchmark", "Combustivelconsumoneg",
          "Combustivelconsumoneginteiro", "Combustivelcapacidade",
          "Combustivelvidacavalo", "Combustivelpercentualperdavida",
          "Manutencaobid", "Manutencaocontrato", "Manutencaoreaiskm",
          "Manutencaoreaiskminteiro", "Datafimcontrato",
        ],
        atributos: [
          "cavalo.placa", "cavalo.placa_carreta", "cavalo.ativo",
          "cavalo.free_maintenance", "cavalo.data", "cavalo.montadora",
          "cavalo.odometro_entrada", "cavalo.faixa_km", "cavalo.reaiskm",
          "cavalo.padrao", "cavalo.modelo_empurrada", "cavalo.cambio",
          "cavalo.tipo_combustivel_empurrada", "cavalo.eixo_empurrada",
          "cavalo.pneu_medida_empurrada",
          "cavalo.mes_de_entrada", "cavalo.ciclo",
          "cavalo.status_financiamento_t1_shared", "cavalo.ipva_licenciamento",
          "cavalo.percentual_entrada",
          "cavalo.periodo_finame", "cavalo.carencia", "cavalo.tjlp",
          "cavalo.spread_bndes", "cavalo.spread_banco", "cavalo.taxa_finame",
          "cavalo.custo_aluguel", "cavalo.frota_emprestada", "cavalo.empresa_locadora",
          "cavalo.percentual_icms", "cavalo.valor_nf_compra", "cavalo.ano",
          "cavalo.valor_pneu", "cavalo.valor_pis_cofins", "cavalo.valor_icms",
          "cavalo.amortizacao_cavalo", "cavalo.juros_finame_cavalo",
          "cavalo.finame_cavalo", "cavalo.lucro_fixomodelo_novo_ciclo_cavalo",
          "cavalo.lucro_variavel_previsto_cavalo", "cavalo.regiao_empurrada",
          "cavalo.valor_reajustado", "cavalo.percentual_reajuste_aplicado",
          "cavalo.ano_bid", "cavalo.chassi", "cavalo.custo_variavel_simulado",
          "cavalo.manutencao_ano", "cavalo.manutencao_vida_meses",
          "cavalo.manutencao_free_maintenance",
          "cavalo.manutencao_compra_fora_do_bid_autorizada", "cavalo.ganhador_bid",
          "cavalo.combustivel_consumo_benchmark", "cavalo.combustivel_consumo_neg",
          "cavalo.combustivel_consumo_neg_inteiro", "cavalo.combustivel_capacidade",
          "cavalo.combustivel_vida_cavalo", "cavalo.combustivel_percentual_perda_vida",
          "cavalo.manutencao_bid", "cavalo.manutencao_contrato",
          "cavalo.manutencao_reais_km", "cavalo.manutencao_reais_km_inteiro",
          "cavalo.data_fim_contrato",
        ],
      },
      { nome: "Combustível", parametros: ["Combustível"] },
      { nome: "Consumo", parametros: ["Consumo benchmark"] },
      { nome: "Contrato manutenção", parametros: ["Contrato de manutenção"] },
      { nome: "Custo fixo total", parametros: ["Custo fixo (total)"] },
      { nome: "Lucro FINAME" },
      { nome: "Manutenção BID", parametros: ["Manutenção BID"] },
      { nome: "Manutenção implemento", parametros: ["Manutenção carroceria"] },
      { nome: "Modelo" },
      { nome: "Parâmetros consumo" },
      { nome: "Parâmetros manutenção", parametros: ["Manutenção cavalo"] },
      { nome: "Prazo FINAME" },
      { nome: "Prazo FINAME manutenção" },
      { nome: "Tipo carroceria" },
      { nome: "Trecho" },
    ],
  },
  {
    titulo: "Equipe",
    cartoes: [
      { nome: "Benefício dias úteis" },
      { nome: "Benefícios auxiliares" },
      { nome: "Benefícios remunerados" },
      { nome: "Cargo equipe" },
      { nome: "Cargo QLP" },
      { nome: "Classificação QLP" },
      { nome: "Equipe" },
      { nome: "Parâmetros equipe" },
      { nome: "QLP ADM" },
      { nome: "QLP ADM total" },
      { nome: "Turno" },
    ],
  },
  {
    titulo: "Despesas",
    cartoes: [
      { nome: "Despesas operacionais" },
      { nome: "Encargos e provisões com férias" },
      { nome: "Encargos e provisões sem férias" },
    ],
  },
  {
    titulo: "Parâmetros gerais",
    cartoes: [
      { nome: "Capacidade" },
      { nome: "Eixo" },
      { nome: "Empresa locadora", parametros: ["Empresa locadora"] },
      { nome: "Lucro" },
      { nome: "Parâmetros fiscal" },
      { nome: "Parâmetros operação", parametros: ["Parâmetros de operação"] },
      { nome: "Percentual descartável" },
      { nome: "Região", parametros: ["Região"] },
      { nome: "Tipo combustivel" },
      { nome: "Tipo palletização" },
      { nome: "Unidade" },
    ],
  },
  {
    titulo: "Pneus",
    cartoes: [
      { nome: "Parâmetros pneu", parametros: ["Pneu"] },
      { nome: "Pneu capacidade" },
      { nome: "Pneu empurrada" },
      { nome: "Pneu medida" },
      { nome: "Pneu tipo eixo" },
    ],
  },
  {
    titulo: "Remuneracao",
    cartoes: [
      { nome: "Custo equipe" },
      { nome: "Custo fixo empurrada" },
      { nome: "Faturamento" },
      { nome: "Resumo fixo CPRB" },
      { nome: "Resumo fixo empurrada" },
    ],
  },
  {
    titulo: "Uniformes e EPIs",
    cartoes: [
      { nome: "Uniformes e EPI benchmark" },
      { nome: "Uniformes e EPIs" },
      { nome: "Uniformes e EPIs geral" },
    ],
  },
  {
    titulo: "Dimensões",
    cartoes: [
      { nome: "Diesel destino" },
      { nome: "Implemento", parametros: ["Implemento"] },
      { nome: "Iniciativa" },
      { nome: "Logo padrão" },
      { nome: "Material" },
      { nome: "Modelo" },
      { nome: "Motor" },
      { nome: "Perfil" },
      { nome: "Remuneração modelo" },
      { nome: "Status financiamento" },
      { nome: "Tipo" },
    ],
  },
];

/**
 * Uma chave estável por cartão — sobrevive a mudança de rótulo e serve de
 * endereço na URL e de identidade do favorito.
 *
 * Leva a seção junto porque há nome repetido entre seções ("Modelo" está em
 * Frota e em Dimensões, e são gavetas diferentes).
 */
export function chaveDoCartao(secao: string, nome: string): string {
  return `${slug(secao)}.${slug(nome)}`;
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Todos os nomes de parâmetro nossos que já têm cartão no catálogo. */
export const PARAMETROS_NO_CATALOGO = new Set(
  CATALOGO_FREIGHTECH.flatMap((secao) =>
    secao.cartoes.flatMap((cartao) => cartao.parametros ?? []),
  ),
);

/**
 * Quais dos nossos parâmetros alimentam cada cartão do catálogo.
 *
 * Mora aqui, e não na tela, porque **duas telas fazem esta mesma pergunta**:
 * Parâmetros, para saber o que mostrar dentro do cartão, e Dados, para dizer o
 * que tem e o que falta. Se cada uma casasse as listas por conta própria, um
 * dia elas discordariam — e a tela que existe para responder "isto tem dado?"
 * responderia diferente da tela que mostra o dado. Uma função só, uma resposta
 * só.
 *
 * Duas passagens, e a ordem entre elas importa:
 *
 * 1. **O mapeamento escrito à mão**, que resolve os casos em que os dois
 *    sistemas dão nomes diferentes à mesma gaveta — "Cavalo" lá é "Caminhão"
 *    aqui.
 * 2. **Nome idêntico**, para o que sobrou. Não é chute: "Fator consumo" aqui e
 *    "Fator consumo" lá são a mesma coisa.
 *
 * Um parâmetro só entra num cartão. Há rótulo repetido entre seções ("Modelo"
 * está em Frota e em Dimensões, "Manutenção implemento" em Geral e em Frota);
 * sem essa trava o mesmo dinheiro apareceria em duas gavetas.
 */
export function ligarParametros(nomes: readonly string[]): {
  /** chave do cartão → nomes dos parâmetros que caem nele. */
  porCartao: Map<string, string[]>;
  /** Os que acharam cartão. O complemento é o que só o FreightCheck tem. */
  usados: Set<string>;
} {
  const disponiveis = new Set(nomes);
  const porNormalizado = new Map<string, string>();
  for (const nome of nomes) porNormalizado.set(normalizar(nome), nome);

  const porCartao = new Map<string, string[]>();
  const usados = new Set<string>();

  for (const secao of CATALOGO_FREIGHTECH) {
    for (const cartao of secao.cartoes) {
      const ligados = (cartao.parametros ?? []).filter((n) => disponiveis.has(n));
      for (const n of ligados) usados.add(n);
      if (ligados.length > 0) porCartao.set(chaveDoCartao(secao.titulo, cartao.nome), ligados);
    }
  }

  for (const secao of CATALOGO_FREIGHTECH) {
    for (const cartao of secao.cartoes) {
      const chave = chaveDoCartao(secao.titulo, cartao.nome);
      if (porCartao.has(chave)) continue;
      const achado = porNormalizado.get(normalizar(cartao.nome));
      if (achado && !usados.has(achado)) {
        usados.add(achado);
        porCartao.set(chave, [achado]);
      }
    }
  }

  return { porCartao, usados };
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}
