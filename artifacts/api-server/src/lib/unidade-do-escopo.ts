import { sql } from "drizzle-orm";
import { lerCnpj, type Database } from "@workspace/db";

/**
 * DE QUAL UNIDADE CANÔNICA É ESTE ESCOPO — a ponte entre a lateral e o acervo
 * do Fechamento.
 *
 * A caixa "Unidade atual" da lateral fala em `scope_hash`: a unidade nasce do
 * acervo de vigências (`snapshot_scope`), e é por esse hash que toda tela que
 * honra escopo se recorta. O Fechamento não conhece hash nenhum — as
 * competências dele apontam para `unidade.id`, a unidade **cadastrada**, que é
 * a autoridade que o produto inteiro passou a usar para dizer "qual unidade é
 * esta" (ver `lib/db/src/schema/unidade.ts`).
 *
 * Os dois se encontram por **duas** pontes, e a ordem entre elas é a da origem:
 *
 * 1. **`scope.unidade_id`** — a ponte que a própria importação grava. O escopo
 *    nasce da coluna `Unidade - CNPJ` do arquivo, e desde a `0106` ele nasce
 *    já sabendo de qual unidade cadastrada é: pelo CNPJ que o código carrega,
 *    ou pela unidade que quem enviou tinha aberta na lateral. É a ponte que
 *    fecha o buraco que fazia esta função recusar o acervo inteiro de CAMAÇARI
 *    logo depois de ele ser importado de dentro de CAMAÇARI.
 * 2. **`remuneracao_unidade`** — o par (`scope_hash`, `unidade_id`) que uma
 *    pessoa cadastrou à mão. Continua valendo, e continua sendo o caminho do
 *    escopo que nem documento nem declaração alcançam: o código que não traz
 *    CNPJ, num envio que não declarou unidade. É a mesma ponte que
 *    `cadastro-da-remuneracao.ts` atravessa na direção oposta (da competência
 *    para o contrato).
 *
 * As duas respondem juntas, e uma resposta só: quando as duas apontam para a
 * mesma unidade — o caso normal, porque a segunda vira a primeira na
 * importação seguinte — há uma unidade, não duas. Quando apontam para unidades
 * diferentes, é `AMBIGUO`, pela razão de sempre: escolher uma em silêncio poria
 * o contrato de uma unidade a responder pelo fechamento de outra.
 *
 * ---------------------------------------------------------------------------
 * Por texto, nunca
 * ---------------------------------------------------------------------------
 *
 * Seria tentador comparar o código do escopo (`081-0443`, `CDD Caruaru`, um
 * CNPJ com máscara) com o `unidade_codigo` que a competência guarda. É
 * exatamente o casamento por texto que `identidade-da-competencia.ts` e
 * `cadastro-porta.ts` existem para aposentar, e o estrago dele aqui seria o pior
 * possível: a frota de uma unidade desenhada embaixo do nome de outra.
 *
 * Por isso a recusa é explícita e tem nome. Quem não resolve não vira "todas as
 * unidades" — vira uma tela que diz o que falta fazer.
 */

/** O que uma resolução de escopo pode devolver. */
export type UnidadeDoEscopo =
  /** O escopo é esta unidade cadastrada, e não há texto no meio. */
  | { tipo: "RESOLVIDO"; unidadeId: string; nome: string }
  /**
   * Nenhuma das duas pontes responde por este escopo.
   *
   * **Deixou de ser o caso comum, e o nome dele mudou de sentido.** Enquanto a
   * única ponte era o cadastro manual, isto era o estado de toda unidade
   * importada — e a tela mandava refazer à mão um vínculo que a importação
   * devia ter criado. Com `scope.unidade_id` gravado na origem, sobrou o que
   * ele sempre deveria ter sido: **a unidade que ninguém cadastrou ainda**. O
   * escopo existe, o acervo está lá, e não há `unidade` para ele apontar.
   *
   * `unidadeCadastrada` é o que separa os dois consertos que restam, e eles são
   * telas diferentes: `false` é cadastrar a unidade em Administração →
   * Unidades; `true` é o escopo cujo código não traz CNPJ nenhum — `443`,
   * `CDD Belém` — num acervo que já tem unidades cadastradas, e aí o conserto é
   * a associação manual em Remuneração. Sem essa distinção a tela manda metade
   * das pessoas para o lugar errado.
   *
   * O que ele **não** pode ter, em nenhum dos dois casos, é a resposta do
   * acervo inteiro: quem abriu a tela com CAMAÇARI na lateral leria a frota de
   * outra unidade sob aquele nome.
   */
  | { tipo: "SEM_CADASTRO"; unidadeCadastrada: boolean }
  /**
   * Mais de uma unidade cadastrada responde por este escopo.
   *
   * Acontece quando dois canais do mesmo `scope_hash` foram associados a
   * unidades diferentes — erro de alguém, e um que só uma pessoa desfaz.
   * Escolher uma em silêncio é o `LIMIT 1` que `cadastro-porta.ts` recusa pela
   * mesma razão.
   */
  | { tipo: "AMBIGUO"; nomes: string[] };

