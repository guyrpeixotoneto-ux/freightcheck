import { asc, eq } from "drizzle-orm";
import type { Database } from "./index";
import { unidadeTable } from "./schema/unidade";

/**
 * A UNIDADE CANÔNICA — a autoridade única sobre "qual unidade é esta".
 *
 * **O problema que esta tabela existe para acabar.** O produto tinha quatro
 * representações independentes da mesma unidade do mundo real, e nenhuma era
 * autoridade sobre as outras:
 *
 * - `fechamento_competencia.unidade_codigo` — texto livre, digitado ao abrir a
 *   competência. Aceitava `443`, `081-0443`, um CNPJ ou `CDD Belém`;
 * - `fechamento_parte(tipo, codigo)` — populada da `0044` **a partir** das
 *   competências, herdando o que quer que estivesse lá;
 * - `remuneracao_unidade.codigo` — texto livre, sem `check`, endereçada por
 *   `scope_hash`;
 * - `snapshot.canonical_scope` — essa sim normalizada, mas é **evidência de uma
 *   importação**, não cadastro.
 *
 * O fechamento então *adivinhava* se dois textos representavam a mesma unidade.
 * Uma pessoa abria a competência como `CDD Belém`, outra cadastrava a planilha
 * com o CNPJ, e o Resumo caía no painel antigo sem que nada estivesse errado em
 * tela nenhuma. Melhorar a heurística de casamento seria tratar o sintoma: o
 * defeito é haver duas identidades para casar.
 *
 * **A regra, em uma linha: a identidade de uma unidade é o `id` desta tabela, e
 * o CNPJ é o que a determina — ou, na falta dele, o código gerencial.**
 * Fechamento e Remuneração referenciam o `id`; nenhum dos dois guarda cópia do
 * CNPJ. Quando o CNPJ de uma unidade mudar — e CNPJ de filial muda —, ele muda
 * num lugar só.
 *
 * **Por que a identidade passou a ter duas formas.** O CNPJ era obrigatório, e
 * a exigência não produzia cadastro melhor onde ele não existe: produzia
 * cadastro nenhum. A unidade que ainda não tem CNPJ próprio, a que fatura sob o
 * de outra e a que a operação chama de `081-0443` continuavam vivendo como
 * texto livre nas quatro representações acima — exatamente o estado que esta
 * tabela veio encerrar —, ou entravam com um documento inventado para vencer a
 * validação, que é pior: identidade errada é o defeito que este arquivo
 * existe para não ter. O que continua valendo, e é o que sempre importou, é
 * que **cada unidade tem uma identidade e cada identidade tem uma unidade**:
 * os dois campos são únicos e ao menos um é obrigatório.
 *
 * **O que esta tabela deliberadamente não é.** Não é registro dos códigos das
 * fontes. `081-0443` continua sendo o que o 03.08.20 escreve, `443` o que a
 * planilha escreve, `36` o da transportadora, e nenhum deles é convertido,
 * reescrito ou associado a um CNPJ por inferência. Esses valores seguem
 * auditáveis onde sempre estiveram; o que muda é que deixam de disputar o papel
 * de identidade global.
 *
 * Mora em `@workspace/db` porque é o único pacote que `@workspace/fechamento` e
 * `@workspace/remuneracao` compartilham — pôr a autoridade dentro de um dos dois
 * faria o outro depender do primeiro para saber quem é a unidade.
 */

/** Os dígitos de um texto, sem pontuação, espaço ou letra. */
function somenteDigitos(bruto: string): string {
  return bruto.replace(/\D/g, "");
}

/**
 * Os dois dígitos verificadores de um CNPJ, pelo algoritmo da Receita.
 *
 * Está aqui, e não numa dependência, por ser doze linhas de aritmética que não
 * mudam nunca — e porque a alternativa era um pacote a mais no bundle para
 * calcular dois módulos 11.
 */
