import { centavos, type Canal } from "./dominio";
import type {
  BlocoDoPagamento,
  DescontoDoPagamento,
  ItemDePagamento,
  Pagamento,
  TipoDeDescontoDoPagamento,
} from "./leitores/pagamento";
import type { NaturezaDaVerba } from "./verbas";

/**
 * O DE-PARA — a classificação do FreightCheck conversando com a da planilha.
 *
 * O fechamento classifica dinheiro por **VBZ**: `05 - Frota Fixa Variável`,
 * `07 - Freteiro`, cada uma com a sua natureza. A planilha `.xlsb` que este
 * módulo aposenta classifica o mesmo dinheiro por **quadro do RESUMO**: `CUSTO
 * FIXO PADRONIZADO`, `CUSTO VARIÁVEL (AGREGADO)`, `DESCONTO DE DEVOLUÇÃO`. São
 * dois recortes do mesmo total, e até aqui eles não se falavam: quem conferia
 * lia os dois lado a lado e casava na cabeça.
 *
 * Este arquivo é a tradução escrita — e, principalmente, **a tradução que
 * confessa onde não traduz**.
 *
 * **O que mudou em relação ao que o produto dizia antes.** `docs/FECHAMENTO.md`
 * registrava que as linhas do primeiro quadro — `CUSTO FIXO PADRONIZADO`,
 * `ESPECIAIS`, `VANS` — "conferidas contra o 03.08.20, não fecham". Fecham, e
 * a conferência que não fechava estava comparando coisas diferentes: a planilha
 * escreve a parcela **bruta** e mostra o desconto numa linha à parte; o 03.08.20
 * escreve a verba **já líquida** — cada desconto dele vem com a frase "Desconto
 * Liquido ja subtraido da VBZ …". Somar os descontos de volta é o termo que
 * faltava, e com ele o quadro fecha contra o demonstrativo. O que continua sem
 * fechar é o **rateio dentro do quadro**: padronizado, especiais e vans são uma
 * divisão por tipo de frota que o 03.08.20 não faz, e ninguém a deduz de um
 * relatório que não a traz.
 *
 * **A regra do módulo, herdada de `@workspace/remuneracao`: nenhuma linha
 * inventa a sua origem.** Cada linha da planilha declara em {@link Origem} de
 * onde o número sai — e as que não têm origem dizem por extenso o que falta,
 * nomeando o que as destravaria. Uma linha preenchida com o número certo sob o
 * rótulo errado é pior do que uma linha vazia: a vazia se resolve, a errada se
 * acredita.
 *
 * **O que fazer com o resíduo.** {@link conferirDePara} devolve, por quadro, o
 * que o 03.08.20 sustenta, o que o de-para conseguiu preencher e a diferença
 * entre os dois — junto com o nome das linhas que ainda não têm origem e das
 * verbas que nenhuma linha nomeia. O resíduo não é erro: é exatamente o que
 * essas duas listas somam, e é uma afirmação que a planilha derruba num
 * minuto se estiver errada. Quem tem o `.xlsb` aberto confere uma subtração em
 * vez de dezoito rótulos — e cada vez que ela não bater, o que se aprende é
 * qual das hipóteses deste arquivo caiu.
 *
 * **Por que só a Rota.** O painel transcrito aqui é o da Rota, rótulo por
 * rótulo, acento por acento. O AS tem um painel equivalente na mesma planilha e
 * os rótulos dele não foram capturados — escrevê-los por analogia com os da
 * Rota seria inventar a metade que falta. As verbas do AS já são lidas e
 * apuradas como sempre; o que não existe ainda é o de-para delas.
 */

/**
 * Os três quadros em que o RESUMO da planilha empilha a Rota.
 *
 * Eles não são invenção nossa nem da planilha: são a forma do próprio 03.08.20,
 * que abre cada canal em `FRETE` e `OUTROS CUSTOS` e fecha com `Total
 * Remuneração`. A planilha só parte o `FRETE` em dois — o que a frota recebe
 * por estar contratada e o que ela recebe por ter rodado —, que é a mesma
 * divisão que o catálogo de verbas chama de natureza.
 */
export type Quadro = "REMUNERACAO" | "VARIAVEL" | "OUTROS_CUSTOS";

/**
 * Qual das colunas do 03.08.20 o de-para lê.
 *
 * O padrão é `semImposto`, e a razão é aritmética, não estética: os descontos
 * do relatório são **líquidos, sem imposto** ("Desconto Liquido ja subtraido
 * da VBZ …"), e é somando-os de volta que a parcela bruta da planilha aparece.
 * Somar um desconto sem imposto a uma verba com imposto daria um bruto que não
 * é bruto de nada. As outras duas colunas existem para quem quer conferir a
 * mesma estrutura contra o CT-e (`ctrcIcms`) ou contra o total assinado
 * (`valorFaturado`) — e aí os descontos deixam de fechar, o que o resíduo diz.
 */
export type ColunaDoPagamento = "semImposto" | "ctrcIcms" | "valorFaturado";

/** O que a linha é dentro do quadro — e, por consequência, como ela soma. */
export type Papel =
  /** O nome do quadro, escrito na primeira linha dele. Não carrega valor. */
  | "TITULO"
  /** Uma parcela positiva. */
  | "PARCELA"
  /** Um abatimento. Entra na soma do quadro com sinal trocado. */
  | "DESCONTO"
  /** O fecho do quadro. Não soma: é contra ele que a soma se confere. */
  | "TOTAL";

/**
 * De onde o FreightCheck tira o número desta linha da planilha.
 *
 * As cinco primeiras variantes são leituras que este módulo sabe fazer sobre o
 * 03.08.20. `SEM_ORIGEM` é a variante honesta para o que ele não sabe fazer,
 * com o motivo e a destrava escritos.
 */
