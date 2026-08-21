import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { remuneracaoPlanilhaTable, remuneracaoUnidadeTable } from "@workspace/db/schema";

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
 * Informar o código de um escopo que não é de unidade cadastrada à mão.
 *
 * 404, e não 400: o pedido está bem formado — o que não existe é a unidade que
 * ele nomeia. Acontece quando o export chega entre a tela abrir e o clique, e
 * a linha registrada deixa de responder pelo escopo; a frase manda recarregar
 * em vez de acusar quem clicou.
 */
export class UnidadeNaoRegistrada extends Error {
  constructor() {
    super(
      "Esta unidade não está entre as cadastradas à mão. Se o export dela chegou nesse " +
        "meio-tempo, o código já é o do arquivo — recarregue a lista.",
    );
    this.name = "UnidadeNaoRegistrada";
  }
}

/**
 * O código não pode ser informado **nesta** unidade — e a frase diz por quê.
 *
 * Uma classe para três motivos, porque os três são o mesmo número (409) e o
 * mesmo tipo de fato: o pedido está bom, e é o estado que já responde. Separar
 * em três classes daria três traduções idênticas na tabela de recusas e uma
 * chance a mais de a próxima nascer sem tradução nenhuma.
 */
export class CodigoRecusado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "CodigoRecusado";
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

  return linhas.map(comoElaVolta);
}

/**
 * As unidades cadastradas à mão **de um escopo** — zero, uma, ou uma por canal.
 *
 * Uma pergunta por escopo, e não por (escopo, canal), porque o código é da
 * unidade e não da operação: o CNPJ da coluna do export é o mesmo para a
 * EMPURRADA e para a ROTA da mesma CAMAÇARI, e informá-lo numa e não na outra
 * partiria em duas uma unidade que o arquivo vai trazer inteira.
 */
export async function unidadesRegistradasDoEscopo(
  db: Database,
  scopeHash: string,
): Promise<UnidadeRegistrada[]> {
  const linhas = await db
    .select()
    .from(remuneracaoUnidadeTable)
    .where(eq(remuneracaoUnidadeTable.scopeHash, scopeHash))
    .orderBy(remuneracaoUnidadeTable.canal);

  return linhas.map(comoElaVolta);
}

/** A linha do banco como o módulo a devolve — a tradução do `''` inclusive. */
function comoElaVolta(l: typeof remuneracaoUnidadeTable.$inferSelect): UnidadeRegistrada {
  return {
    scopeHash: l.scopeHash,
    scopeType: l.scopeType,
    codigo: l.codigo,
    nome: l.nome,
    canal: l.canal === "" ? null : l.canal,
    vigenciaInicial: String(l.vigenciaInicial),
    autorNome: l.autorNome,
    criadaEm: l.criadaEm instanceof Date ? l.criadaEm.toISOString() : String(l.criadaEm),
  };
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
    /**
     * A unidade canônica que este cadastro descreve.
     *
     * **É a identidade, e o `codigo` acima deixou de ser.** Quem cadastra pela
     * tela escolhe a unidade em Administração → Unidades e o `id` dela chega
     * aqui; o `codigo` continua sendo o texto do export, porque é sobre ele que
     * o `scope_hash` é somado e é ele que faz o arquivo cair nesta unidade
     * quando chegar. As duas responsabilidades passaram a morar em campos
     * diferentes: identidade num, proveniência no outro.
     *
     * `null` no caminho legado e nos cadastros anteriores à `0049`.
     */
    unidadeId?: string | null;
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
      unidadeId: pedido.unidadeId ?? null,
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

  return comoElaVolta(criada);
}

