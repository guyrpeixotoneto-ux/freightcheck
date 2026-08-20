import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { remuneracaoUnidadeTable } from "@workspace/db/schema";

/**
 * A UNIDADE REGISTRADA À MÃO — a que existe antes de o export existir.
 *
 * **A regra que este arquivo dobra, e por quê.** O módulo inteiro nasce do
 * acervo: uma unidade é um par `(scope_hash, canal)` que apareceu num
 * `snapshot`, e `contextosDoModulo` dizia, por extenso, "canal novo em unidade
 * conhecida é declaração; unidade nova é importação". A segunda metade dessa
 * frase está certa na Auditoria, onde a pergunta é o que os arquivos
 * sustentam — e é uma parede no Fechamento, onde a pergunta é outra: quem
 * fecha a quinzena fecha trinta unidades, a aba de Excel chega antes do export
 * com frequência, e a unidade que só tem aba não tinha onde ser digitada.
 *
 * O que este arquivo acrescenta é **identidade**, e só isso: nome, código,
 * tipo de operação e a quinzena em que se começou a preencher. Nenhum número
 * mora aqui. Os números continuam em `remuneracao_planilha`, continuam saindo
 * marcados como `INFORMADO` com autor e data, e continuam sem apagar nada que
 * o acervo meça — porque, numa unidade destas, o acervo não mede nada mesmo.
 *
 * **O `scope_hash` chega calculado, e não é calculado aqui.** Quem o calcula é
 * a borda, com o mesmo `hashScopeSet` da importação (`sha256` dos descritores
 * `TIPO:código` ordenados). É uma regra da importação, e reimplementá-la neste
 * módulo criaria uma segunda versão da chave de negócio — o dia em que as duas
 * discordassem seria o dia em que a planilha digitada sumiria da unidade, sem
 * erro nenhum na tela. Aqui ela só é guardada e lida.
 *
 * É esse hash que faz as duas se encontrarem: registrada com o código que o
 * export também carrega, a unidade digitada recebe **o mesmo** identificador
 * que o import produzirá, e no dia em que o arquivo chegar ele cai na unidade
 * que já estava lá — com a planilha no lugar certo, sem uma segunda CAMAÇARI
 * ao lado da primeira.
 *
 * **O código é opcional, e o que ele compra é exatamente esse encontro.** Quem
 * tem a aba de Excel na mão nem sempre tem o CNPJ da unidade, e exigi-lo era
 * mandar a pessoa procurar num export que ainda não chegou para poder digitar
 * a planilha que já chegou — a mesma parede, um passo adiante. Sem código, o
 * identificador sai do **nome**: a unidade existe, aparece na lista, tem
 * planilha e tem vigência. O que ela não tem é o reencontro automático — ver
 * {@link identificadorDaUnidade}, que é onde essa escolha mora e onde o preço
 * dela está escrito por extenso.
 */

/** Uma unidade que alguém registrou, como ela volta do banco. */
export interface UnidadeRegistrada {
  scopeHash: string;
  scopeType: string;
  codigo: string;
  nome: string;
  /** `null` é a série sem canal — a coluna guarda `''`, como a da planilha. */
  canal: string | null;
  /** A quinzena declarada no registro, para o seletor não abrir vazio. */
  vigenciaInicial: string;
  autorNome: string | null;
  criadaEm: string;
}

/**
 * O par (escopo, canal) já existe registrado.
 *
 * Recusa, e não sobrescrita: o segundo registro traria outro nome ou outra
 * quinzena inicial para a mesma unidade, e escolher em silêncio qual dos dois
 * vale é escolher pelo operador. Quem quer trocar o nome está fazendo outra
 * coisa, e essa outra coisa ainda não existe nesta tela.
 */
export class UnidadeJaRegistrada extends Error {
  constructor(nome: string, canal: string | null) {
    super(
      `${nome}${canal === null ? "" : ` · ${canal}`} já está registrada. Ela aparece na ` +
        "lista de unidades, e é por lá que a planilha dela é preenchida.",
    );
    this.name = "UnidadeJaRegistrada";
  }
}

/** Recusa nomeada do que a borda não conseguiu ler como unidade. */
export class UnidadeInvalida extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "UnidadeInvalida";
  }
}