export type Origem =
  /**
   * As verbas de uma natureza dentro de um bloco do relatório, somadas.
   *
   * O recorte é por natureza e não por lista de VBZ de propósito: a VBZ é da
   * Ambev e muda quando ela muda; a natureza é do catálogo e é o que a planilha
   * de fato separa. Uma VBZ nova de frota fixa entra no quadro certo sozinha.
   */
  | { tipo: "VERBAS"; bloco: BlocoDoPagamento; naturezas: NaturezaDaVerba[] }
  /** Um ou mais descontos do 03.08.20, somados. */
  | { tipo: "DESCONTOS"; descontos: TipoDeDescontoDoPagamento[] }
  /** O percentual da devolução — o único campo do painel que não é dinheiro. */
  | { tipo: "PERCENTUAL_DA_DEVOLUCAO" }
  /** A soma de outras linhas deste mesmo de-para, com o sinal de cada papel. */
  | { tipo: "SOMA_DO_QUADRO" }
  /**
   * A linha só tem correspondência **junto com outras**, e o número é do grupo.
   *
   * É a mesma figura que `PIS + COFINS` é em `@workspace/remuneracao`: o
   * arquivo traz somado o que a planilha pede separado. Rachar o número pela
   * semelhança dos rótulos seria simples e seria invenção.
   */
  | { tipo: "EM_GRUPO"; grupo: string }
  /** Nada nas seis fontes sustenta esta linha — e aqui está o porquê. */
  | {
      tipo: "SEM_ORIGEM";
      motivo: string;
      /** O que a destravaria — sempre um dado ou uma decisão, nunca um prazo. */
      destrava: string;
    };

export interface LinhaDaPlanilha {
  /** A chave estável — o que a API e os testes usam. Nunca muda de sentido. */
  chave: string;
  /** O rótulo **como a planilha o escreve**, acento por acento. */
  rotulo: string;
  quadro: Quadro;
  papel: Papel;
  origem: Origem;
  /** Por que esta origem e não outra. A frase que sustenta a tradução. */
  porque: string;
}

/**
 * Um número do 03.08.20 que vale para mais de uma linha da planilha ao mesmo
 * tempo.
 *
 * Existem dois no painel da Rota, e os dois pela mesma razão: o relatório traz
 * um número onde a planilha pede vários, e o critério de rateio não está em
 * lugar nenhum dos arquivos.
 */
export interface GrupoDaPlanilha {
  chave: string;
  /** Como a tela nomeia o conjunto. */
  rotulo: string;
  /** As chaves que compartilham este número — todas, sem exceção. */
  linhas: string[];
  origem: Origem;
  /** O que impede o rateio entre as linhas do grupo. */
  porque: string;
  /**
   * Somar de volta os descontos que saíram destas verbas.
   *
   * Só o grupo do fixo faz isso, e é o termo que faltava para o quadro fechar:
   * a planilha escreve a parcela bruta, o 03.08.20 escreve a verba líquida.
   */
  brutoDeDescontos?: boolean;
}

/* =========================================================================
 * O painel da Rota, linha por linha, na ordem em que a planilha as empilha.
 * ====================================================================== */

/*
  As duas ausências que se repetem, escritas uma vez.

  A separação por tipo de frota volta em quatro linhas, e a indisponibilidade em
  duas. Repetir o texto seria garantir que um dia os quatro digam coisas
  ligeiramente diferentes sobre a mesma lacuna.
*/

/** O 03.08.20 não separa a frota dentro da verba. */
const SEM_TIPO_DE_FROTA = (o_que: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `${o_que} exige separar a frota por tipo dentro da mesma verba, e o 03.08.20 não faz ` +
    "essa separação: caminhão padrão, especial e van chegam somados na VBZ de frota fixa, " +
    "sem coluna que diga quanto é de cada um. O 2Art distingue os quatro tipos " +
    "(`Padrao`/`Spot`/`Fixo`/`Espec.`), e distingue no **variável** — a viagem que rodou —, " +
    "que é outra parcela.",
  destrava:
    "O rateio do fixo por tipo de frota, registrado em produto — ou um 03.08.20 que abra a " +
    "VBZ de frota fixa por tipo. Enquanto não houver, o valor do grupo é o teto conjunto " +
    "destas linhas, e é assim que ele aparece.",
});

/** A planilha tem duas linhas de disponibilidade e o relatório tem um bloco. */
const INDISPONIBILIDADE_INDEFINIDA = (quadro: string): Origem => ({
  tipo: "SEM_ORIGEM",
  motivo:
    `A planilha traz \`INDISPONIBILIDADE\` no quadro ${quadro} **e** uma linha de desconto ` +
    "de disponibilidade, que são duas coisas diferentes com nomes quase iguais. O 03.08.20 " +
    "traz um bloco só — `DESCONTO DISPONIBILIDADE`, com os quatro descontos —, e ele está " +
    "declarado na linha de desconto. Qual das duas leituras esta linha carrega — a " +
    "contrapartida positiva da frota indisponível, ou uma segunda via do mesmo abatimento — " +
    "não está escrito em fonte nenhuma, e chutar entre as duas trocaria o sinal do número.",
  destrava:
    "A fórmula desta célula no `.xlsb`, ou a confirmação de qual das duas linhas o " +
    "03.08.18 (disponibilidade de frota) alimenta.",
});

/**
 * O de-para, quadro a quadro, na ordem da planilha.
 *
 * A ordem é a dela e não a da facilidade: quem confere abre as duas lado a lado,
 * e uma tela que reordenasse obrigaria a procurar. O mesmo vale para os rótulos,
 * que são os literais do painel — inclusive `DVS`, que não é definido em nenhuma
 * das seis fontes e por isso mesmo não pode ser "melhorado" aqui.
 */