function verificadoresDe(base: string): string {
  const digito = (parcial: string): number => {
    /* Os pesos descem de 9 a 2 e recomeçam — a regra da Receita, não uma escolha. */
    let soma = 0;
    let peso = 2;
    for (let i = parcial.length - 1; i >= 0; i -= 1) {
      soma += Number(parcial[i]) * peso;
      peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = digito(base);
  return `${primeiro}${digito(`${base}${primeiro}`)}`;
}

/**
 * Por que um texto não serve como CNPJ de unidade.
 *
 * Cada variante é uma recusa diferente porque cada uma manda a pessoa fazer
 * outra coisa: quem digitou o nome precisa procurar o CNPJ, quem digitou o CPF
 * precisa do documento da empresa, e quem errou um dígito precisa conferir.
 */
export type RecusaDeCnpj =
  /** Não veio nada — o campo está vazio. */
  | "VAZIO"
  /** Onze dígitos: é CPF, e a unidade é pessoa jurídica. */
  | "E_CPF"
  /** Nem 14 dígitos nem 11 — não é documento nenhum. */
  | "TAMANHO"
  /** Catorze dígitos, todos iguais. `00000000000000` passa no módulo 11. */
  | "REPETIDO"
  /** Catorze dígitos e os verificadores não fecham. */
  | "VERIFICADOR";

export interface CnpjLido {
  /** Os catorze dígitos, quando o texto é um CNPJ. `null` quando não é. */
  canonico: string | null;
  recusa: RecusaDeCnpj | null;
}

/**
 * Lê um CNPJ de unidade, aceitando máscara e devolvendo a forma canônica.
 *
 * **Aceita máscara na entrada e guarda só dígitos.** `12.345.678/0001-99` e
 * `12345678000199` são o mesmo documento, e o Excel entrega ora um ora outro —
 * às vezes como número, perdendo o zero da frente. Guardar a forma digitada
 * faria a mesma unidade existir duas vezes.
 *
 * **Não é `normalizeDocumento`, de `@workspace/ingest`, e a diferença é
 * proposital.** Aquela normaliza *qualquer* código de escopo para comparação —
 * inclusive CPF, inclusive comprimentos que não são documento — porque o
 * trabalho dela é não perder o que o arquivo trouxe. Esta **recusa**: ou o
 * texto é um CNPJ válido, ou não vira identidade de unidade nenhuma. As duas
 * concordam no caso comum (catorze dígitos) e divergem exatamente onde devem —
 * o acervo registra o que veio, o cadastro só aceita o que identifica.
 *
 * **O zero à esquerda não é reconstruído aqui.** `normalizeDocumento` completa
 * com zeros porque o Excel come o primeiro dígito de um número; um cadastro é
 * digitado por uma pessoa, e completar `2345678000199` para `02345678000199`
 * seria inventar um documento que ela não escreveu.
 */
export function lerCnpj(bruto: string): CnpjLido {
  const digitos = somenteDigitos(bruto ?? "");
  const recusar = (recusa: RecusaDeCnpj): CnpjLido => ({ canonico: null, recusa });

  if (digitos === "") return recusar("VAZIO");
  if (digitos.length === 11) return recusar("E_CPF");
  if (digitos.length !== 14) return recusar("TAMANHO");
  /*
    `00000000000000` e os outros treze repetidos passam no módulo 11 e não são
    CNPJ de ninguém. É a mesma guarda que qualquer validador sério tem, e sem
    ela o cadastro aceitaria o preenchimento preguiçoso mais provável de todos.
  */
  if (/^(\d)\1{13}$/.test(digitos)) return recusar("REPETIDO");
  if (verificadoresDe(digitos.slice(0, 12)) !== digitos.slice(12)) {
    return recusar("VERIFICADOR");
  }
  return { canonico: digitos, recusa: null };
}

/** A frase que a tela mostra para cada recusa. */
export function motivoDaRecusa(recusa: RecusaDeCnpj): string {
  switch (recusa) {
    case "VAZIO":
      return "O CNPJ é a identidade da unidade — sem ele não há o que cadastrar.";
    case "E_CPF":
      return "Isto tem onze dígitos, que é um CPF. A unidade é pessoa jurídica e o campo pede o CNPJ dela.";
    case "TAMANHO":
      return "Um CNPJ tem catorze dígitos. Confira se não faltou ou sobrou algum.";
    case "REPETIDO":
      return "Catorze dígitos iguais não são o CNPJ de ninguém.";
    case "VERIFICADOR":
      return "Os dígitos verificadores não fecham — há um dígito trocado em algum lugar.";
  }
}

/* =========================================================================
 * A outra identidade — o código gerencial
 * ====================================================================== */

/**
 * O CÓDIGO GERENCIAL — identidade para a unidade cujo CNPJ ninguém tem.
 *
 * **Por que uma segunda identidade não desfaz a primeira.** A regra deste
 * cadastro nunca foi "toda unidade tem CNPJ": foi *uma* unidade, *uma*
 * resposta. Exigir o documento cumpria a segunda regra à custa da primeira —
 * quem opera uma unidade que ainda não tem CNPJ próprio, que fatura sob o CNPJ
 * de outra ou que o negócio inteiro chama de `081-0443` não cadastrava nada, e
 * a unidade voltava a existir como texto livre nas quatro representações que
 * esta tabela veio substituir. Um documento inventado para vencer a validação
 * seria pior ainda: viraria identidade errada, e identidade errada é o defeito
 * que este arquivo existe para não ter.
 *
 * **O que ele não é.** Não é o código que o export escreve, não é o `codigo` de
 * `remuneracao_unidade`, não é `443` convertido em coisa nenhuma. Aqueles
 * continuam sendo o que a fonte escreveu, auditáveis onde sempre estiveram.
 * Este é o código do *cadastro* — o que alguém afirma ser o nome curto desta
 * unidade —, e a única coisa que ele faz é ser único.
 *
 * **A normalização é a mínima que mantém a unicidade honesta**: sem espaço em
 * volta e em caixa alta. `443 ` e `443` são o mesmo código para quem digita, e
 * deixá-los virar duas linhas devolveria a duplicidade pela porta dos fundos.
 * Não vai além disso — acento, ponto e traço são preservados, porque `081-0443`
 * e `0810443` podem muito bem ser dois códigos diferentes na operação, e é ela
 * quem sabe.
 */
export type RecusaDeCodigoGerencial =
  /** Não veio nada — o campo está vazio. */
  | "VAZIO"
  /**
   * São catorze dígitos: isto é um CNPJ, e o CNPJ tem campo próprio.
   *
   * Aceitá-lo aqui criaria a unidade cujo documento o produto tem e não
   * reconhece — ela não casaria com o acervo, não seria achada pela
   * conciliação, e a pessoa não teria como saber por quê.
   */
  | "E_CNPJ"
  /** Mais de 40 caracteres: é nome ou frase, não código. */
  | "LONGO";

export interface CodigoGerencialLido {
  /** O código normalizado, quando o texto serve. `null` quando não serve. */
  canonico: string | null;
  recusa: RecusaDeCodigoGerencial | null;
}

/** O limite do que ainda é código, e não descrição. O nome é o campo do nome. */
const MAXIMO_DO_CODIGO_GERENCIAL = 40;

/** Lê um código gerencial de unidade, devolvendo a forma canônica. */
export function lerCodigoGerencial(bruto: string): CodigoGerencialLido {
  const texto = (bruto ?? "").trim().toUpperCase();
  const recusar = (recusa: RecusaDeCodigoGerencial): CodigoGerencialLido => ({
    canonico: null,
    recusa,
  });

  if (texto === "") return recusar("VAZIO");
  /*
    Catorze dígitos é CNPJ, com ou sem máscara. Quem digitou o documento no
    campo do código não quis um código: errou de campo, e a frase abaixo diz
    qual é o certo.
  */
  if (somenteDigitos(texto).length === 14) return recusar("E_CNPJ");
  if (texto.length > MAXIMO_DO_CODIGO_GERENCIAL) return recusar("LONGO");
  return { canonico: texto, recusa: null };
}

/** A frase que a tela mostra para cada recusa de código gerencial. */
export function motivoDaRecusaDeCodigo(recusa: RecusaDeCodigoGerencial): string {
  switch (recusa) {
    case "VAZIO":
      return "O código gerencial está vazio — informe o CNPJ da unidade ou um código para ela.";
    case "E_CNPJ":
      return (
        "Isto é um CNPJ, e o CNPJ tem campo próprio — informe-o lá. " +
        "Cadastrado como código, ele não encontraria o CNPJ que os arquivos trazem."
      );
    case "LONGO":
      return `Um código gerencial tem até ${MAXIMO_DO_CODIGO_GERENCIAL} caracteres. O que descreve a unidade é o nome.`;
  }
}

/** `12345678000199` → `12.345.678/0001-99`. Só para exibir; nunca para guardar. */
export function cnpjComMascara(canonico: string): string {
  if (!/^\d{14}$/.test(canonico)) return canonico;
  return (
    `${canonico.slice(0, 2)}.${canonico.slice(2, 5)}.${canonico.slice(5, 8)}` +
    `/${canonico.slice(8, 12)}-${canonico.slice(12)}`
  );
}

/* =========================================================================
 * A persistência — cadastrar, listar, associar
 * ====================================================================== */

/** Uma unidade canônica, como as telas a recebem. */
export interface UnidadeCanonica {
  id: string;
  nome: string;
  /**
   * Os catorze dígitos. A tela mascara com {@link cnpjComMascara}.
   *
   * `null` na unidade cadastrada só por código gerencial — e é `null` mesmo,
   * não string vazia: "não sabemos o CNPJ desta unidade" é uma afirmação, e
   * `""` seria um documento de zero dígitos que casaria com qualquer outro
   * vazio na primeira comparação distraída.
   */
  cnpj: string | null;
  /** O código do cadastro, normalizado. `null` quando ela é identificada pelo CNPJ. */
  codigoGerencial: string | null;
}

/** As colunas que descrevem uma unidade. Uma lista só, para os quatro `select`. */
const COLUNAS_DA_UNIDADE = {
  id: unidadeTable.id,
  nome: unidadeTable.nome,
  cnpj: unidadeTable.cnpj,
  codigoGerencial: unidadeTable.codigoGerencial,
} as const;

/** O CNPJ já está em outra unidade — duas identidades para a mesma coisa. */
export class CnpjJaCadastrado extends Error {
  constructor(readonly cnpj: string, readonly daOutra: UnidadeCanonica) {
    super(
      `O CNPJ ${cnpjComMascara(cnpj)} já é da unidade "${daOutra.nome}". ` +
        "Duas unidades canônicas com o mesmo CNPJ seriam duas respostas para " +
        '"qual unidade é esta", que é o que este cadastro existe para não ter.',
    );
    this.name = "CnpjJaCadastrado";
  }
}

/** O código gerencial já é de outra unidade. Mesma razão do CNPJ duplicado. */
export class CodigoGerencialJaCadastrado extends Error {
  constructor(readonly codigoGerencial: string, readonly daOutra: UnidadeCanonica) {
    super(
      `O código ${codigoGerencial} já é da unidade "${daOutra.nome}". ` +
        "Um código que responde por duas unidades não identifica nenhuma — " +
        "é o mesmo motivo pelo qual o CNPJ é único.",
    );
    this.name = "CodigoGerencialJaCadastrado";
  }
}

/** O texto informado não é um CNPJ. Carrega o motivo, que muda o que fazer. */
export class CnpjInvalido extends Error {
  constructor(readonly recusa: RecusaDeCnpj) {
    super(motivoDaRecusa(recusa));
    this.name = "CnpjInvalido";
  }
}

/** O texto informado não serve como código gerencial. Ver {@link lerCodigoGerencial}. */
export class CodigoGerencialInvalido extends Error {
  constructor(readonly recusa: RecusaDeCodigoGerencial) {
    super(motivoDaRecusaDeCodigo(recusa));
    this.name = "CodigoGerencialInvalido";
  }
}

/**
 * Nem CNPJ nem código gerencial — não há o que cadastrar.
 *
 * É o que sobrou da recusa `CNPJ_VAZIO`, e a diferença entre as duas é o que
 * esta mudança faz: antes a tela dizia "sem CNPJ não há o que cadastrar" para
 * quem tinha um código na mão e nenhum documento, e a instrução não tinha
 * saída. Agora a falta é de **identidade**, e há dois jeitos de supri-la.
 */
export class UnidadeSemIdentidade extends Error {
  constructor() {
    super(
      "Uma unidade precisa de identidade: o CNPJ dela ou um código gerencial. " +
        "Sem um dos dois, o cadastro é uma linha que nada encontra.",
    );
    this.name = "UnidadeSemIdentidade";
  }
}

/**
 * As unidades canônicas cadastradas, em ordem de nome.
 *
 * É desta lista — e de nenhuma outra — que o seletor do Fechamento e o da
 * Remuneração tiram as opções. Não de `/contexts`, que é o acervo; não de
 * `fechamento_parte`, que herdou texto livre; não de `remuneracao_unidade`,
 * cujo `codigo` nunca foi validado. Uma unidade que não está aqui não é
 * selecionável, e é isso que acaba com o "usar o que digitei".
 */
export async function listarUnidadesCanonicas(db: Database): Promise<UnidadeCanonica[]> {
  const linhas = await db
    .select(COLUNAS_DA_UNIDADE)
    .from(unidadeTable)
    .orderBy(asc(unidadeTable.nome));
  return linhas;
}

/** A unidade de um CNPJ canônico. `null` quando ninguém a cadastrou. */
export async function unidadePorCnpj(
  db: Database,
  cnpjCanonico: string,
): Promise<UnidadeCanonica | null> {
  const [linha] = await db
    .select(COLUNAS_DA_UNIDADE)
    .from(unidadeTable)
    .where(eq(unidadeTable.cnpj, cnpjCanonico))
    .limit(1);
  return linha ?? null;
}

/**
 * A unidade de um código gerencial já normalizado. `null` quando não há.
 *
 * O parâmetro é o código **canônico** — o que {@link lerCodigoGerencial}
 * devolve —, e não o texto digitado: comparar o cru contra a coluna
 * normalizada acharia `443` e não acharia ` 443`, que é a duplicidade que a
 * normalização existe para impedir.
 */
export async function unidadePorCodigoGerencial(
  db: Database,
  codigoCanonico: string,
): Promise<UnidadeCanonica | null> {
  const [linha] = await db
    .select(COLUNAS_DA_UNIDADE)
    .from(unidadeTable)
    .where(eq(unidadeTable.codigoGerencial, codigoCanonico))
    .limit(1);
  return linha ?? null;
}

/**
 * A unidade de um `id` canônico. `null` quando ele não existe.
 *
 * Serve às bordas que **recebem** o `id` de uma tela — Fechamento e
 * Remuneração — e precisam ler nome e CNPJ do cadastro em vez de aceitar o que
 * veio no corpo. É a leitura que faz "o cadastro é a autoridade" valer também
 * para quem chama a API direto, e não só para quem passa pela tela.
 */
export async function unidadePorId(
  db: Database,
  id: string,
): Promise<UnidadeCanonica | null> {
  const [linha] = await db
    .select(COLUNAS_DA_UNIDADE)
    .from(unidadeTable)
    .where(eq(unidadeTable.id, id))
    .limit(1);
  return linha ?? null;
}

/**
 * O texto pelo qual esta unidade se escreve — o CNPJ, ou o código na falta dele.
 *
 * Existe porque há lugares que **precisam** de um texto e não de uma
 * identidade: `fechamento_competencia.unidade_codigo` é `NOT NULL` e está na
 * chave única, e a competência aberta a partir de uma unidade canônica tem de
 * levar algum texto para lá. O CNPJ vem primeiro por ser o que os arquivos
 * trazem — é ele que faz as duas pontas se encontrarem quando o export chega.
 */
export function textoDaUnidade(unidade: {
  cnpj: string | null;
  codigoGerencial: string | null;
}): string {
  return unidade.cnpj ?? unidade.codigoGerencial ?? "";
}

/**
 * A identidade afirmada num pedido de cadastro, já validada.
 *
 * Os dois campos são opcionais **e ao menos um é obrigatório** — a única regra
 * que sobrou de "o CNPJ é obrigatório", e a que de fato importava. Informar os
 * dois é legítimo e é o melhor caso: a unidade fica achável pelo documento que
 * o arquivo traz e pelo código com que a operação a chama.
 */
function lerIdentidade(pedido: {
  cnpj?: string;
  codigoGerencial?: string;
}): { cnpj: string | null; codigoGerencial: string | null } {
  const cnpjBruto = (pedido.cnpj ?? "").trim();
  const codigoBruto = (pedido.codigoGerencial ?? "").trim();

  if (cnpjBruto === "" && codigoBruto === "") throw new UnidadeSemIdentidade();

  let cnpj: string | null = null;
  if (cnpjBruto !== "") {
    const lido = lerCnpj(cnpjBruto);
    if (lido.canonico === null) throw new CnpjInvalido(lido.recusa!);
    cnpj = lido.canonico;
  }

  let codigoGerencial: string | null = null;
  if (codigoBruto !== "") {
    const lido = lerCodigoGerencial(codigoBruto);
    if (lido.canonico === null) throw new CodigoGerencialInvalido(lido.recusa!);
    codigoGerencial = lido.canonico;
  }

  return { cnpj, codigoGerencial };
}

/**
 * Cadastra uma unidade canônica — o ato que cria identidade neste produto.
 *
 * **É o único caminho que cria linha em `unidade`, e isso é o desenho.** Nenhuma
 * migration popula a tabela; nenhuma importação cria unidade sozinha. Um arquivo
 * que declara um CNPJ é *evidência* — vira sugestão na tela, com o campo
 * preenchido —, e a confirmação é esta função. A diferença entre "este arquivo
 * declarou este CNPJ" e "esta unidade existe no FreightCheck" é quem responde
 * pela segunda afirmação, e a resposta é: gente.
 *
 * **Recusa duplicidade em vez de reaproveitar.** Um `ON CONFLICT DO NOTHING`
 * devolveria silenciosamente a unidade de outro nome para quem pensava estar
 * criando a sua. Dois nomes para o mesmo CNPJ é conflito de cadastro, e quem o
 * provocou precisa ver qual é a outra. Vale igual para o código gerencial: ele
 * é identidade, e identidade repetida não identifica.
 *
 * **O CNPJ deixou de ser obrigatório e não deixou de ser preferido.** Quem tem
 * o documento informa o documento — é ele que os arquivos trazem, e é por ele
 * que a unidade digitada e a importada se encontram. O código gerencial atende
 * quem não o tem, e o que ele evita não é digitação: é a unidade que não se
 * cadastrava de jeito nenhum.
 */
export async function cadastrarUnidade(
  db: Database,
  pedido: { nome: string; cnpj?: string; codigoGerencial?: string },
): Promise<UnidadeCanonica> {
  const nome = pedido.nome.trim();
  if (nome === "") {
    throw new UnidadeSemNome();
  }
  const { cnpj, codigoGerencial } = lerIdentidade(pedido);

  if (cnpj !== null) {
    const jaExiste = await unidadePorCnpj(db, cnpj);
    if (jaExiste) throw new CnpjJaCadastrado(cnpj, jaExiste);
  }
  if (codigoGerencial !== null) {
    const jaExiste = await unidadePorCodigoGerencial(db, codigoGerencial);
    if (jaExiste) throw new CodigoGerencialJaCadastrado(codigoGerencial, jaExiste);
  }

  const [criada] = await db
    .insert(unidadeTable)
    .values({ nome, cnpj, codigoGerencial })
    .returning(COLUNAS_DA_UNIDADE);
  return criada!;
}

/** O nome é descrição e é obrigatório: uma unidade sem rótulo não se escolhe. */
export class UnidadeSemNome extends Error {
  constructor() {
    super(
      "O nome da unidade é o que a lista mostra e o que quem opera procura — sem ele " +
        "a unidade existe e ninguém a acha.",
    );
    this.name = "UnidadeSemNome";
  }
}

/** O `id` não corresponde a nenhuma unidade cadastrada — não há o que editar. */
export class UnidadeNaoEncontrada extends Error {
  constructor(readonly id: string) {
    super(`Nenhuma unidade cadastrada com o id ${id}.`);
    this.name = "UnidadeNaoEncontrada";
  }
}

/**
 * Edita o nome e a identidade de uma unidade já cadastrada.
 *
 * **Mesmas regras do cadastro, porque é a mesma afirmação — "qual unidade é
 * esta" —, só que corrigindo uma já feita.** Nome vazio continua recusado, o
 * CNPJ continua validado por {@link lerCnpj}, e os dois continuam tendo que ser
 * únicos: `CnpjJaCadastrado` e `CodigoGerencialJaCadastrado` disparam também
 * aqui, exceto quando o valor informado é o da própria unidade sendo editada —
 * reenviar o que já está lá não é conflito com si mesma.
 *
 * **Esvaziar um dos dois é legítimo, esvaziar os dois não.** Quem cadastrou por
 * código e descobriu o CNPJ preenche o CNPJ e pode apagar o código; o inverso
 * também vale. O que não passa é a unidade ficar sem identidade nenhuma —
 * `UnidadeSemIdentidade` —, porque aí ela deixa de ser encontrável sem que nada
 * que a referencia tenha mudado.
 *
 * Não reatribui `id`: é ele que Fechamento e Remuneração referenciam, e
 * trocá-lo apagaria a identidade que este cadastro existe para preservar.
 */
export async function editarUnidade(
  db: Database,
  id: string,
  pedido: { nome: string; cnpj?: string; codigoGerencial?: string },
): Promise<UnidadeCanonica> {
  const existente = await unidadePorId(db, id);
  if (existente === null) throw new UnidadeNaoEncontrada(id);

  const nome = pedido.nome.trim();
  if (nome === "") {
    throw new UnidadeSemNome();
  }
  const { cnpj, codigoGerencial } = lerIdentidade(pedido);

  if (cnpj !== null) {
    const deOutra = await unidadePorCnpj(db, cnpj);
    if (deOutra && deOutra.id !== id) throw new CnpjJaCadastrado(cnpj, deOutra);
  }
  if (codigoGerencial !== null) {
    const deOutra = await unidadePorCodigoGerencial(db, codigoGerencial);
    if (deOutra && deOutra.id !== id) {
      throw new CodigoGerencialJaCadastrado(codigoGerencial, deOutra);
    }
  }

  const [editada] = await db
    .update(unidadeTable)
    .set({ nome, cnpj, codigoGerencial })
    .where(eq(unidadeTable.id, id))
    .returning(COLUNAS_DA_UNIDADE);
  return editada!;
}
