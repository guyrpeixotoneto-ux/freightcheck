import {
  derivarSemantica,
  interpretarRotulo,
  lerSignificado,
  normalizarRotulo,
  periodoEmAberto,
  procurarProximos,
  significadoPara,
  type Proximo,
  type Significado,
} from "@workspace/curation/significado";

/**
 * O que a tela "Confirmar interpretação do campo" decide — sem React.
 *
 * ---------------------------------------------------------------------------
 * Por que isto é um arquivo, e não `useMemo` dentro do componente
 * ---------------------------------------------------------------------------
 * Mesma razão de `cockpit.ts` e `curadoria.ts`: o que esta tela decide é
 * lógica, não pixel — quantas informações faltam, se o botão habilita, qual
 * opção o combobox oferece criar, se o que foi digitado já existe com outro
 * acento. Cada uma dessas respostas é uma frase que a pessoa lê antes de
 * confirmar dinheiro, e nenhuma delas deveria precisar de um DOM montado para
 * ser conferida.
 *
 * ---------------------------------------------------------------------------
 * A derivação não mora aqui
 * ---------------------------------------------------------------------------
 * `derivarSemantica`, `interpretarRotulo` e `significadoPara` vêm de
 * `@workspace/curation/significado` — a **mesma** autoridade que a API usa para
 * gravar. A tela não tem uma cópia da regra e não pode ter: o item 9 do pedido
 * é literalmente sobre isto, e uma segunda tabela de `meaning → unidade` na
 * interface seria a primeira a sair de sincronia, com a agravante de que ela
 * mostraria uma coisa e o banco gravaria outra.
 *
 * O que mora aqui é só **o que a tela faz com a resposta**.
 */

export interface OpcaoDeSignificado {
  code: string;
  label: string;
  forma: string;
  base: string | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
}

export interface OpcaoDeCategoria {
  id: string;
  code: string;
  name: string;
  /** "Custo Variável › Manutenção" — hierarquia sem jargão de taxonomia. */
  caminho: string;
  /**
   * O caminho partido nos dois níveis em que a DRE se lê: "Custo Variável" e
   * "Manutenção". Derivados do mesmo nó — a classificação continua sendo uma
   * só, e estes são as duas alturas de onde se olha para ela.
   */
  sintetico: string;
  analitico: string;
  /** A família semântica: `operacao`, `capital`, `nao_classificado`… */
  classeCode: string | null;
}

/**
/**
 * Uma família da árvore, como o campo de cima da Categoria DRE a mostra.
 *
 * Vem do servidor, e não da lista de categorias: uma família criada agora ainda
 * não tem analítico dentro, e derivá-la das categorias a esconderia justamente
 * no instante em que quem a criou procura por ela.
 *
 * Sem `costClass` e sem `decideClasseDeCusto`. As duas existiam enquanto a
 * árvore declarava a classe de custo e a herdava para baixo — e a tela precisava
 * avisar que pendurar uma categoria em "Custo Fixo" decidia dinheiro. A classe
 * saiu da árvore e virou coluna do atributo, então nenhuma família decide mais
 * de que lado da conta uma coluna cai, e a categoria nova pode nascer dentro de
 * qualquer uma sem classificar nada.
 */
export interface OpcaoDeSintetico {
  id: string;
  code: string;
  nome: string;
  categorias: number;
  isSeed: boolean;
}

/** O que a família já tem dentro, dito na segunda linha da opção. */
export function leituraDoSintetico(sintetico: OpcaoDeSintetico): string {
  if (sintetico.categorias === 0) return "nenhuma categoria ainda";
  if (sintetico.categorias === 1) return "1 categoria";
  return `${sintetico.categorias} categorias`;
}

/**
 * A família da categoria, dita para quem escolhe.
 *
 * Isto **era** a classe de custo — "Custo fixo", "Custo variável", "Não é
 * custo" —, lida da posição na árvore. Deixou de ser: a classe de custo é do
 * atributo, não da natureza, e a árvore passou a agrupar por família semântica.
 * O que a linha de detalhe informa agora é onde a categoria mora, que é o que
 * ajuda a escolher entre duas de nome parecido.
 *
 * `nao_classificado` continua sendo o único que merece uma frase diferente: é o
 * limbo de onde se sai, e dizer o nome dele seria dizer que está tudo certo.
 */
export function familiaDaCategoria(categoria: OpcaoDeCategoria): string {
  if (categoria.classeCode === null) return "Fora da árvore";
  if (categoria.classeCode === "nao_classificado") return "Ainda sem família";
  return categoria.sintetico;
}

/** O que a tela sabe do atributo, reduzido ao que estas funções perguntam. */
export interface CampoEmConfirmacao {
  meaningCode: string | null;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  taxonomyCode: string | null;
  semanticsStatus: string;
  dataType: string;
  /** As vigências do atributo, da mais antiga para a mais recente. */
  history: { snapshotLabel: string; effectiveDate: string }[];
}