export const LINHAS_DA_PLANILHA: LinhaDaPlanilha[] = [
  /* --- Quadro 1: a remuneração da frota contratada ------------------------ */
  {
    chave: "rota_dvs_titulo",
    rotulo: "TOTAL REMUNERAÇÃO ROTA DVS",
    quadro: "REMUNERACAO",
    papel: "TITULO",
    origem: {
      tipo: "SEM_ORIGEM",
      motivo:
        "É o título do quadro, e a sigla `DVS` não aparece em nenhuma das seis fontes do " +
        "fechamento — nem no 03.08.20, nem no 2Art, nem na conciliação. Expandi-la por " +
        "palpite ('Diversos'? 'Distribuição de Vendas'?) poria uma definição nossa num " +
        "rótulo que é da Ambev.",
      destrava: "A legenda da planilha, ou a expansão da sigla confirmada por quem a mantém.",
    },
    porque:
      "Linha de título: nomeia o quadro e não carrega valor. O valor do quadro está no " +
      "`TOTAL REMUNERAÇÃO ROTA` que o fecha.",
  },
  {
    chave: "custo_fixo_padronizado",
    rotulo: "CUSTO FIXO PADRONIZADO",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "fixo_bruto" },
    porque:
      "A parcela da frota contratada padrão. Ela, `ESPECIAIS` e `VANS` são o mesmo dinheiro " +
      "do 03.08.20 partido por tipo de frota — uma divisão que o relatório não faz.",
  },
  {
    chave: "custo_fixo_inativos",
    rotulo: "CUSTO FIXO INATIVOS",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "fixo_bruto" },
    porque:
      "O 03.08.20 tem VBZ própria para a frota inativa (`04 - Frota Fixa Inativa` na Rota), o " +
      "que tornaria esta linha direta — se `CUSTO VANS INATIVAS` não a dividisse pelo mesmo " +
      "critério de frota que o relatório não traz. As duas entram no grupo por isso.",
  },
  {
    chave: "custo_vans_inativas",
    rotulo: "CUSTO VANS INATIVAS",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "fixo_bruto" },
    porque:
      "A fatia de van da frota inativa. A VBZ de frota inativa não separa van de caminhão — a " +
      "mesma ausência que trava o bloco de vans no cadastro (`@workspace/remuneracao`).",
  },
  {
    chave: "indisponibilidade_fixo",
    rotulo: "INDISPONIBILIDADE",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: INDISPONIBILIDADE_INDEFINIDA("do fixo"),
    porque:
      "Fica fora do grupo do fixo justamente porque o sinal dela é desconhecido: somá-la ao " +
      "grupo afirmaria que é parcela, e subtraí-la afirmaria que é desconto. Ela aparece no " +
      "resíduo do quadro, que é o único lugar em que uma linha de sinal desconhecido não mente.",
  },
  {
    chave: "custo_fixo_especiais",
    rotulo: "CUSTO FIXO - ESPECIAIS",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "fixo_bruto" },
    porque:
      "A frota que o 2Art marca `Espec.`. O tipo existe no diário operacional e não existe no " +
      "demonstrativo, que é onde o fixo mora.",
  },
  {
    chave: "custo_fixo_vans",
    rotulo: "CUSTO FIXO - VANS",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "fixo_bruto" },
    porque: "A van ativa. Mesma ausência de `CUSTO VANS INATIVAS`, do outro lado da atividade.",
  },
  {
    chave: "desconto_devolucao_percentual",
    rotulo: "DESCONTO DE DEVOLUÇÃO %",
    quadro: "REMUNERACAO",
    papel: "PARCELA",
    origem: { tipo: "PERCENTUAL_DA_DEVOLUCAO" },
    porque:
      "O rótulo termina em `%`, e o 03.08.20 traz o bloco da devolução aberto em três linhas — " +
      "base (`Valor S/Imposto`), alíquota (`% Dev. Resp. Transportadora`) e valor (`Desconto " +
      "Devolucao`). Esta linha recebe a **alíquota**; o dinheiro está em `DESCONTO DE " +
      "DEVOLUÇÃO`, no quadro do variável. Por não ser dinheiro, ela não entra na soma do quadro.",
  },
  {
    chave: "desconto_disponibilidade",
    rotulo: "DESCONTO DE DISPONIBILIDADE",
    quadro: "REMUNERACAO",
    papel: "DESCONTO",
    origem: {
      tipo: "DESCONTOS",
      descontos: [
        "DISPONIBILIDADE_CUSTO_FIXO",
        "DISPONIBILIDADE_EQUIPE",
        "DISPONIBILIDADE_INDIRETO",
        "DISPONIBILIDADE_FATOR_AJUDANTE",
      ],
    },
    porque:
      "Os quatro descontos do bloco `DESCONTO DISPONIBILIDADE`, somados. Eles pousam neste " +
      "quadro porque o próprio rótulo de cada um diz de qual verba saiu — `ja subtraido da " +
      "VBZ 01`, `02`, `03` —, e as três são verbas fixas. É leitura do arquivo, não " +
      "enquadramento nosso.",
  },
  {
    chave: "desconto_complementar_negativo",
    rotulo: "DESCONTO COMPLEMENTAR NEGATIVO",
    quadro: "REMUNERACAO",
    papel: "DESCONTO",
    origem: {
      tipo: "SEM_ORIGEM",
      motivo:
        "Nenhum bloco do 03.08.20 se chama assim. Sobra, do lado do relatório, exatamente um " +
        "desconto sem par: o `DESCONTO FRETE MINIMO`, cujo rótulo diz ter sido subtraído " +
        "'das VBZs de custo Fixo coluna ICMS' — o mesmo quadro em que esta linha está. Casar " +
        "os dois por serem os últimos que sobraram é elegante e é dedução: os nomes não se " +
        "parecem, e o frete mínimo é o maior desconto unilateral da conta (a apuração o " +
        "levanta como divergência própria, `DESCONTO_FRETE_MINIMO`). O de-para não os iguala; " +
        "deixa o frete mínimo no resíduo, para que a subtração diga se são a mesma coisa.",
      destrava:
        "A fórmula desta célula no `.xlsb`. Se ela apontar para o frete mínimo, a origem vira " +
        "`DESCONTOS: [FRETE_MINIMO]` e o quadro passa a fechar em zero.",
    },
    porque:
      "A única linha de desconto da planilha sem bloco correspondente no relatório — e o frete " +
      "mínimo é o único desconto do relatório sem linha na planilha. A coincidência é forte e " +
      "continua sendo coincidência até alguém abrir a fórmula.",
  },
  {
    chave: "total_remuneracao_rota_fixo",
    rotulo: "TOTAL REMUNERAÇÃO ROTA",
    quadro: "REMUNERACAO",
    papel: "TOTAL",
    origem: { tipo: "SOMA_DO_QUADRO" },
    porque:
      "O fecho do quadro. O 03.08.20 sustenta este número diretamente: é a soma das verbas " +
      "fixas e administrativas do bloco `FRETE`, que já vêm líquidas de todos os descontos " +
      "listados acima.",
  },

  /* --- Quadro 2: o que a operação rodou ----------------------------------- */
  {
    chave: "custo_variavel_frota_fixa",
    rotulo: "CUSTO VARIÁVEL (FROTA FIXA)",
    quadro: "VARIAVEL",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "variavel_bruto" },
    porque:
      "É a VBZ `05 - Frota Fixa Variável` da Rota — a maior do arquivo em número de linhas, " +
      "uma por nota fiscal. O rótulo da planilha e o nome da verba dizem a mesma coisa, e a " +
      "conciliação do Promax soma a verba na rubrica `Frota Fixa`. O grupo existe pelo " +
      "desconto que atravessa as duas linhas, não por dúvida sobre a verba.",
  },
  {
    chave: "custo_variavel_agregado",
    rotulo: "CUSTO VARIÁVEL (AGREGADO)",
    quadro: "VARIAVEL",
    papel: "PARCELA",
    origem: { tipo: "EM_GRUPO", grupo: "variavel_bruto" },
    porque:
      "É a VBZ `07 - Freteiro`. Agregado e freteiro são o mesmo veículo de terceiro no " +
      "vocabulário do transporte, e o enquadramento não depende disso: o bloco `FRETE` da Rota " +
      "tem exatamente duas verbas variáveis, e a outra se chama literalmente `Frota Fixa " +
      "Variável`. Sobra uma para uma.",
  },
  {
    chave: "desconto_devolucao",
    rotulo: "DESCONTO DE DEVOLUÇÃO",
    quadro: "VARIAVEL",
    papel: "DESCONTO",
    origem: { tipo: "DESCONTOS", descontos: ["DEVOLUCAO"] },
    porque:
      "O `Desconto Devolucao` do 03.08.20, uma vez por canal. Ele é o desconto mais " +
      "atravessado do relatório: a base declarada é 'Todas VBZ's exceto Rem. Var. Equipe Ent. " +
      "e despesas de Outros Custos' — isto é, fixo **e** variável —, e o rótulo diz que a " +
      "subtração saiu da VBZ de Frota Fixa Ativa, que é fixa. A planilha o escreve aqui; a " +
      "alíquota dele fica na linha `%` do quadro de cima. O valor entra uma vez só, e é neste " +
      "quadro, porque é onde a planilha o pôs.",
  },
  {
    chave: "indisponibilidade_variavel",
    rotulo: "INDISPONIBILIDADE",
    quadro: "VARIAVEL",
    papel: "PARCELA",
    origem: INDISPONIBILIDADE_INDEFINIDA("do variável"),
    porque:
      "O mesmo rótulo do quadro de cima, na mesma indefinição de sinal — e agravada: aqui não " +
      "há sequer uma linha de desconto de disponibilidade ao lado para contrastar.",
  },
  {
    chave: "total_remuneracao_rota_variavel",
    rotulo: "TOTAL REMUNERAÇÃO ROTA",
    quadro: "VARIAVEL",
    papel: "TOTAL",
    origem: { tipo: "SOMA_DO_QUADRO" },
    porque:
      "O fecho do quadro, sustentado pela soma das verbas variáveis do bloco `FRETE` — " +
      "líquidas, como todas as do relatório.",
  },

  /* --- Quadro 3: o que não é frete ---------------------------------------- */
  {
    chave: "outros_custos_parcela",
    rotulo: "TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS",
    quadro: "OUTROS_CUSTOS",
    papel: "PARCELA",
    origem: {
      tipo: "VERBAS",
      bloco: "OUTROS_CUSTOS",
      naturezas: ["FIXO", "VARIAVEL", "COMPLEMENTAR", "ADMINISTRATIVO"],
    },
    porque:
      "A correspondência mais direta do painel inteiro, e a única que não precisa de " +
      "argumento: o 03.08.20 tem um bloco literalmente chamado `OUTROS CUSTOS` em cada canal, " +
      "com as suas verbas e o seu `Total Outros Custos`. Nenhuma natureza é filtrada porque o " +
      "bloco é definido pela seção do relatório, não pelo tipo da verba — a VBZ 07, por " +
      "exemplo, aparece nos dois blocos, e é justamente a seção que os separa. " +
      "O rótulo começa com `TOTAL` e ainda assim é parcela: este quadro tem uma parcela só, " +
      "e ela e o total do quadro são o mesmo número — que é exatamente o que o relatório " +
      "faz quando fecha a seção com `Total Outros Custos`.",
  },
  {
    chave: "total_outros_custos",
    rotulo: "TOTAL OUTROS CUSTOS",
    quadro: "OUTROS_CUSTOS",
    papel: "TOTAL",
    origem: { tipo: "SOMA_DO_QUADRO" },
    porque:
      "O fecho do quadro, que o 03.08.20 escreve com o mesmo nome — `Total Outros Custos`. " +
      "Nenhum desconto do relatório sai deste bloco: a base da devolução o exclui por escrito.",
  },
];