/**
 * Qual unidade canônica este `scope_hash` é.
 *
 * `UNION` e não dois `SELECT` em sequência: as duas pontes respondem a mesma
 * pergunta, e o `DISTINCT` sobre elas juntas é o que faz "a importação gravou
 * X e alguém já tinha cadastrado X" ser uma resposta, e não duas. O caso normal
 * é exatamente esse — a associação manual de ontem vira `scope.unidade_id` na
 * importação de hoje —, e sem a união ele viraria `AMBIGUO` no dia seguinte.
 *
 * O `DISTINCT` dentro do ramo da Remuneração continua tendo a razão de sempre:
 * um escopo tem uma linha por canal, e os canais de uma mesma unidade são o
 * caso normal — três linhas apontando para a mesma unidade são uma resposta só.
 *
 * O ramo do escopo importado passa por `snapshot`: `scope_hash` é o resumo do
 * **conjunto** de descritores de uma vigência, e o caminho dele até as linhas
 * de `scope` é `snapshot` → `snapshot_scope`. Só escopo `UNIDADE` entra —
 * OPERADOR e REGIONAL não são unidade, e o `scope_hash` de uma vigência
 * costuma carregar os três.
 */
export async function unidadeDoEscopo(
  db: Database,
  scopeHash: string,
): Promise<UnidadeDoEscopo> {
  const { rows } = await db.execute<{ unidade_id: string; nome: string }>(sql`
    SELECT DISTINCT unidade_id, nome FROM (
      SELECT u.id AS unidade_id, u.nome
        FROM remuneracao_unidade ru
        JOIN unidade u ON u.id = ru.unidade_id
       WHERE ru.scope_hash = ${scopeHash}
      UNION
      SELECT u.id AS unidade_id, u.nome
        FROM snapshot s
        JOIN snapshot_scope ss ON ss.snapshot_id = s.id
        JOIN scope sc ON sc.id = ss.scope_id
        JOIN unidade u ON u.id = sc.unidade_id
       WHERE s.scope_hash = ${scopeHash}
         AND sc.scope_type = 'UNIDADE'
    ) respostas
     ORDER BY nome
  `);

  if (rows.length === 1) {
    return { tipo: "RESOLVIDO", unidadeId: rows[0]!.unidade_id, nome: rows[0]!.nome };
  }
  if (rows.length > 1) {
    return { tipo: "AMBIGUO", nomes: rows.map((r) => r.nome) };
  }

  /*
    Nenhuma ponte respondeu, e a tela precisa saber **qual** das duas ausências
    é esta para mandar alguém ao lugar certo. Um acervo sem unidade nenhuma
    cadastrada é um cadastro que ninguém começou; um acervo com unidades
    cadastradas e este escopo de fora é um código que não traz documento, e aí a
    associação manual é mesmo o caminho. A contagem é uma linha, e ela vale a
    diferença entre as duas frases.
  */
  const { rows: cadastro } = await db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM unidade`,
  );
  return { tipo: "SEM_CADASTRO", unidadeCadastrada: (cadastro[0]?.total ?? 0) > 0 };
}

/**
 * A unidade cadastrada que um envio declara ao sair de dentro de uma unidade.
 *
 * **É a tradução entre a lateral e o cadastro, feita no servidor de propósito.**
 * A tela sabe qual unidade está aberta — ela tem o `scope_hash` e o código do
 * escopo —, e não sabe (nem deve) qual linha de `unidade` isso é. Mandar o
 * `unidade_id` do cliente faria o envio afirmar uma identidade que o cliente
 * escolheu; mandar o escopo faz o envio afirmar **onde a pessoa estava**, que é
 * o que ela de fato declarou.
 *
 * Duas faixas, na ordem que respeita o que já foi decidido:
 *
 * 1. a associação que este escopo já tem — de uma importação anterior ou de um
 *    cadastro manual. É {@link unidadeDoEscopo}, e honrá-la primeiro é o que
 *    impede um envio de desfazer a decisão de alguém;
 * 2. o CNPJ que o código do escopo carrega, para a unidade que ainda não tem
 *    ponte nenhuma — o primeiro envio de um CDD recém-cadastrado.
 *
 * `null` quando nenhuma das duas responde, e `null` é uma declaração ausente,
 * não um erro: o envio segue, o arquivo decide sozinho pelo que traz dentro, e
 * a conferência da pré-visualização não tem contra o que conferir.
 */
export async function unidadeDeclaradaDoEnvio(
  db: Database,
  escopo: { scopeHash: string | null; codigo: string | null },
): Promise<string | null> {
  if (escopo.scopeHash) {
    const ja = await unidadeDoEscopo(db, escopo.scopeHash);
    if (ja.tipo === "RESOLVIDO") return ja.unidadeId;
    /*
      Escopo ambíguo não declara nada. Ele já é um erro que só uma pessoa
      desfaz, e escolher uma das duas unidades aqui gravaria a escolha no
      acervo — muito pior do que a tela que hoje pede o conserto.
    */
    if (ja.tipo === "AMBIGUO") return null;
  }

  const cnpj = escopo.codigo === null ? null : lerCnpj(escopo.codigo).canonico;
  if (cnpj === null) return null;
  const { rows } = await db.execute<{ id: string }>(
    sql`SELECT id FROM unidade WHERE cnpj = ${cnpj} LIMIT 1`,
  );
  return rows[0]?.id ?? null;
}

/**
 * OS ESCOPOS JÁ IMPORTADOS GANHAM A UNIDADE QUE ACABOU DE SER CADASTRADA.
 *
 * **Por que isto existe.** A importação liga o escopo à unidade cadastrada no
 * instante em que lê o arquivo — mas ela só consegue ligar ao que **já existe**.
 * Um acervo importado antes de a unidade ser cadastrada fica com o escopo nulo,
 * e cadastrar a unidade depois não o alcançaria: a próxima importação daquele
 * CDD é que o consertaria, o que é o mesmo que dizer "importe de novo" a quem
 * acabou de cadastrar.
 *
 * É a mesma lacuna que `conciliarIdentidadeDasCompetencias` fecha do lado do
 * Fechamento e `conciliarIdentidadeDoCadastro` do lado de Remuneração, e ela
 * roda no mesmo lugar que as duas, pela mesma razão: cadastrar a unidade é um
 * dos momentos em que a identidade passa a ser conhecida, e todo lugar que a
 * esperava precisa ser avisado na mesma passada.
 *
 * **Uma faixa só, e ela é aritmética.** O CNPJ que o código do escopo carrega
 * contra `unidade.cnpj`, que é único. Nome não entra — nem aqui, nem em lugar
 * nenhum deste caminho. E a unidade declarada de um envio não entra tampouco:
 * ela é do envio, e este passo não está relendo envio nenhum.
 *
 * **Idempotente, e o `IS NULL` é quem garante.** O escopo que já tem unidade não
 * é reescrito: a associação que uma pessoa fez à mão sobrevive, e rodar isto
 * duas vezes escreve zero linhas na segunda.
 */
export async function conciliarEscoposImportados(
  db: Database,
): Promise<{ associados: { code: string; nome: string }[] }> {
  const { rows } = await db.execute<{ code: string; nome: string }>(sql`
    UPDATE scope s
       SET unidade_id = u.id
      FROM unidade u
     WHERE s.scope_type = 'UNIDADE'
       AND s.unidade_id IS NULL
       AND u.cnpj IS NOT NULL
       AND length(regexp_replace(s.code, '[^0-9]', '', 'g')) = 14
       AND regexp_replace(s.code, '[^0-9]', '', 'g') = u.cnpj
    RETURNING s.code AS code, u.nome AS nome
  `);
  return { associados: rows };
}