/**
 * INFORMAR O CÓDIGO DEPOIS — a unidade cadastrada sem CNPJ passa a ter o dele,
 * e a planilha digitada vai junto.
 *
 * **Por que este ato existe.** Sem código, o identificador da unidade sai do
 * nome (ver {@link identificadorDaUnidade}), e o preço é o reencontro: o export
 * abre a unidade dele ao lado desta. Enquanto informar o código fosse possível
 * só no cadastro, esse preço era **definitivo** — quem descobrisse o CNPJ no dia
 * seguinte não tinha o que fazer com ele, e a planilha já digitada ficava presa
 * ao escopo do nome para sempre. É a mesma parede do começo desta história, com
 * a mão trocada.
 *
 * **O que ele move, e por que a planilha vai junto.** Trocar o `scope_hash` da
 * linha de unidade sem levar `remuneracao_planilha` seria a pior das saídas: a
 * unidade reapareceria no lugar certo e **vazia**, e o que alguém digitou
 * continuaria pendurado num escopo que nenhuma tela mostra mais. Os dois se
 * movem na mesma transação, ou nenhum se move.
 *
 * **O que ele recusa, e por que recusar é o certo aqui.** Um destino já ocupado
 * — por outra unidade cadastrada à mão no mesmo canal, ou por uma planilha que
 * já tem a mesma célula na mesma vigência — é um caso em que juntar significa
 * escolher qual dos dois valores vale. Isso é decisão de quem opera, e tomá-la
 * em silêncio apagaria um número que alguém digitou, com autor e data, sem
 * nada em tela. A recusa nomeia o que está no caminho.
 *
 * **O acervo no destino não é obstáculo — é o objetivo.** Se o export já
 * chegou, o `snapshot` está lá e é justamente onde esta unidade quer cair:
 * depois do movimento, `contextosEProcedencia` deixa o acervo vencer e a
 * planilha, agora no escopo do arquivo, aparece no cadastro dele. Era o que
 * teria acontecido sozinho se o código estivesse lá desde o começo.
 *
 * O `escopoNovo` chega somado da borda, pela razão do cabeçalho deste arquivo:
 * a regra do hash é da importação, e uma segunda implementação dela aqui seria
 * uma segunda chave de negócio.
 */
export async function informarCodigoDaUnidade(
  db: Database,
  pedido: { escopoAtual: string; escopoNovo: string; codigo: string },
): Promise<UnidadeRegistrada[]> {
  return db.transaction(async (tx) => {
    const linhas = await tx
      .select()
      .from(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.scopeHash, pedido.escopoAtual))
      .orderBy(remuneracaoUnidadeTable.canal);

    if (linhas.length === 0) throw new UnidadeNaoRegistrada();

    /*
      Trocar um código que já existe é outro ato, e um ato perigoso: aquele
      código pode ser o que faz esta unidade encontrar um arquivo que já chegou,
      e reescrevê-lo a moveria para longe dele em silêncio. Quem digitou o
      código errado tem uma saída pior e honesta — a de sempre neste módulo —,
      e quem quer trocá-lo está pedindo uma função que ainda não existe.
    */
    const jaTem = linhas.find((l) => l.codigo.trim() !== "");
    if (jaTem) {
      throw new CodigoRecusado(
        `${jaTem.nome} já foi cadastrada com o código ${jaTem.codigo}. Este ato existe para ` +
          "a unidade que ficou sem código nenhum — trocar um código que já vale é outra coisa.",
      );
    }

    // O código dá no mesmo escopo: não há o que mover, e dizer "pronto" é a
    // resposta certa para quem clicou duas vezes.
    if (pedido.escopoNovo === pedido.escopoAtual) return linhas.map(comoElaVolta);

    const canais = linhas.map((l) => l.canal);
    const ocupado = await tx
      .select({ nome: remuneracaoUnidadeTable.nome, canal: remuneracaoUnidadeTable.canal })
      .from(remuneracaoUnidadeTable)
      .where(
        and(
          eq(remuneracaoUnidadeTable.scopeHash, pedido.escopoNovo),
          inArray(remuneracaoUnidadeTable.canal, canais),
        ),
      );
    if (ocupado[0]) {
      throw new CodigoRecusado(
        `Já existe uma unidade cadastrada com o código ${pedido.codigo} em ` +
          `${ocupado[0].canal === "" ? "operação sem tipo" : ocupado[0].canal} — ` +
          `${ocupado[0].nome}. Duas unidades não podem dividir o mesmo código no mesmo tipo ` +
          "de operação: uma delas é a que sobra, e escolher qual não é decisão desta tela.",
      );
    }

    /*
      A colisão de planilha é por célula — (canal, vigência, chave), que é a
      unicidade da tabela. Mover por cima faria o número de lá sumir sem
      aparecer em lugar nenhum; a recusa diz em quais vigências o encontro
      aconteceria, que é o que quem opera precisa para resolver à mão.
    */
    const { rows: colisoes } = await tx.execute<{ canal: string; vigencia: string }>(sql`
      SELECT DISTINCT destino.canal AS canal, destino.effective_date::text AS vigencia
        FROM remuneracao_planilha origem
        JOIN remuneracao_planilha destino
          ON destino.scope_hash = ${pedido.escopoNovo}
         AND destino.canal = origem.canal
         AND destino.effective_date = origem.effective_date
         AND destino.chave = origem.chave
       WHERE origem.scope_hash = ${pedido.escopoAtual}
       ORDER BY destino.canal, vigencia
    `);
    if (colisoes.length > 0) {
      const onde = colisoes
        .map((c) => `${c.canal === "" ? "sem tipo" : c.canal} · ${c.vigencia}`)
        .join(", ");
      throw new CodigoRecusado(
        `A unidade do código ${pedido.codigo} já tem planilha informada nas mesmas linhas ` +
          `(${onde}). Juntar as duas apagaria um dos números, e nenhum deles é descartável — ` +
          "os dois foram digitados por alguém, com autor e data.",
      );
    }

    await tx
      .update(remuneracaoPlanilhaTable)
      .set({ scopeHash: pedido.escopoNovo })
      .where(eq(remuneracaoPlanilhaTable.scopeHash, pedido.escopoAtual));

    const movidas = await tx
      .update(remuneracaoUnidadeTable)
      .set({ scopeHash: pedido.escopoNovo, codigo: pedido.codigo })
      .where(eq(remuneracaoUnidadeTable.scopeHash, pedido.escopoAtual))
      .returning();

    return movidas.map(comoElaVolta);
  });
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