/** Os grupos: um número do relatório para várias linhas da planilha. */
export const GRUPOS_DA_PLANILHA: GrupoDaPlanilha[] = [
  {
    chave: "fixo_bruto",
    rotulo: "Custo fixo bruto — antes dos descontos",
    linhas: [
      "custo_fixo_padronizado",
      "custo_fixo_inativos",
      "custo_vans_inativas",
      "custo_fixo_especiais",
      "custo_fixo_vans",
    ],
    origem: { tipo: "VERBAS", bloco: "FRETE", naturezas: ["FIXO", "ADMINISTRATIVO"] },
    brutoDeDescontos: true,
    porque:
      "As cinco linhas são a frota contratada partida por tipo (padrão, especial, van) e por " +
      "atividade (ativa, inativa). O 03.08.20 traz a partição por atividade — há VBZ de ativa e " +
      "de inativa — e não traz a por tipo, que é a que corta as cinco. Como o corte por tipo " +
      "atravessa as duas VBZs, o grupo é das cinco: separar só a inativa deixaria duas linhas " +
      "com um número e três sem, e o número da inativa ainda seria de duas linhas. " +
      "O valor é **bruto**: os descontos que a planilha abate neste quadro, somados de volta, " +
      "porque é assim que ela escreve a parcela e o relatório não.",
  },
  {
    chave: "variavel_bruto",
    rotulo: "Custo variável bruto — antes da devolução",
    linhas: ["custo_variavel_frota_fixa", "custo_variavel_agregado"],
    origem: { tipo: "VERBAS", bloco: "FRETE", naturezas: ["VARIAVEL"] },
    brutoDeDescontos: true,
    porque:
      "Cada linha tem a sua verba, e o grupo não existe por dúvida sobre qual é qual — existe " +
      "porque as duas dividem um desconto. A base da devolução declara alcançar todas as VBZs " +
      "exceto a de remuneração variável de equipe e as de outros custos, e o relatório não diz " +
      "quanto dela saiu de cada verba. Enquanto não disser, o bruto é conjunto: as duas verbas " +
      "mais a devolução que este quadro abate.",
  },
];