/**
 * As unidades registradas à mão.
 *
 * Todas elas, sem filtro por acervo: quem cruza com o que foi importado é
 * `contextosDoModulo`, que tem as duas listas na mão e sabe qual vence.
 */
export async function unidadesRegistradas(db: Database): Promise<UnidadeRegistrada[]> {
  const linhas = await db
    .select()
    .from(remuneracaoUnidadeTable)
    .orderBy(remuneracaoUnidadeTable.nome, remuneracaoUnidadeTable.canal);

  return linhas.map((l) => ({
    scopeHash: l.scopeHash,
    scopeType: l.scopeType,
    codigo: l.codigo,
    nome: l.nome,
    canal: l.canal === "" ? null : l.canal,
    vigenciaInicial: String(l.vigenciaInicial),
    autorNome: l.autorNome,
    criadaEm:
      l.criadaEm instanceof Date ? l.criadaEm.toISOString() : String(l.criadaEm),
  }));
}

/**
 * O nome como a tabela o guarda — `trim` e caixa alta.
 *
 * Era uma linha dentro de `registrarUnidade`, e sai dela porque a borda passou
 * a precisar do **mesmo** texto: quando não há código, é sobre o nome
 * normalizado que o `scope_hash` é somado. Duas normalizações — uma aqui, uma
 * lá — produziriam um hash somado sobre `camaçari ` e uma linha gravada como
 * `CAMAÇARI`, e o segundo registro do mesmo nome não seria reconhecido como
 * repetido.
 */
export function normalizarNome(bruto: string): string {
  return bruto.trim().toUpperCase();
}

/**
 * O TEXTO SOBRE O QUAL O `scope_hash` DA UNIDADE É SOMADO — e o que se perde
 * quando ele não é o código.
 *
 * **Com código, é o código**, como o export o escreve. É o caso que faz este
 * caminho valer a pena: o identificador sai igual ao que a importação vai
 * produzir, e o arquivo, quando chegar, cai dentro da unidade que já estava
 * ali.
 *
 * **Sem código, é o nome normalizado.** Precisa ser alguma coisa, e precisa ser
 * alguma coisa **estável e distinta**: `UNIDADE:` puro faria todas as unidades
 * sem código compartilharem um identificador só, e a segunda seria recusada
 * como repetida da primeira — CAMAÇARI barrando a entrada de BELÉM. O nome já
 * é o que distingue uma unidade da outra na lista, já é normalizado antes de
 * ser gravado, e é a única coisa que quem cadastra sempre tem.
 *
 * **E o preço, dito por extenso, porque a tela precisa dizê-lo.** O hash do
 * nome não é o hash que a importação calcula — ela soma sobre o código da
 * coluna `Unidade - CNPJ`. Então a unidade registrada sem código **não** recebe
 * o export quando ele chegar: o arquivo abre a unidade dele ao lado desta, cada
 * uma com metade da história, e juntá-las é trabalho manual. Não é um defeito
 * escondido — é o que se troca por não ter de conhecer o CNPJ hoje —, e é por
 * isso que o campo continua na tela, continua sendo o caminho recomendado, e a
 * frase embaixo dele muda conforme ele esteja preenchido ou não.
 */
export function identificadorDaUnidade(pedido: { codigo: string; nome: string }): string {
  const codigo = normalizarCodigo(pedido.codigo);
  return codigo === "" ? normalizarNome(pedido.nome) : codigo;
}

/**
 * Registra uma unidade. O `scopeHash` vem pronto — ver o cabeçalho.
 *
 * **O nome é normalizado; o código, não.** `camaçari ` e `CAMAÇARI` são a mesma
 * unidade, e guardar as duas formas produziria duas linhas que a tela mostraria
 * como unidades diferentes — o nome é rótulo, e rótulo se arruma. O código já
 * chegou aqui na forma exata de que o hash foi somado, e mexer nele agora o
 * faria descrever um identificador que não é o que a planilha vai usar.
 */