/**
 * Recusa: a unidade cadastrada à mão ainda sustenta planilha, e por isso não sai
 * por um clique.
 *
 * Existe separada de {@link CodigoRecusado} porque é outra pergunta — lá o
 * pedido é sobre o código, aqui é sobre apagar — e porque a frase precisa dizer
 * o que está no caminho **e** qual é o caminho: as quinzenas informadas saem
 * uma a uma, cada uma com a sua própria confirmação, e é essa lentidão que
 * impede que trinta linhas digitadas sumam por engano num clique só.
 */
export class ExclusaoRecusada extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ExclusaoRecusada";
  }
}

/**
 * Apaga o cadastro de uma unidade registrada à mão.
 *
 * **O que ela é.** O desfazer de `registrarUnidade`, e nada além disso: sai a
 * linha de identidade — nome, código, canal e quinzena inicial — de um par
 * (escopo, canal) que alguém digitou. Nenhum número sai por aqui, porque nenhum
 * número mora aqui.
 *
 * **Por que ela recusa quando há planilha.** Uma unidade sem acervo tem as
 * vigências que a planilha lhe deu; apagá-la com as células dentro faria as
 * duas coisas ao mesmo tempo — a identidade e o trabalho digitado — num clique
 * cuja confirmação falaria de uma delas. Pior: as células ficariam no banco,
 * órfãs, e a lista voltaria a mostrá-las sem nome (ver `contextosEProcedencia`),
 * de modo que "excluir a unidade" produziria uma linha nova em vez de nenhuma.
 * Apagar quinzena por quinzena e só então a unidade é mais lento, e é a ordem
 * em que o estado nunca fica pela metade.
 *
 * **Por que ela não apaga quem tem acervo.** Não por regra deste arquivo: uma
 * unidade com snapshot não é uma linha registrada nesta tabela — ela pode ter
 * uma, ignorada pela montagem do contexto, e apagá-la não tiraria da lista uma
 * unidade que vive do arquivo. Quem tira uma unidade importada da tela é a
 * exclusão da importação, em Importações, e é lá que essa decisão tem o
 * tamanho que merece.
 */
export async function excluirUnidadeRegistrada(
  db: Database,
  pedido: { scopeHash: string; canal: string | null },
): Promise<UnidadeRegistrada> {
  const canal = pedido.canal ?? "";

  return db.transaction(async (tx) => {
    const [linha] = await tx
      .select()
      .from(remuneracaoUnidadeTable)
      .where(
        and(
          eq(remuneracaoUnidadeTable.scopeHash, pedido.scopeHash),
          eq(remuneracaoUnidadeTable.canal, canal),
        ),
      );
    if (!linha) throw new UnidadeNaoRegistrada();

    const { rows } = await tx.execute<{ total: number; quinzenas: number }>(sql`
      SELECT count(*)::int AS total,
             count(DISTINCT effective_date)::int AS quinzenas
        FROM remuneracao_planilha
       WHERE scope_hash = ${pedido.scopeHash}
         AND canal = ${canal}`);
    const comPlanilha = rows[0] ?? { total: 0, quinzenas: 0 };

    if (comPlanilha.total > 0) {
      throw new ExclusaoRecusada(
        `${linha.nome} tem ${comPlanilha.total} ${
          comPlanilha.total === 1 ? "linha informada" : "linhas informadas"
        } em ${comPlanilha.quinzenas} ${
          comPlanilha.quinzenas === 1 ? "quinzena" : "quinzenas"
        }. Apague a planilha de cada quinzena primeiro — assim o que se perde ` +
          "está escrito antes de cada clique, e nada fica no banco sem unidade que o explique.",
      );
    }

    await tx
      .delete(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.id, linha.id));

    return comoElaVolta(linha);
  });
}