const POR_CHAVE = new Map(LINHAS_DA_PLANILHA.map((l) => [l.chave, l]));
const POR_GRUPO = new Map(GRUPOS_DA_PLANILHA.map((g) => [g.chave, g]));

/** A linha de uma chave. `undefined` quando a chave não existe no de-para. */
export function linhaDaPlanilha(chave: string): LinhaDaPlanilha | undefined {
  return POR_CHAVE.get(chave);
}

/* =========================================================================
 * A conferência: o de-para preenchido com um 03.08.20 na mão.
 * ====================================================================== */

/** Como se chegou ao número. Sempre presente quando há número. */
export interface Procedencia {
  /** A rotina de onde saiu — hoje sempre `03.08.20`. */
  fonte: string;
  /** A regra aplicada, em português. */
  regra: string;
  /** As VBZs e os descontos que entraram na conta. */
  entrou: string[];
  /** Quantas linhas do arquivo. */
  registros: number;
}

/** Por que não há número. Sempre presente quando não há. */
export interface Ausencia {
  motivo: string;
  destrava: string;
}

/** O número que a linha compartilha com outras. */
export interface Conjunto {
  chave: string;
  rotulo: string;
  linhas: string[];
  valor: number;
  procedencia: Procedencia;
  porque: string;
  /** As VBZs que este número já consome — o que impede contá-las duas vezes. */
  vbz: number[];
}

export type EstadoDaLinha =
  /** O 03.08.20 sustenta esta linha, e o número está aqui. */
  | "APURADO"
  /** O 03.08.20 a sustenta **junto com outras**, e o número está em `conjunto`. */
  | "EM_CONJUNTO"
  /** Nada a sustenta. `ausencia` diz por quê, e ela cai no resíduo do quadro. */
  | "SEM_LASTRO";

export interface LinhaConferida extends LinhaDaPlanilha {
  estado: EstadoDaLinha;
  /** Dinheiro, exceto na linha de alíquota da devolução. `null` sem lastro. */
  valor: number | null;
  /** `true` na única linha do painel que é percentual e não dinheiro. */
  percentual: boolean;
  procedencia: Procedencia | null;
  ausencia: Ausencia | null;
  conjunto: Conjunto | null;
  /**
   * As VBZs de que este desconto saiu e que **não são deste quadro**.
   *
   * Vazia em quase todas as linhas, e é o achado quando não é: a planilha abate
   * o desconto num quadro e o relatório declara tê-lo tirado de uma verba de
   * outro. A devolução da Rota é o caso — o `Desconto Devolucao` aparece no
   * quadro do variável e o rótulo dele diz `ja subtraido da VBZ Frota Fixa
   * Ativa`, que é fixa. O número fica onde a planilha o pôs; a discordância é
   * dita, não rateada.
   */
  origemForaDoQuadro: string[];
}