export async function registrarUnidade(
  db: Database,
  pedido: {
    scopeHash: string;
    scopeType: string;
    codigo: string;
    nome: string;
    canal: string | null;
    vigenciaInicial: string;
    autor: { id: string | null; nome: string | null };
  },
): Promise<UnidadeRegistrada> {
  const nome = normalizarNome(pedido.nome);
  const canal = pedido.canal === null ? "" : pedido.canal.trim().toUpperCase();

  if (nome === "") {
    throw new UnidadeInvalida(
      "A unidade precisa de um nome — é o que a lista mostra, e o que quem opera procura.",
    );
  }

  const [ja] = await db
    .select({ id: remuneracaoUnidadeTable.id })
    .from(remuneracaoUnidadeTable)
    .where(
      and(
        eq(remuneracaoUnidadeTable.scopeHash, pedido.scopeHash),
        eq(remuneracaoUnidadeTable.canal, canal),
      ),
    );
  if (ja) throw new UnidadeJaRegistrada(nome, canal === "" ? null : canal);

  const [criada] = await db
    .insert(remuneracaoUnidadeTable)
    .values({
      scopeHash: pedido.scopeHash,
      scopeType: pedido.scopeType,
      codigo: pedido.codigo,
      nome,
      canal,
      vigenciaInicial: pedido.vigenciaInicial,
      autorId: pedido.autor.id,
      autorNome: pedido.autor.nome,
    })
    .returning();

  if (!criada) {
    /*
      Só chega aqui se a corrida entre a checagem acima e o `insert` tiver sido
      perdida — o índice único é quem de fato garante o par. A recusa é a mesma
      dos dois caminhos, para quem está na tela não ter de saber disso.
    */
    throw new UnidadeJaRegistrada(nome, canal === "" ? null : canal);
  }

  return {
    scopeHash: criada.scopeHash,
    scopeType: criada.scopeType,
    codigo: criada.codigo,
    nome: criada.nome,
    canal: criada.canal === "" ? null : criada.canal,
    vigenciaInicial: String(criada.vigenciaInicial),
    autorNome: criada.autorNome,
    criadaEm:
      criada.criadaEm instanceof Date ? criada.criadaEm.toISOString() : String(criada.criadaEm),
  };
}

/**
 * O descritor de escopo de uma unidade — `UNIDADE:12345678000199`.
 *
 * A forma é a que a importação monta antes de somar o hash (ver
 * `hashScopeSet`), e ela mora aqui para que a borda não a escreva à mão em
 * cada chamada. O hash em si continua sendo somado lá: este módulo não conhece
 * `@workspace/ingest`, e passar a conhecê-lo por três linhas de sha256 traria
 * o pipeline inteiro para dentro de um pacote que hoje só lê.
 */
export function descritorDeEscopo(scopeType: string, codigo: string): string {
  return `${scopeType}:${codigo}`;
}

/**
 * O código como o `scope_hash` o usa — só `trim`, e **de propósito**.
 *
 * A vontade aqui é tirar a máscara: quem digita escreve `12.345.678/0001-99`,
 * e parece óbvio guardar `12345678000199`. Seria errado. O hash da importação
 * não é somado sobre o código canônico — é sobre o código **como veio na
 * célula**, com `.trim()` e nada mais (ver `resolveScopes` em
 * `@workspace/ingest`, e o comentário que diz "descriptors guarda o código como
 * veio, que é o que `scope_hash` sempre usou"). A identidade canônica normaliza
 * noutro lugar, para outra coisa.
 *
 * Então limpar a máscara aqui produziria o hash de um código que o arquivo não
 * tem, e as duas unidades — a digitada e a importada — nunca se encontrariam:
 * exatamente o defeito que este caminho existe para evitar, cometido pelo lado
 * de dentro.
 *
 * **A consequência, dita por extenso, porque a tela precisa dizê-la:** o
 * encontro depende de o código ser digitado como está na coluna `Unidade -
 * CNPJ` do export. Com máscara lá, com máscara aqui. É uma exigência real, e é
 * menor do que a alternativa — um hash que se sente livre para adivinhar qual
 * das formas o arquivo vai trazer.
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim();
}

/** As vigências que uma unidade registrada oferece, com a inicial garantida. */
export function vigenciasDaUnidade(
  vigenciaInicial: string,
  daPlanilha: readonly string[],
): string[] {
  return [...new Set([vigenciaInicial, ...daPlanilha])].sort();
}

/** Quantas unidades registradas existem — para o diagnóstico e os testes. */
export async function contarUnidadesRegistradas(db: Database): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM remuneracao_unidade`,
  );
  return rows[0]?.total ?? 0;
}
