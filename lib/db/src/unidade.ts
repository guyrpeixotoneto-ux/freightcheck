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
 * o CNPJ é o que a determina.** Fechamento e Remuneração referenciam o `id`;
 * nenhum dos dois guarda cópia do CNPJ. Quando o CNPJ de uma unidade mudar — e
 * CNPJ de filial muda —, ele muda num lugar só.
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
  /** Os catorze dígitos. A tela mascara com {@link cnpjComMascara}. */
  cnpj: string;
}

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

/** O texto informado não é um CNPJ. Carrega o motivo, que muda o que fazer. */
export class CnpjInvalido extends Error {
  constructor(readonly recusa: RecusaDeCnpj) {
    super(motivoDaRecusa(recusa));
    this.name = "CnpjInvalido";
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
    .select({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
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
    .select({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
    .from(unidadeTable)
    .where(eq(unidadeTable.cnpj, cnpjCanonico))
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
    .select({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj })
    .from(unidadeTable)
    .where(eq(unidadeTable.id, id))
    .limit(1);
  return linha ?? null;
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
 * provocou precisa ver qual é a outra.
 */
export async function cadastrarUnidade(
  db: Database,
  pedido: { nome: string; cnpj: string },
): Promise<UnidadeCanonica> {
  const nome = pedido.nome.trim();
  if (nome === "") {
    throw new UnidadeSemNome();
  }
  const { canonico, recusa } = lerCnpj(pedido.cnpj);
  if (canonico === null) throw new CnpjInvalido(recusa!);

  const jaExiste = await unidadePorCnpj(db, canonico);
  if (jaExiste) throw new CnpjJaCadastrado(canonico, jaExiste);

  const [criada] = await db
    .insert(unidadeTable)
    .values({ nome, cnpj: canonico })
    .returning({ id: unidadeTable.id, nome: unidadeTable.nome, cnpj: unidadeTable.cnpj });
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