export interface QuadroConferido {
  quadro: Quadro;
  titulo: string;
  linhas: LinhaConferida[];
  /**
   * O que o 03.08.20 fecha para o quadro — o valor da linha `TOTAL`.
   *
   * `null` quando o relatório não trouxe nenhuma verba do recorte: o quadro sem
   * fonte é diferente do quadro que valeu zero.
   */
  total: number | null;
  /** A soma do que o de-para preencheu, parcelas menos descontos. */
  somado: number | null;
  /**
   * `total − somado`: o que as linhas sem origem e as verbas sem linha somam.
   *
   * É uma afirmação verificável, e é o que este módulo tem de novo a dizer. O
   * resíduo é, por construção, o valor conjunto de duas coisas: as linhas de
   * {@link semLastro} e as verbas de {@link verbasSemLinha}. Quem abrir o
   * `.xlsb` confere uma subtração em vez de dezoito rótulos.
   *
   * **Resíduo zero não é "nada a ver".** Zero afirma que as linhas de
   * `semLastro` valem zero nesta quinzena — que `INDISPONIBILIDADE` e
   * `DESCONTO COMPLEMENTAR NEGATIVO` estão vazias no painel. Se a planilha as
   * mostrar preenchidas, é o de-para que está errado, e o erro está no bruto:
   * ou a linha entra na soma do quadro, ou o desconto que a alimenta não é o
   * que supomos. É de propósito que a afirmação seja fácil de derrubar.
   */
  residuo: number | null;
  /** Os rótulos entre os quais o resíduo se divide. */
  semLastro: string[];
  /**
   * Verbas que estão no total do quadro e que **nenhuma linha da planilha
   * nomeia**.
   *
   * É a metade que falta de `semLastro`, e a que ninguém pensa em procurar: o
   * resíduo de um quadro pode vir de uma linha da planilha sem origem nossa
   * (`semLastro`) **ou** de uma verba do relatório sem linha na planilha
   * (esta). São dois problemas opostos com o mesmo sintoma, e separá-los é a
   * diferença entre "falta enquadrar" e "falta uma linha no painel".
   */
  verbasSemLinha: { vbz: number; nome: string; valor: number }[];
}

export interface DeParaConferido {
  canal: Canal;
  coluna: ColunaDoPagamento;
  quadros: QuadroConferido[];
  /** O `Total Remuneração` que o próprio relatório fecha. `null` sem a linha. */
  totalDoRelatorio: number | null;
  /** A soma dos três quadros — o que deveria ser o `Total Remuneração`. */
  totalDosQuadros: number | null;
  /** `totalDoRelatorio − totalDosQuadros`. Zero é o painel inteiro fechando. */
  diferenca: number | null;
}

const TITULO_DO_QUADRO: Record<Quadro, string> = {
  REMUNERACAO: "Remuneração — a frota contratada",
  VARIAVEL: "Variável — o que a operação rodou",
  OUTROS_CUSTOS: "Outros custos — o que não é frete",
};

const ORDEM_DOS_QUADROS: Quadro[] = ["REMUNERACAO", "VARIAVEL", "OUTROS_CUSTOS"];

/**
 * O recorte do 03.08.20 que cada quadro fecha.
 *
 * Fica fora do catálogo de linhas de propósito: é a definição do **quadro**, e
 * não de nenhuma linha dele. A linha `TOTAL` de cada quadro consome esta tabela,
 * o que é o mesmo que dizer que ela não inventa o próprio total.
 */
const RECORTE_DO_QUADRO: Record<Quadro, Extract<Origem, { tipo: "VERBAS" }>> = {
  REMUNERACAO: { tipo: "VERBAS", bloco: "FRETE", naturezas: ["FIXO", "ADMINISTRATIVO"] },
  VARIAVEL: { tipo: "VERBAS", bloco: "FRETE", naturezas: ["VARIAVEL", "COMPLEMENTAR"] },
  OUTROS_CUSTOS: {
    tipo: "VERBAS",
    bloco: "OUTROS_CUSTOS",
    naturezas: ["FIXO", "VARIAVEL", "COMPLEMENTAR", "ADMINISTRATIVO"],
  },
};

function somar(valores: number[]): number {
  return centavos(valores.reduce((s, n) => s + n, 0));
}

/**
 * Confere o de-para contra um 03.08.20.
 *
 * Função pura, como toda a aritmética deste pacote: recebe o demonstrativo já
 * lido e devolve o painel preenchido. Quem vai ao banco é `persistencia.ts`, e
 * a separação é o que permite conferir os dezoito rótulos contra material
 * sintético, sem Postgres.
 *
 * O canal é sempre `ROTA` porque é o painel que existe — ver a nota de abertura
 * do módulo. Deixá-lo como parâmetro, ainda que com um valor só, é o que fará o
 * AS entrar sem virar o módulo do avesso no dia em que os rótulos dele forem
 * transcritos.
 */