/** As escolhas em curso no formulário. */
export interface Escolhas {
  meaningCode: string | null;
  taxonomyCode: string | null;
  /** Só usado quando o significado escolhido deixa o período em aberto. */
  periodicity: string | null;
}

// ---------------------------------------------------------------------------
// 1. Resumo — o que a IA identificou e o que falta confirmar
// ---------------------------------------------------------------------------

const MES = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/**
 * A vigência **do dado**, que é a mais recente em que ele foi importado.
 *
 * O nome importa e a confusão é cara: "vigência" aqui é o mês do arquivo que
 * trouxe estes valores, e não a base de remuneração do valor. Um custo pode ser
 * mensal e vir na vigência de agosto; pode ser anual e vir na mesma vigência de
 * agosto. Misturar as duas é como se lê "R$ 720 mil" onde havia R$ 60 mil, e é
 * por isso que a periodicidade sumiu da tela e a vigência ficou.
 *
 * A data é cortada do texto ISO em vez de passar por `new Date`: `"2026-08-01"`
 * construído como Date nasce à meia-noite UTC e, num navegador a oeste de
 * Greenwich, volta como julho.
 */
export function vigenciaDoDado(
  history: { effectiveDate: string }[],
): string | null {
  const ultima = history.at(-1)?.effectiveDate;
  if (!ultima) return null;
  const [ano, mes] = ultima.split("-");
  const indice = Number(mes) - 1;
  if (!ano || Number.isNaN(indice) || !MES[indice]) return null;
  return `${MES[indice]}/${ano}`;
}

export interface Resumo {
  /** Frases curtas do que já se sabe. */
  identificado: string[];
  /** Frases curtas do que a pessoa ainda precisa responder. */
  faltaConfirmar: string[];
}

/**
 * O quadro de cima: o que já se sabe de um lado, o que falta do outro.
 *
 * A divisão em dois é o ponto. Uma lista única de "campos" faz a pessoa ler
 * tudo para descobrir onde ela entra; separada, o olho encontra a coluna da
 * direita e ela tem duas linhas.
 *
 * "É um valor financeiro" entra em **identificado** mesmo quando o significado
 * exato falta, porque é o que a leitura dos valores de fato sustenta — e é a
 * informação que muda o que a pessoa vai procurar na lista.
 */
export function resumo(
  campo: CampoEmConfirmacao,
  escolhas: Escolhas,
  catalogo: OpcaoDeSignificado[],
): Resumo {
  const identificado: string[] = [];
  const faltaConfirmar: string[] = [];

  const vigencia = vigenciaDoDado(campo.history);
  if (vigencia) identificado.push(`Vigência: ${vigencia}`);

  const lido = significadoAtual(campo, catalogo);
  const escolhido = escolhas.meaningCode
    ? (catalogo.find((o) => o.code === escolhas.meaningCode) ?? null)
    : null;

  if (escolhido) {
    identificado.push(`Representa: ${escolhido.label}`);
  } else if (lido?.isMonetary === true || lido?.unit === "BRL" || lido?.unit?.startsWith("BRL_")) {
    identificado.push("É um valor financeiro");
    faltaConfirmar.push("O que este valor representa?");
  } else if (lido) {
    identificado.push(`Parece: ${lido.label}`);
    faltaConfirmar.push("O que este valor representa?");
  } else {
    faltaConfirmar.push("O que este valor representa?");
  }

  if (escolhas.taxonomyCode) {
    // Não repete o nome: quem escolheu a categoria a está vendo no campo.
    identificado.push("Categoria escolhida");
  } else {
    faltaConfirmar.push("Categoria");
  }

  if (precisaDoPeriodo(escolhas, catalogo) && !escolhas.periodicity) {
    faltaConfirmar.push("De quanto em quanto tempo este valor é pago");
  }

  return { identificado, faltaConfirmar };
}

/**
 * O significado que descreve o campo hoje — escolhido, gravado, ou lido de
 * volta dos campos técnicos.
 *
 * A terceira via é o que faz esta tela não perder curadoria: os atributos
 * confirmados em 10/08/2026 têm `unit`, `periodicity` e `aggregation` e nenhum
 * `meaning_id`, e é `significadoPara` — a autoridade, do lado do servidor e
 * daqui — que os reapresenta como "R$ por mês".
 */
export function significadoAtual(
  campo: CampoEmConfirmacao,
  catalogo: OpcaoDeSignificado[],
): OpcaoDeSignificado | null {
  if (campo.meaningCode) {
    const gravado = catalogo.find((o) => o.code === campo.meaningCode);
    if (gravado) return gravado;
  }
  const lido = significadoPara({
    unit: campo.unit,
    periodicity: campo.periodicity,
    aggregation: campo.aggregation,
    isMonetary: campo.isMonetary,
  });
  if (!lido) return null;
  return catalogo.find((o) => o.code === lido.code) ?? paraOpcao(lido);
}

