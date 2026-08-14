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
   * Quando o cartão abre um **formulário**, e não uma tabela.
   *
   * Nem toda gaveta do Freightech é uma lista. MANUTENÇÃO IMPLEMENTO abre uma
   * ficha de parâmetros: seções com título, campos com rótulo, e o valor num
   * campo de digitar. Enfiar esses rótulos em `colunas` seria chamá-los de
   * coluna e fazer a tela dizer "esta tela traz as colunas X, Y e Z" a respeito
   * de algo que não tem coluna nenhuma — a mesma categoria de erro que este
   * arquivo evita quando se recusa a inventar um cabeçalho.
   *
   * A distinção que mais importa aqui é **digitado versus calculado**. No
   * Freightech o campo calculado vem cinza, com um ícone de calculadora e outro
   * de fórmula ao lado; o digitado vem branco e editável. Numa ficha de três
   * campos em que só um se digita, confundir os dois é achar que o cliente
   * mexeu em três coisas quando ele mexeu numa.
   */
  formulario?: {
    /** O título da seção, como o Freightech escreve. */
    secao: string;
    campos: {
      /**
       * O rótulo do campo. Aqui o Freightech usa o camelCase interno
       * (`implemento28Menor150Km`), e não a caixa alta grudada dos cabeçalhos
       * de tabela — fica como está, porque é o que aparece na tela.
       */
      nome: string;
      /** Campo cinza, com calculadora ao lado: sai de fórmula, não se digita. */
      calculado?: boolean;
    }[];
  }[];
  /*
    Uma coisa que só as fichas revelaram, e que vale para todas elas.

    Os cabeçalhos de tabela do Freightech são rótulos de exibição — caixa alta,
    grudados, `CAPACIDADEEMPURRADA`. Os rótulos de ficha, não: são o nome
    interno do campo, em camelCase, e **o export usa esses mesmos nomes como
    cabeçalho de coluna**. `manutencaoReaisKm` está na ficha PARÂMETROS
    MANUTENÇÃO e na planilha de cavalos, letra por letra.

    A consequência prática é que rótulo de ficha se procura no export por busca
    exata, enquanto cabeçalho de tabela exige tradução. A consequência honesta é
    que a coincidência é rara: dos 20 campos das três fichas conferidas, só esse
    um aparece no export. Os outros 19 são parâmetros de unidade que a planilha
    de equipamento não publica.
  */
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
      {
        /*
          A tabela de preço do combustível: uma linha por combustível e
          iniciativa — DIESEL e ARLA na compra tradicional, DIESEL S10 no cartão
          de abastecimento, GASOLINA/ETANOL — com o preço da ANP, o preço da
          operadora e o preço já líquido do crédito de imposto.

          Conferida em três capturas com rolagem horizontal: DESCRICAO,
          INICIATIVA e CREDITOIMPOSTO à esquerda, PRECOANP, PRECOOPERADORA e
          PRECOCREDITOIMPOSTOS à direita, e a emenda entre as duas metades vista
          pelo CREDITOIMPOSTO, que aparece nas duas. CREDITOIMPOSTO é caixa de
          marcação, não número — nas quatro linhas vistas, nenhuma marcada.
          AÇÕES fica preso na ponta direita e não entra aqui, pela razão de
          sempre: o FreightCheck lê o export e não escreve no Freightech.

          **Nenhuma das seis colunas chega no export de equipamento.** Isto é
          cadastro de insumo, não medida de veículo, e a planilha que recebemos
          é de cavalo e carreta. O que cai neste cartão é o outro fator do mesmo
          custo — consumo negociado, capacidade do tanque, vida do cavalo e
          percentual de perda, ativo por ativo. Custo de combustível é preço
          vezes consumo, e temos o consumo sem o preço.
        */
        nome: "Combustível",
        parametros: ["Combustível"],
        colunas: [
          "Descricao",
          "Iniciativa",
          "Creditoimposto",
          "Precoanp",
          "Precooperadora",
          "Precocreditoimpostos",
        ],
        nota:
          "No Freightech esta tela é a tabela de preço do combustível — uma linha por " +
          "combustível e iniciativa (DIESEL e ARLA na tradicional, DIESEL S10 no cartão " +
          "de abastecimento), com o preço da ANP, o da operadora e o já líquido de " +
          "crédito de imposto. Nenhuma dessas colunas vem no export de equipamento: o " +
          "que a tabela abaixo mostra é o outro lado do mesmo custo — o que mudou no " +
          "consumo negociado, na capacidade e na vida do cavalo, ativo por ativo. Com o " +
          "consumo e sem o preço, o custo do combustível não fecha, e é o arquivo desta " +
          "tela que falta pedir.",
      },
      {
        /*
          A matriz do consumo de referência: uma linha por capacidade de
          implemento — Pallets: 20, 22, 24, 26, 28, 40, 42 — e uma coluna por
          montadora, com o km/l esperado em cada cruzamento. A coluna CONSUMO,
          entre a capacidade e as montadoras, é o valor base da linha; as
          montadoras repetem esse número e divergem onde a montadora tem
          benchmark próprio (em Pallets: 28, CONSUMO 2,394 e VOLKS 2,110).
          Montadora sem frota na unidade vem zerada — FORD, nas capturas.

          Conferida em três capturas com rolagem horizontal, costuradas pelo
          VOLVO, que aparece em duas delas: CAPACIDADEEMPURRADA, CONSUMO,
          MERCEDES, SCANIA, VOLKS, VOLVO, IVECO, FORD. A captura termina numa
          borda de coluna logo depois de FORD — se há mais montadora à direita,
          não foi vista, e nenhuma foi inventada para fechar a lista.

          **A tabela em si não chega no export.** O que chega é o resultado dela
          já resolvido, `cavalo.combustivel_consumo_benchmark`, um número por
          cavalo. Os dois eixos também chegam, cada um do seu lado: a montadora
          está no cavalo e a capacidade em pallets está na carreta. O que falta
          é justamente o cruzamento — sem ele dá para ver o benchmark que cada
          caminhão recebeu, e não a regra que atribuiu aquele número.
        */
        nome: "Consumo",
        parametros: ["Consumo benchmark"],
        colunas: [
          "Capacidadeempurrada",
          "Consumo",
          "Mercedes",
          "Scania",
          "Volks",
          "Volvo",
          "Iveco",
          "Ford",
        ],
        nota:
          "No Freightech esta tela é a matriz do consumo de referência — capacidade do " +
          "implemento nas linhas, montadora nas colunas, o km/l esperado em cada " +
          "cruzamento. O export não traz a matriz: traz o benchmark já resolvido em cada " +
          "cavalo, e por isso a tabela abaixo mostra o que mudou nesse número, ativo por " +
          "ativo. Os dois eixos chegam separados — montadora no cavalo, capacidade em " +
          "pallets na carreta — mas o cruzamento que atribui o valor é o que falta pedir.",
      },
      {
        /*
          **Uma linha por cavalo**, e não por contrato: PLACA à esquerda,
          MONTADORA e MODELO ao lado, DATACONTRATO, e depois uma coluna por
          faixa de odômetro — ATE120000, ATE240000, e assim de 120.000 em
          120.000 até ATE1200000 — com o R$/km daquele veículo em cada faixa.

          A identidade da linha só apareceu numa captura tirada depois das
          outras cinco. Sem ela a tela parecia uma tabela de preço com
          DATACONTRATO na ponta esquerda, e a leitura errada era plausível: as
          datas se repetem linha a linha, e uma coluna de data na primeira
          posição parece chave. É por isso que a placa está registrada aqui em
          primeiro lugar — quem ler esta entrada depois precisa saber, antes de
          qualquer coisa, que cada linha é um caminhão.

          **Duas colunas casam com o export ao pé da letra.** `cavalo.faixa_km`
          traz `ATE_120000`, `ATE_240000`, `ATE_360000` e `ATE_480000` — as
          mesmas faixas das colunas de lá, com um sublinhado a mais — e
          `cavalo.montadora` traz `Descrição: VOLVO`, `Descrição: VOLKS` e
          `Descrição: MERCEDES`, exatamente como a coluna MONTADORA escreve. São
          as ligações mais diretas que já encontramos entre uma tela do
          Freightech e colunas da planilha.

          MODELO é o único parente duvidoso da trinca: na tela vem `FH 420 -FH
          400`, sem prefixo e com cara de faixa de modelos; no export
          `cavalo.modelo_empurrada` vem `Modelo: FH460 6x2T`, um modelo só e com
          prefixo. Parecem dimensões diferentes, e por isso não estão declaradas
          como a mesma coisa em lugar nenhum.

          **A emenda entre MODELO e DATACONTRATO não fecha.** A captura da
          esquerda termina no MODELO e a seguinte começa no DATACONTRATO, sem
          coluna repetida entre as duas e sem progressão que sirva de prova —
          pode haver coluna ali que ninguém viu. As emendas da direita fecham
          por coluna repetida: ATE1080000 em duas capturas, ATE1200001 nas duas
          últimas. E entre ATE240000 e ATE360000, quem fecha é a progressão de
          120.000 em 120.000, que não deixa espaço para uma faixa não vista.

          Depois de ATE1200000 a sequência quebra: vêm ATE1200001, ATE1200002 e
          ATE1200003, um km entre elas. Está transcrito como apareceu — o que
          essas três faixas significam não dá para deduzir da tela, e inventar
          uma explicação seria pior do que registrar a estranheza. A captura
          termina numa borda de coluna logo depois de ATE1200003; se há mais à
          direita, não foi vista.

          Em todas as células de faixa das capturas o valor era 0. Isso é
          observação da tela de lá, não dado nosso, e por isso não vira número
          em lugar nenhum deste produto.
        */
        nome: "Contrato manutenção",
        parametros: ["Contrato de manutenção"],
        colunas: [
          "Placa",
          "Montadora",
          "Modelo",
          "Datacontrato",
          "Ate120000",
          "Ate240000",
          "Ate360000",
          "Ate480000",
          "Ate600000",
          "Ate720000",
          "Ate840000",
          "Ate960000",
          "Ate1080000",
          "Ate1200000",
          "Ate1200001",
          "Ate1200002",
          "Ate1200003",
        ],
        nota:
          "No Freightech esta tela é o contrato de manutenção veículo a veículo: uma " +
          "linha por placa, e o R$/km daquele caminhão em cada faixa de odômetro " +
          "(ATE120000, ATE240000, e assim por diante). Do export chegam a placa, a " +
          "montadora e a faixa em que o veículo está — cavalo.faixa_km usa as mesmas " +
          "faixas, com um sublinhado a mais — mas não a linha inteira de faixas: chega " +
          "o R$/km já resolvido em cada cavalo, e é sobre ele que a tabela abaixo " +
          "mostra o que mudou. Cuidado com um falso parente: DATACONTRATO é a data do " +
          "contrato na tela de lá, e o dataFimContrato do export é o fim do contrato de " +
          "cada veículo — não são a mesma data.",
      },
      {
        /*
          **Uma linha por tipo de conjunto, e os valores são médias.** Quatro
          linhas — CONJUNTO, ESTACIONARIA, CONJUNTO_28 e CONJUNTO_42 — e a
          coluna que fecha a conta se chama CUSTOFIXOMEDIO, que é o que diz em
          voz alta o que a tela faz: agrega. Não é inventário nem cadastro; é
          consolidação. Foi a captura da ponta esquerda que revelou isso — sem
          ela a tela parecia uma lista de valores sem dono.

          A ordem lida: TIPOCONJUNTOEMPURRADA, SEGURO, RASTREADOR,
          FAIXAREFLEXIVA, TACOGRAFO, REVESTIMENTO, IPVALICENCIAMENTOMENSAL, e
          então o bloco do cavalo (AMORTIZACAOCAVALO, JUROSFINAMECAVALO,
          FINAMECAVALO), o do implemento (AMORTIZACAOIMPLEMENTO,
          JUROSFINAMEIMPLEMENTO, FINAMEIMPLEMENTO), os totais (FINAME,
          LUCROFIXOMODELONOVO2CICLO, CUSTOFIXOMEDIO) e o lucro variável previsto
          em três colunas — cavalo, carreta e total.

          **Quatro colunas batem com o export por valor, não só por nome.** Na
          tela FAIXAREFLEXIVA é 15,943 nas quatro linhas, REVESTIMENTO é 277,939
          nas quatro, RASTREADOR é 0 nas quatro, e TACOGRAFO é 21,031 em três e
          0 numa. No export, `carreta.faixa_reflexiva` é 15,94 nas 657 carretas,
          `carreta.revestimento` é 277,94 em todas, `carreta.rastreador` é 0 em
          todas, e `carreta.tacografo` é 21,03 em 558 e 0 em 99. É a
          correspondência mais forte que já achamos: nas outras telas os nomes
          coincidiam, aqui coincidem os números.

          **O que falta para reconstruir esta tela é a chave de agrupamento.**
          `carreta.custo_fixo` chega, e as parcelas também; `tipoConjuntoEmpurrada`
          não vem em lugar nenhum do export. Sem ela dá para ter o custo fixo de
          cada carreta e não a média por tipo de conjunto, que é o que a tela
          responde. Vale registrar um eco, e só como eco: CONJUNTO_28 e
          CONJUNTO_42 lembram os `Pallets: 28` e `Pallets: 42` de
          `carreta.capacidade_empurrada`. CONJUNTO e ESTACIONARIA não têm
          parente à vista, e por isso a semelhança não vira mapeamento.

          **Nenhuma emenda fecha por coluna repetida** — as sete capturas se
          encostam sem sobreposição. Quem sustenta a ordem é a aritmética da
          própria tela: FINAME é a soma de FINAMECAVALO e FINAMEIMPLEMENTO nas
          quatro linhas, e CUSTOFIXOMEDIO é a soma de FINAME com
          LUCROFIXOMODELONOVO2CICLO nas quatro. Isso confirma que os blocos são
          o que parecem; **não** prova que não haja coluna escondida numa
          emenda, e a diferença entre as duas coisas é a razão deste parágrafo
          existir.

          Duas colunas ficaram de fora da lista de propósito. Entre FINAMECAVALO
          e AMORTIZACAOIMPLEMENTO, e de novo depois de FINAMEIMPLEMENTO, aparece
          `LUCROFIXOMODELONOVO2CICL…`, cortado nas duas vezes e com valores
          diferentes — são duas colunas distintas, e o pedaço visível não basta
          para nomear nenhuma. Somadas, dão o LUCROFIXOMODELONOVO2CICLO em três
          das quatro linhas (a que foge é ESTACIONARIA, que não tem cavalo), o
          que sugere que sejam a metade do cavalo e a do implemento. Sugerir não
          é ver: uma captura que mostre esses dois rótulos inteiros fecha o
          assunto. Nome errado no cabeçalho é pior do que coluna a menos.

          LUCROVARIAVELPREVISTOCAVALO e LUCROVARIAVELPREVISTOCARRETA também
          vieram cortados, mas esses entram: o nosso dicionário tem
          `cavalo.lucro_variavel_previsto_cavalo` e
          `carreta.lucro_variavel_previsto_carreta`, e duas fontes independentes
          descrevendo a mesma coisa é o que autoriza completar um rótulo — o
          mesmo critério que completou `Statusfinanciamentot1shared` na CARRETA.
        */
        nome: "Custo fixo total",
        parametros: ["Custo fixo (total)"],
        colunas: [
          "Tipoconjuntoempurrada",
          "Seguro",
          "Rastreador",
          "Faixareflexiva",
          "Tacografo",
          "Revestimento",
          "Ipvalicenciamentomensal",
          "Amortizacaocavalo",
          "Jurosfinamecavalo",
          "Finamecavalo",
          "Amortizacaoimplemento",
          "Jurosfinameimplemento",
          "Finameimplemento",
          "Finame",
          "Lucrofixomodelonovo2ciclo",
          "Custofixomedio",
          "Lucrovariavelprevistocavalo",
          "Lucrovariavelprevistocarreta",
          "Lucrovariavelprevisto",
        ],
        nota:
          "No Freightech esta tela é uma consolidação: uma linha por tipo de conjunto " +
          "(CONJUNTO, ESTACIONARIA, CONJUNTO_28, CONJUNTO_42) com a média das parcelas " +
          "do custo fixo — o nome CUSTOFIXOMEDIO diz isso. Boa parte das colunas chega " +
          "no export, e chega batendo por valor: faixa reflexiva, revestimento, " +
          "rastreador e tacógrafo têm na planilha os mesmos números que a tela mostra. " +
          "O que não chega é a chave que agrupa — tipoConjuntoEmpurrada não vem em " +
          "coluna nenhuma —, e sem ela dá para ver o custo fixo de cada carreta, que é " +
          "o que a tabela abaixo mostra, e não a média por tipo de conjunto.",
      },
      {
        /*
          A tabela da entrada por prazo: quatro linhas, PRAZOFINAME em meses e
          ENTRADA em percentual — 36 → 28, 48 → 25, 60 → 20, 72 → 20. Quanto
          mais longo o financiamento, menor a entrada exigida, até estabilizar.

          **A frota inteira do export mora numa dessas linhas.** `periodoFiname`
          é 60 nos 558 cavalos e em 648 das 657 carretas, e `percentualEntrada`
          é 20 nos mesmos ativos — que é exatamente o par da terceira linha
          desta tela. As nove carretas restantes têm 0 nas duas, coerentes entre
          si: sem financiamento, sem entrada. O export não traz a tabela, mas o
          que ele traz cai dentro dela sem sobra.

          **A lista de colunas está incompleta, e dá para provar pelo título.**
          A captura começa na borda esquerda da tabela — PRAZOFINAME é mesmo a
          primeira coluna — e termina numa borda de coluna logo depois do
          ENTRADA. Nenhuma das duas colunas visíveis é um lucro, e o cartão se
          chama LUCRO FINAME: existe pelo menos mais uma coluna à direita, e é
          justamente a que dá nome à tela. Ficam as duas que foram vistas, com o
          aviso junto — as telas anteriores ensinaram que a ponta que falta é
          onde mora o sentido da tabela.
        */
        nome: "Lucro FINAME",
        colunas: ["Prazofiname", "Entrada"],
        nota:
          "Atenção: esta lista está incompleta. A rolagem não foi até o fim e o cartão " +
          "se chama LUCRO FINAME, mas nenhuma das duas colunas vistas é um lucro — há " +
          "pelo menos mais uma à direita, ainda não capturada. O que se sabe da tela: é " +
          "a tabela da entrada por prazo de financiamento (36 meses → 28%, 48 → 25%, 60 " +
          "→ 20%, 72 → 20%). O export não traz essa tabela, mas traz o par já aplicado " +
          "em cada ativo, e ele cai dentro dela: periodoFiname 60 e percentualEntrada 20 " +
          "em toda a frota, que é a terceira linha desta tela. Esses dois valores chegam " +
          "pelas colunas de financiamento do cavalo e da carreta, e é lá que as " +
          "alterações deles aparecem — não neste cartão.",
      },
      {
        /*
          A matriz do BID de manutenção: a linha é a combinação de tipo de
          palletização, montadora e ano, e as colunas são as faixas de odômetro
          — ATE120000 até ATE1200000, de 120.000 em 120.000 — mais uma LINEAR no
          fim, com o R$/km de cada cruzamento.

          O ANO é de dois tipos e isso muda a linha: nas capturas as cinco
          primeiras trazem `MÉDIA` e vêm zeradas em todas as faixas; as
          seguintes trazem o ano (2011.0, 2012.0, 2013.0) e aí, sim, têm valor.
          GANHADORBID acompanha: vazio nas linhas de MÉDIA e `true` nas de ano.
          No export ele chega como `Ganhador BID`, 1 em 531 cavalos e 0 em 27 —
          o mesmo campo, escrito como número.

          MONTADORA bate ao pé da letra pela terceira vez neste catálogo: a tela
          traz `Descrição: MERCEDES`, `Descrição: SCANIA`, `Descrição: VOLKS`,
          `Descrição: VOLVO` e `Descrição: IVECO`, e `cavalo.montadora` traz
          exatamente essas cadeias, prefixo incluído.

          **TIPOPALLETIZACAOEMPURRADA é uma armadilha, e vale a pena explicá-la
          uma vez.** Ela traz `Palletizacao: 6X2` — o mesmo 6X2 do cartão
          PADRÃO, que no export é `Descricao: 6X2` (522 cavalos) e
          `Descricao: 6X4` (36). Tentador concluir que são a mesma coluna. Não
          são: o valor vem prefixado pelo campo de onde saiu, e prefixos
          diferentes significam campos diferentes — duas gavetas que
          compartilham o vocabulário de eixos e não a identidade.

          O que o prefixo **não** é: o nome da dimensão. Uma versão anterior
          desta entrada dizia isso, e o cadastro MODELO desmentiu — lá a coluna
          se chama DESCRICAO, e no export a montadora chega como
          `Descrição: VOLVO` enquanto o padrão chega como `Descricao: 6X2`. O
          mesmo prefixo em duas dimensões distintas: ele nomeia o campo dentro
          do cadastro, e vários cadastros chamam o seu campo de Descricao. A
          regra que sobrevive é a fraca e suficiente — prefixos diferentes,
          colunas diferentes. A forte era falsa.

          Uma observação que serve ao cartão CONTRATO MANUTENÇÃO, não a este:
          lá as faixas continuavam em ATE1200001, ATE1200002 e ATE1200003, um km
          entre elas, e ficou registrado como estranheza sem explicação. Aqui a
          mesma sequência de faixas termina em ATE1200000 e é seguida de LINEAR,
          uma coluna com nome próprio. É evidência de que aquelas três não são
          faixas de verdade — não é prova, e a pendência de lá continua aberta.

          Conferida em cinco capturas. A única emenda que não fecha é entre ANO
          e GANHADORBID, sem coluna repetida entre as duas; as demais fecham
          pela progressão de 120.000 em 120.000 e pelo `ATE1` cortado que emenda
          com ATE1080000. AÇÕES aparece preso na ponta direita, com o ícone de
          editar, e não entra aqui — o FreightCheck lê o export e não escreve no
          Freightech.
        */
        nome: "Manutenção BID",
        parametros: ["Manutenção BID"],
        colunas: [
          "Tipopalletizacaoempurrada",
          "Montadora",
          "Ano",
          "Ganhadorbid",
          "Ate120000",
          "Ate240000",
          "Ate360000",
          "Ate480000",
          "Ate600000",
          "Ate720000",
          "Ate840000",
          "Ate960000",
          "Ate1080000",
          "Ate1200000",
          "Linear",
        ],
        nota:
          "No Freightech esta tela é a matriz do BID: a linha combina tipo de " +
          "palletização, montadora e ano, e as colunas são as faixas de odômetro mais " +
          "uma LINEAR, com o R$/km de cada cruzamento. Linhas de ANO igual a MÉDIA vêm " +
          "zeradas; as de ano têm valor e GANHADORBID true. Do export chegam a montadora " +
          "— com o mesmo texto, prefixo incluído — e o ganhador do BID, mas não a " +
          "matriz: chega o R$/km já resolvido em cada cavalo, e é sobre ele que a tabela " +
          "abaixo mostra o que mudou. Não confunda TIPOPALLETIZACAOEMPURRADA com o " +
          "cartão PADRÃO: as duas dizem 6X2, mas o valor vem prefixado pelo campo de " +
          "onde saiu, e aqui o prefixo é Palletizacao, não Descricao.",
      },
      {
        /*
          **Este cartão não abre tabela: abre ficha.** Foi o primeiro assim a ser
          conferido, e por ele a estrutura ganhou o campo `formulario` —
          PARÂMETROS CONSUMO, conferido logo em seguida, mostrou que não é caso
          isolado. Uma aba "Geral", duas seções com régua laranja (Menor 150 Km
          e Maior 150 Km) e
          três campos em cada, mais Anexos ("Nenhum anexo é necessário") e uma
          Descrição em texto livre.

          Em cada seção só o primeiro campo é branco e editável. Os outros dois
          vêm cinza, com uma calculadora e um `</>` ao lado: são calculados, e o
          ícone de fórmula é o Freightech oferecendo mostrar a conta. Numa ficha
          de três campos em que um se digita e dois derivam, tratar os três como
          iguais é contar três alterações onde houve uma.

          Nas capturas as duas seções trazem os mesmos números — 0,11 digitado,
          0,10 e 0,20 calculados —, o que só se sabe porque as duas apareceram
          juntas. Isso é observação da tela de lá e não vira número aqui.

          Os rótulos vêm no camelCase interno, e não na caixa alta grudada dos
          cabeçalhos de tabela. Dois estavam cortados na captura:
          `implemento40CCreditoImpostosMenor1…` e `…Maior15…`. O fim foi
          completado pelo padrão da própria ficha — os outros quatro campos
          terminam em `Menor150Km` ou `Maior150Km`, e as seções se chamam
          "Menor 150 Km" e "Maior 150 Km". É o mesmo critério que completou
          `Statusfinanciamentot1shared` na CARRETA, e vale registrar que o
          começo desses dois rótulos foi visto e o fim foi deduzido.

          O 28 e o 40 dos nomes ecoam capacidades de implemento: `Pallets: 28` e
          `Pallets: 40` aparecem em CONSUMO e em `carreta.capacidade_empurrada`.
          É eco, não mapeamento — nenhuma dessas duas coisas foi declarada como
          a mesma no catálogo.

          Qual dos dois cartões com este nome é este: o de FROTA. O título da
          tela diz só MANUTENÇÃO IMPLEMENTO e não desempata — o que desempata é
          a sequência em que as telas foram conferidas, que segue a ordem da
          seção FROTA e chegou aqui depois de MANUTENÇÃO BID. O cartão de GERAL
          continua sem olhada.
        */
        nome: "Manutenção implemento",
        parametros: ["Manutenção carroceria"],
        formulario: [
          {
            secao: "Menor 150 Km",
            campos: [
              { nome: "implemento28Menor150Km" },
              { nome: "creditoImpostosMenor150Km", calculado: true },
              { nome: "implemento40CCreditoImpostosMenor150Km", calculado: true },
            ],
          },
          {
            secao: "Maior 150 Km",
            campos: [
              { nome: "implemento28Maior150Km" },
              { nome: "creditoImpostosMaior150Km", calculado: true },
              { nome: "implemento40CCreditoImpostosMaior150Km", calculado: true },
            ],
          },
        ],
        nota:
          "No Freightech este cartão não abre uma tabela: abre uma ficha de parâmetros, " +
          "com duas seções — abaixo e acima de 150 km — e três campos em cada. Só o " +
          "primeiro de cada seção é digitado; os outros dois vêm cinza, calculados por " +
          "fórmula. O export não traz nenhum desses campos. O que cai neste cartão são " +
          "as colunas de carroceria da carreta — revestimento, faixa reflexiva, " +
          "tacógrafo e rastreador —, que é outra pergunta sobre o mesmo assunto: a ficha " +
          "define o R$/km da manutenção do implemento, e o export diz o que cada carreta " +
          "custa nos itens dela.",
      },
      {
        /*
          O cadastro dos modelos de cavalo: uma coluna só, DESCRICAO, e AÇÕES
          preso na direita. Os valores vêm como o Freightech os escreve, com o
          traço no meio e o espaçamento irregular — `AXOR 2544`, `R400 - R380`,
          `TGX 28440 - CONSTELLATION 25 370`, `FH 420 -FH 400`,
          `STRALIS - 600/570`, `CONSTELLATION - 25 370`, `FH 420 6x2 SLP SC`,
          `P360 A 6x2`.

          **A lista repete.** Os cinco primeiros valores voltam na mesma ordem
          logo abaixo, e só então aparecem os que não tinham aparecido. Está
          registrado porque é a mesma coisa que já se sabia da base do
          Freightech — a ordem não é estável e há bloco repetido — e porque quem
          contar linhas aqui vai contar duplicata.

          **Este cadastro resolve uma dúvida do cartão CONTRATO MANUTENÇÃO.** Lá
          a coluna MODELO trazia `FH 420 -FH 400` e ficou anotada como parente
          duvidoso de `cavalo.modelo_empurrada`, que traz `Modelo: FH460 6x2T`.
          `FH 420 -FH 400` está nesta lista, letra por letra: a coluna de lá
          aponta para este cadastro, e não para a nossa. A dúvida estava certa —
          são dimensões diferentes, e continuam sem mapeamento entre si.

          Qual dos dois cartões chamados "Modelo" é este: o de FROTA, pela mesma
          razão do MANUTENÇÃO IMPLEMENTO acima — a sequência das telas conferidas
          segue a ordem da seção. O de DIMENSÕES continua sem olhada.
        */
        nome: "Modelo",
        colunas: ["Descricao"],
        nota:
          "No Freightech esta tela é o cadastro dos modelos de cavalo — uma coluna só, " +
          "com nomes como FH 420 -FH 400 e TGX 28440 - CONSTELLATION 25 370, e a lista " +
          "repete os primeiros valores mais abaixo. O export não traz esse cadastro. " +
          "Traz cavalo.modelo_empurrada, que é outra dimensão, com outro vocabulário " +
          "(Modelo: FH460 6x2T) — as duas falam de modelo e não são a mesma lista.",
      },
      {
        /*
          A segunda ficha do catálogo, e mais simples que a do implemento: aba
          "Geral", duas seções, onze campos, **todos brancos e digitados**.
          Nenhum campo cinza, nenhuma calculadora — aqui não há nada derivado, e
          é por isso que `calculado` não aparece em campo nenhum desta entrada.

          Todos os valores são percentuais, com o `%` na direita do campo, e o
          sinal importa: em Km Rodado eles são negativos e sobem até zero
          (-7,00 até 49 km, -5,00 em 50, -3,00 em 100, -2,00 em 250, 0,00 em
          500); em Ano Veículo eles começam positivos e viram negativos (3,00 no
          1, 2,00 no 2, -1,00 no 3, -1,50 no 4, -2,00 no 5). São ajustes, não
          medidas — o percentual que sobe ou desce do consumo conforme a
          distância rodada e a idade do veículo.

          `anoVeiculoPercentualAte1` fica por último no desenho, depois do 5,
          com 0,00 — a leitura pela ordem da tela põe "até 1 ano" no fim de uma
          sequência que vai de 1 a 5. Está transcrito na ordem em que aparece,
          que é a que a pessoa vê; se a ordem lógica é outra, isso é assunto do
          Freightech e não do catálogo.

          Qual dos cartões é este: o de FROTA, e aqui não há homônimo para
          desempatar — "Parâmetros consumo" só existe nessa seção.
        */
        nome: "Parâmetros consumo",
        formulario: [
          {
            secao: "Km Rodado",
            campos: [
              { nome: "kmRodadoPercentualAte49Km" },
              { nome: "kmRodadoPercentual50Km" },
              { nome: "kmRodadoPercentual100Km" },
              { nome: "kmRodadoPercentual250Km" },
              { nome: "kmRodadoPercentual500Km" },
            ],
          },
          {
            secao: "Ano Veículo",
            campos: [
              { nome: "anoVeiculoPercentual1" },
              { nome: "anoVeiculoPercentual2" },
              { nome: "anoVeiculoPercentual3" },
              { nome: "anoVeiculoPercentual4" },
              { nome: "anoVeiculoPercentual5" },
              { nome: "anoVeiculoPercentualAte1" },
            ],
          },
        ],
        nota:
          "No Freightech este cartão abre uma ficha, não uma tabela: onze percentuais " +
          "digitados, em duas seções — o ajuste do consumo por distância rodada e o " +
          "ajuste por idade do veículo. São as regras de ajuste, e o export não as traz. " +
          "O que ele traz é o resultado nos dois extremos: o consumo de referência e o " +
          "consumo negociado de cada cavalo, que moram nos cartões CONSUMO e " +
          "COMBUSTÍVEL. A diferença entre esses dois números é onde estes percentuais " +
          "agem — mas qual deles agiu em qual veículo, o arquivo não diz.",
      },
      {
        /*
          A terceira ficha, e a menor: três campos em duas seções — Manutenção,
          com `manutencaoReaisKm` (0,31) e `manutencaoExtra` (0,00), e
          Combustível, com `consumo` (1,942). Mais Anexos e Descrição, como nas
          outras duas.

          **Aqui o calculado vem primeiro.** No MANUTENÇÃO IMPLEMENTO o campo
          digitado abria cada seção e os derivados vinham depois; nesta ficha é
          o contrário — `manutencaoReaisKm` é cinza, com calculadora, e o
          `manutencaoExtra` ao lado é que se digita. O `consumo` também é
          calculado. Ou seja: a posição não diz nada sobre a natureza do campo,
          e quem for conferir a próxima ficha tem de olhar a cor, não a ordem.

          **É a ficha que provou a regra dos rótulos.** `manutencaoReaisKm` não
          é só parecido com uma coluna do export: é a mesma cadeia, letra por
          letra, do cabeçalho da planilha de cavalos. Foi essa coincidência que
          autorizou escrever, lá em cima, que rótulo de ficha é nome interno de
          campo — e que por isso se procura no export por busca exata. Dos 20
          campos das três fichas, só este aparece; os outros 19 são parâmetros de
          unidade que o export de equipamento não publica.

          Uma seção chamada Combustível dentro de PARÂMETROS MANUTENÇÃO não é
          engano de leitura: é assim mesmo. O Freightech agrupa nesta ficha os
          dois parâmetros de custo variável da unidade, e o consumo é um deles.
        */
        nome: "Parâmetros manutenção",
        parametros: ["Manutenção cavalo"],
        formulario: [
          {
            secao: "Manutenção",
            campos: [
              { nome: "manutencaoReaisKm", calculado: true },
              { nome: "manutencaoExtra" },
            ],
          },
          {
            secao: "Combustível",
            campos: [{ nome: "consumo", calculado: true }],
          },
        ],
        nota:
          "No Freightech este cartão abre uma ficha, não uma tabela: o R$/km de " +
          "manutenção e o consumo, ambos calculados por fórmula, mais um extra de " +
          "manutenção que se digita. O campo manutencaoReaisKm chega no export com esse " +
          "nome exato, uma linha por cavalo — o que a ficha mostra como um número da " +
          "unidade, a planilha mostra ativo por ativo, e é isso que a tabela abaixo " +
          "acompanha. O manutencaoExtra e o consumo desta ficha não vêm no arquivo.",
      },
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