export function conferirDePara(
  pagamento: Pagamento,
  opcoes: { canal?: Canal; coluna?: ColunaDoPagamento } = {},
): DeParaConferido {
  const canal = opcoes.canal ?? "ROTA";
  const coluna = opcoes.coluna ?? "semImposto";

  const itens = pagamento.itens.filter((i) => i.canal === canal);
  const descontos = pagamento.descontos.filter((d) => d.canal === canal);
  const devolucao = descontos.find((d) => d.tipo === "DEVOLUCAO") ?? null;

  const valorDoItem = (item: ItemDePagamento) => item[coluna];

  const daOrigemDeVerbas = (
    origem: Extract<Origem, { tipo: "VERBAS" }>,
  ): { itens: ItemDePagamento[]; valor: number } => {
    const escolhidos = itens.filter(
      (i) => i.bloco === origem.bloco && origem.naturezas.includes(i.verba.natureza),
    );
    return { itens: escolhidos, valor: somar(escolhidos.map(valorDoItem)) };
  };

  const descontosDoTipo = (tipos: TipoDeDescontoDoPagamento[]) =>
    descontos.filter((d) => tipos.includes(d.tipo));

  /*
    Os descontos que cada quadro abate — os que as linhas de desconto **dele**
    reivindicam, e nenhum outro.

    É a chave do bruto, e ela vem da planilha e não do relatório: o quadro que
    mostra um desconto é o quadro cuja parcela está bruta dele. Somar de volta
    um desconto que a planilha abate noutro quadro fecharia um e estouraria o
    outro pelo mesmo valor — que é exatamente o que acontece com a devolução, e
    é por isso que ela é reportada em `origemForaDoQuadro` em vez de rateada.
  */
  const descontosDoQuadro = (quadro: Quadro): DescontoDoPagamento[] => {
    const tipos = LINHAS_DA_PLANILHA.filter(
      (l) => l.quadro === quadro && l.papel === "DESCONTO" && l.origem.tipo === "DESCONTOS",
    ).flatMap((l) => (l.origem.tipo === "DESCONTOS" ? l.origem.descontos : []));
    return descontosDoTipo(tipos);
  };

  const quadroDoGrupo = (grupo: GrupoDaPlanilha): Quadro | null =>
    POR_CHAVE.get(grupo.linhas[0] ?? "")?.quadro ?? null;

  /* --- os conjuntos: um número do relatório para várias linhas da planilha -- */
  const conjuntos = new Map<string, Conjunto>();
  for (const grupo of GRUPOS_DA_PLANILHA) {
    if (grupo.origem.tipo !== "VERBAS") continue;
    const { itens: escolhidos, valor } = daOrigemDeVerbas(grupo.origem);
    if (escolhidos.length === 0) continue;

    const quadro = quadroDoGrupo(grupo);
    const somados = grupo.brutoDeDescontos && quadro ? descontosDoQuadro(quadro) : [];
    conjuntos.set(grupo.chave, {
      chave: grupo.chave,
      rotulo: grupo.rotulo,
      linhas: grupo.linhas,
      valor: centavos(valor + somar(somados.map((d) => d.valor))),
      procedencia: {
        fonte: "03.08.20",
        regra: somados.length
          ? `Soma da coluna ${coluna} das verbas do bloco ${grupo.origem.bloco}, mais os ` +
            "descontos que este quadro abate — o relatório traz a verba já líquida deles."
          : `Soma da coluna ${coluna} das verbas do bloco ${grupo.origem.bloco}.`,
        entrou: [
          ...escolhidos.map((i) => `VBZ ${i.verba.vbz} — ${i.verba.nome}`),
          ...somados.map((d) => `desconto ${d.tipo}`),
        ],
        registros: escolhidos.length + somados.length,
      },
      porque: grupo.porque,
      vbz: [...new Set(escolhidos.map((i) => i.verba.vbz))].sort((a, b) => a - b),
    });
  }

  const semDemonstrativo = (o_que: string): Ausencia => ({
    motivo: `O 03.08.20 não trouxe ${o_que} no canal ${canal}.`,
    destrava: "O demonstrativo de pagamento da quinzena, importado na competência.",
  });

  /* --- as linhas ------------------------------------------------------------ */
  const conferidas: LinhaConferida[] = LINHAS_DA_PLANILHA.map((linha) => {
    const base = {
      ...linha,
      percentual: linha.origem.tipo === "PERCENTUAL_DA_DEVOLUCAO",
      valor: null as number | null,
      procedencia: null as Procedencia | null,
      ausencia: null as Ausencia | null,
      conjunto: null as Conjunto | null,
      origemForaDoQuadro: [] as string[],
    };

    switch (linha.origem.tipo) {
      case "SEM_ORIGEM":
        return {
          ...base,
          estado: "SEM_LASTRO" as const,
          ausencia: { motivo: linha.origem.motivo, destrava: linha.origem.destrava },
        };

      case "EM_GRUPO": {
        const conjunto = conjuntos.get(linha.origem.grupo) ?? null;
        if (!conjunto) {
          const grupo = POR_GRUPO.get(linha.origem.grupo);
          return {
            ...base,
            estado: "SEM_LASTRO" as const,
            ausencia: semDemonstrativo(
              `nenhuma verba do recorte do grupo "${grupo?.rotulo ?? linha.origem.grupo}"`,
            ),
          };
        }
        return { ...base, estado: "EM_CONJUNTO" as const, conjunto };
      }

      case "VERBAS": {
        const { itens: escolhidos, valor } = daOrigemDeVerbas(linha.origem);
        if (escolhidos.length === 0) {
          return {
            ...base,
            estado: "SEM_LASTRO" as const,
            ausencia: semDemonstrativo(`verbas do bloco ${linha.origem.bloco}`),
          };
        }
        return {
          ...base,
          estado: "APURADO" as const,
          valor,
          procedencia: {
            fonte: "03.08.20",
            regra: `Soma da coluna ${coluna} das verbas do bloco ${linha.origem.bloco}.`,
            entrou: escolhidos.map((i) => `VBZ ${i.verba.vbz} — ${i.verba.nome}`),
            registros: escolhidos.length,
          },
        };
      }

      case "DESCONTOS": {
        const escolhidos = descontosDoTipo(linha.origem.descontos);
        if (escolhidos.length === 0) {
          return {
            ...base,
            estado: "SEM_LASTRO" as const,
            ausencia: semDemonstrativo(
              `o bloco de desconto ${linha.origem.descontos.join(", ")}`,
            ),
          };
        }
        /*
          De qual verba cada desconto saiu, contra o quadro em que a planilha o
          abate. É a única coisa que `vbzDeOrigem` decide, e decide sem mexer em
          conta nenhuma: quando as duas discordam, o número continua onde a
          planilha o pôs e a discordância vira texto.
        */
        const doRecorte = new Set(
          daOrigemDeVerbas(RECORTE_DO_QUADRO[linha.quadro]).itens.map((i) => i.verba.vbz),
        );
        const fora = escolhidos
          .filter((d) => d.vbzDeOrigem.length > 0 && !d.vbzDeOrigem.some((v) => doRecorte.has(v)))
          .flatMap((d) => d.vbzDeOrigem.map((v) => `VBZ ${String(v).padStart(2, "0")}`));

        return {
          ...base,
          estado: "APURADO" as const,
          valor: somar(escolhidos.map((d) => d.valor)),
          origemForaDoQuadro: [...new Set(fora)],
          procedencia: {
            fonte: "03.08.20",
            regra: "Soma dos descontos do bloco, como o relatório os traz — líquidos, sem imposto.",
            entrou: escolhidos.map((d) => d.rotulo),
            registros: escolhidos.length,
          },
        };
      }

      case "PERCENTUAL_DA_DEVOLUCAO": {
        if (!devolucao || devolucao.percentual === null) {
          return {
            ...base,
            estado: "SEM_LASTRO" as const,
            ausencia: semDemonstrativo(
              "o bloco `DESCONTO DEVOLUCAO` com a linha `% Dev. Resp. Transportadora`",
            ),
          };
        }
        return {
          ...base,
          estado: "APURADO" as const,
          valor: devolucao.percentual,
          procedencia: {
            fonte: "03.08.20",
            regra: "A alíquota `% Dev. Resp. Transportadora`, como o relatório a declara.",
            entrou: [devolucao.rotulo],
            registros: 1,
          },
        };
      }

      /*
        O total é resolvido depois das outras, porque ele é conta sobre elas —
        e porque o número dele é do relatório, não da nossa soma.
      */
      case "SOMA_DO_QUADRO":
        return { ...base, estado: "SEM_LASTRO" as const, ausencia: null };
    }
  });

  /* --- os quadros ----------------------------------------------------------- */
  const quadros: QuadroConferido[] = ORDEM_DOS_QUADROS.map((quadro) => {
    const linhas = conferidas.filter((l) => l.quadro === quadro);

    /*
      O total do quadro sai do 03.08.20, não da soma das linhas. É a diferença
      entre conferir e reproduzir: a soma das linhas é a nossa reconstrução, e o
      total é o que o documento assinado diz. Igualá-los por construção apagaria
      o resíduo, que é a única coisa que este módulo tem de novo a dizer.
    */
    const recorte = RECORTE_DO_QUADRO[quadro];
    const { itens: doQuadro, valor } = daOrigemDeVerbas(recorte);
    const total = doQuadro.length > 0 ? valor : null;

    /*
      Só parcela e desconto somam. O título não carrega valor, o total é contra
      quem a soma se confere, e a linha de alíquota da devolução não é dinheiro
      — somá-la poria 1,50 no meio de reais.
    */
    const dasLinhas = somar(
      linhas
        .filter((l) => l.estado === "APURADO" && !l.percentual)
        .filter((l) => l.papel === "PARCELA" || l.papel === "DESCONTO")
        .map((l) => (l.papel === "DESCONTO" ? -(l.valor ?? 0) : (l.valor ?? 0))),
    );
    /* O conjunto entra uma vez, por mais linhas do quadro que o compartilhem. */
    const chavesDeConjunto = [
      ...new Set(linhas.map((l) => l.conjunto?.chave).filter((c): c is string => !!c)),
    ];
    const dosConjuntos = somar(chavesDeConjunto.map((c) => conjuntos.get(c)?.valor ?? 0));
    const somado = centavos(dasLinhas + dosConjuntos);

    /*
      As verbas que nenhuma linha da planilha reivindica.

      Uma verba é reivindicada quando entrou numa linha apurada ou num conjunto
      deste quadro. O que sobra está dentro do total e fora do painel — e é a
      outra metade do resíduo, a que não se descobre olhando a planilha.
    */
    const reivindicadas = new Set<number>();
    for (const chave of chavesDeConjunto) {
      for (const vbz of conjuntos.get(chave)?.vbz ?? []) reivindicadas.add(vbz);
    }
    for (const linha of linhas) {
      if (linha.estado !== "APURADO" || linha.origem.tipo !== "VERBAS") continue;
      for (const item of daOrigemDeVerbas(linha.origem).itens) reivindicadas.add(item.verba.vbz);
    }
    const verbasSemLinha = doQuadro
      .filter((i) => !reivindicadas.has(i.verba.vbz))
      .map((i) => ({ vbz: i.verba.vbz, nome: i.verba.nome, valor: valorDoItem(i) }));

    for (const linha of linhas) {
      if (linha.papel !== "TOTAL") continue;
      if (total === null) {
        linha.ausencia = semDemonstrativo("verbas deste quadro");
        continue;
      }
      linha.estado = "APURADO";
      linha.valor = total;
      linha.procedencia = {
        fonte: "03.08.20",
        regra:
          `Soma da coluna ${coluna} das verbas do bloco ${recorte.bloco}, já líquidas dos ` +
          "descontos que o relatório declara ter subtraído delas.",
        entrou: doQuadro.map((i) => `VBZ ${i.verba.vbz} — ${i.verba.nome}`),
        registros: doQuadro.length,
      };
    }

    return {
      quadro,
      titulo: TITULO_DO_QUADRO[quadro],
      linhas,
      total,
      somado: total === null ? null : somado,
      residuo: total === null ? null : centavos(total - somado),
      semLastro: linhas
        .filter((l) => l.estado === "SEM_LASTRO" && l.papel !== "TITULO" && l.papel !== "TOTAL")
        .map((l) => l.rotulo),
      verbasSemLinha,
    };
  });

  const totalDoRelatorio = pagamento.totais.find((t) => t.canal === canal)?.total ?? null;
  const totaisDosQuadros = quadros.map((q) => q.total).filter((t): t is number => t !== null);
  const totalDosQuadros = totaisDosQuadros.length > 0 ? somar(totaisDosQuadros) : null;

  return {
    canal,
    coluna,
    quadros,
    totalDoRelatorio,
    totalDosQuadros,
    diferenca:
      totalDoRelatorio === null || totalDosQuadros === null
        ? null
        : centavos(totalDoRelatorio - totalDosQuadros),
  };
}