function paraOpcao(significado: Significado): OpcaoDeSignificado {
  const derivada = derivarSemantica(significado);
  return {
    code: significado.code,
    label: significado.label,
    forma: significado.forma,
    base: significado.base,
    unit: derivada.unit,
    periodicity: derivada.periodicity,
    aggregation: derivada.aggregation,
    isMonetary: derivada.isMonetary,
  };
}

// ---------------------------------------------------------------------------
// 2. O período em aberto — a única terceira pergunta
// ---------------------------------------------------------------------------

/**
 * O significado escolhido é dinheiro que não diz de que período?
 *
 * `R$ por veículo` é o caso, e é real: é montante, é somável na frota, e cai em
 * três totais diferentes da tela de composição conforme seja mensal, anual ou
 * de aquisição. Derivar um por conta própria seria inventar; por isso a tela
 * pergunta, uma vez, em português.
 */
export function precisaDoPeriodo(
  escolhas: Escolhas,
  catalogo: OpcaoDeSignificado[],
): boolean {
  const escolhido = catalogo.find((o) => o.code === escolhas.meaningCode);
  if (!escolhido) return false;
  return periodoEmAberto({
    code: escolhido.code,
    label: escolhido.label,
    forma: escolhido.forma as Significado["forma"],
    base: escolhido.base,
  });
}

// ---------------------------------------------------------------------------
// 3. O estado incompleto, dito em uma frase
// ---------------------------------------------------------------------------

/**
 * "Faltam 2 informações para confirmar: o significado do valor e sua
 * categoria."
 *
 * `null` quando não falta nada — e a ausência da frase é o sinal, não um texto
 * dizendo "está tudo certo", que ocuparia o mesmo espaço para não informar.
 *
 * A justificativa saiu da conta junto com o campo que a pedia: o que falta para
 * confirmar é o que a tela pergunta, e nada mais. Quem assina continua sendo a
 * sessão — o ato nunca dependeu da frase em prosa, e sim de haver responsável.
 */
export function oQueFalta(
  escolhas: Escolhas,
  catalogo: OpcaoDeSignificado[],
): string | null {
  const faltas: string[] = [];
  if (!escolhas.meaningCode) faltas.push("o significado do valor");
  if (!escolhas.taxonomyCode) faltas.push("sua categoria");
  if (precisaDoPeriodo(escolhas, catalogo) && !escolhas.periodicity) {
    faltas.push("de quanto em quanto tempo ele é pago");
  }

  if (faltas.length === 0) return null;
  const lista =
    faltas.length === 1
      ? faltas[0]
      : `${faltas.slice(0, -1).join(", ")} e ${faltas.at(-1)}`;
  return faltas.length === 1
    ? `Falta 1 informação para confirmar: ${lista}.`
    : `Faltam ${faltas.length} informações para confirmar: ${lista}.`;
}

/** O botão habilita quando não falta nada. Uma pergunta, uma resposta. */
export function podeConfirmar(
  escolhas: Escolhas,
  catalogo: OpcaoDeSignificado[],
): boolean {
  return oQueFalta(escolhas, catalogo) === null;
}

// ---------------------------------------------------------------------------
// 4. O combobox pesquisável com criação
// ---------------------------------------------------------------------------

export interface Sugestao<T> {
  /** As opções que casam com o que foi digitado, em ordem de relevância. */
  opcoes: T[];
  /**
   * O texto a criar, quando a criação faz sentido. `null` quando não faz —
   * campo vazio, ou já existe alguma coisa idêntica.
   */
  criar: string | null;
  /**
   * O que já existe e se parece com o digitado, para a tela oferecer **antes**
   * do "Criar". É o caso `combustivel` → `Combustível`: o item existente
   * aparece primeiro, e criar continua possível para quem realmente quis outra
   * coisa.
   */
  parecidos: Proximo<T>[];
}

/**
 * O que o dropdown mostra para um termo digitado.
 *
 * Três decisões que a tela precisa deixar claras:
 *
 * - **Filtra por substring normalizada**, não por prefixo: quem procura "litro"
 *   tem de achar "R$ por litro", e quem digita "combustivel" tem de achar
 *   "Combustível".
 * - **Só oferece criar o que ainda não existe.** Um `+ Criar "Combustível"`
 *   embaixo de uma opção `Combustível` é um convite a duplicar por desatenção.
 * - **Nunca cria sozinho.** Esta função devolve o texto a criar; quem cria é o
 *   clique. É o item 5.7, e ele é estrutural: não existe caminho daqui até uma
 *   escrita.
 */
