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
      { nome: "QLP benchmark" },
      { nome: "QLP benchmark quantidade" },
      { nome: "QLP benchmark valor" },
      { nome: "Tipo conjunto" },
      { nome: "Índice de reajuste", parametros: ["Índice de reajuste"] },
    ],
  },
  {
    titulo: "Frota",
    cartoes: [
      { nome: "Carreta", parametros: ["Carreta"] },
      { nome: "Cavalo", parametros: ["Caminhão"] },
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