export function sugerir<T>(
  termo: string,
  itens: T[],
  rotuloDe: (item: T) => string,
  chaveDe?: (item: T) => string | null,
): Sugestao<T> {
  const alvo = normalizarRotulo(termo);
  if (!alvo) return { opcoes: itens, criar: null, parecidos: [] };

  const opcoes = itens.filter((item) => normalizarRotulo(rotuloDe(item)).includes(alvo));
  const parecidos = procurarProximos(termo, itens, rotuloDe, chaveDe);
  const jaExiste = parecidos.some((p) => p.tipo === "IGUAL" || p.tipo === "EQUIVALENTE");

  return {
    // As opções que casam por texto, mais as que só a busca por proximidade
    // achou — é o que põe `Combustível` na lista de quem digitou `combustivel`
    // com um erro de digitação a mais.
    opcoes: [
      ...opcoes,
      ...parecidos.map((p) => p.item).filter((item) => !opcoes.includes(item)),
    ],
    criar: jaExiste ? null : termo.trim(),
    parecidos: parecidos.filter((p) => p.tipo === "PARECIDO"),
  };
}

/**
 * O texto que a linha de criação leva — ou `null` quando não há linha nenhuma.
 *
 * `sugerir` responde por quem **já digitou**: o texto vira a linha de criação, a
 * menos que exista coisa idêntica na lista. Quem *abre* o campo, porém, ainda
 * não digitou nada — e era exatamente aí que a saída sumia. Uma lista vazia com
 * a busca vazia mostrava "Nada encontrado." e mais nada: a porta do cadastro
 * existia, e só a atravessava quem adivinhasse que era preciso digitar um nome
 * inexistente para fazê-la aparecer. O campo que ficava sem saída assim é o da
 * unidade em Realizar Fechamento, e o que se cadastra por ele é o **código** —
 * a identidade que liga a competência ao cadastro de Remuneração.
 *
 * Por isso o segundo caso: **sem nada digitado, criar continua oferecido**, com
 * o texto vazio. O `""` não é uma escrita — continua valendo que criar é um
 * clique e nunca um efeito de digitar; ele é o formulário abrindo em branco,
 * com os campos que ele tem.
 *
 * `aceitaSemTexto` existe porque nem todo campo pode oferecer isso. Onde
 * `aoCriar` grava direto o texto que recebe — o catálogo de significados da
 * Curadoria —, o vazio seria uma recusa do servidor a um clique que a tela não
 * devia ter oferecido. Onde do outro lado há formulário, pode.
 */
export function textoParaCriar(
  criar: string | null,
  termo: string,
  aceitaSemTexto: boolean,
): string | null {
  if (criar !== null) return criar;
  return aceitaSemTexto && termo.trim() === "" ? "" : null;
}

/**
 * O aviso que acompanha o `+ Criar "…"` quando há coisa parecida no cadastro.
 *
 * Não bloqueia: quem digitou "Pedágio" tendo "Pedagiamento" cadastrado pode
 * estar certo. Mas cria o instante em que a pessoa olha antes de clicar, que é
 * o que o item 5 do pedido compra.
 */
export function avisoDeParecido<T>(
  parecidos: Proximo<T>[],
  rotuloDe: (item: T) => string,
): string | null {
  if (parecidos.length === 0) return null;
  const nomes = parecidos.slice(0, 3).map((p) => `"${rotuloDe(p.item)}"`);
  return nomes.length === 1
    ? `Já existe ${nomes[0]} no cadastro. É a mesma coisa?`
    : `Já existem ${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)} no cadastro. É alguma delas?`;
}

/**
 * A leitura do significado escolhido, em português, para a tela mostrar antes
 * de confirmar.
 *
 * É a mesma função da autoridade — a frase e os campos derivados são a mesma
 * decisão, e uma tela que dissesse "não se soma entre veículos" ao lado de um
 * `aggregation` diferente disso seria pior do que tela nenhuma.
 */
export function leituraDe(opcao: OpcaoDeSignificado) {
  return lerSignificado({
    code: opcao.code,
    label: opcao.label,
    forma: opcao.forma as Significado["forma"],
    base: opcao.base,
  });
}

/**
 * O que a autoridade entendeu de um rótulo digitado — para a tela dizer, antes
 * de criar, o que aquilo vai virar.
 *
 * `null` quando ela não entendeu, e aí a tela mostra `COMO_ESCREVER` em vez de
 * um botão que só falharia depois do clique.
 */
export function previaDaCriacao(rotulo: string): {
  significado: Significado;
  natureza: string;
} | null {
  const lido = interpretarRotulo(rotulo);
  if (!lido) return null;
  return { significado: lido, natureza: lerSignificado(lido).natureza };
}
