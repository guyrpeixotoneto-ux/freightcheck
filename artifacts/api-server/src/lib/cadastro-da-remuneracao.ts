import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type {
  ComoCasou,
  DiagnosticoDoCadastro,
  FonteDeCadastro,
  LeituraDoCadastro,
  PortaDaUnidade,
  UnidadeCanonicaVista,
} from "@workspace/fechamento";
import {
  paradoNaUnidade,
  TETO_DE_CODIGOS,
  TETO_DE_SUGESTOES,
} from "@workspace/fechamento";
import { normalizeDocumento } from "@workspace/ingest";
import {
  CHAVES_DO_CONTRATO,
  contratoDaPlanilha,
  lerPlanilha,
  lerSituacaoDaVigencia,
  vigenciaQueResponde,
} from "@workspace/remuneracao";

/**
 * A PORTA DO CADASTRO, LIGADA — o contrato digitado alimentando o fechamento.
 *
 * `@workspace/fechamento` calcula o `RESUMO GERAL` inteiro a partir do contrato
 * (`mapa-rota.ts`), e pergunta por ele através de `FonteDeCadastro`
 * (`cadastro-porta.ts`). `@workspace/remuneracao` guarda esse contrato, digitado
 * na tela de cadastro, e sabe traduzi-lo (`contrato.ts`). As duas metades
 * existiam e nunca se encontravam: `lerResumoDoMes` recebia `SEM_CADASTRO`, que
 * responde `null` a tudo, e por isso o painel da planilha caía sempre na
 * releitura do 03.08.20 — a que mostra `em conjunto` em seis das onze linhas,
 * porque o demonstrativo realmente não parte a frota por tipo.
 *
 * Este arquivo é o encontro, e ele mora na borda de propósito: é aqui que os
 * dois pacotes podem se ver sem que nenhum dos dois passe a depender do outro.
 * Se um campo de `ParametrosDoCadastro` mudar de um lado e não do outro, é o
 * build **deste** arquivo que quebra — que é onde se quer ser avisado.
 *
 * **As três portas, e por que elas agora se veem de fora.** O contrato de uma
 * unidade atravessa três: encontrar a unidade pelo código, encontrar a vigência
 * que responde pela quinzena, e montar o contrato com as obrigatórias da aba.
 * Até aqui as três fechavam do mesmo jeito — um `return null` — e a tela dizia a
 * mesma frase para as três: *"nenhum cadastro respondeu por esta unidade nesta
 * competência"*. Quem não cadastrou a unidade, quem digitou a aba no mês errado
 * e quem deixou duas células em branco liam exatamente o mesmo texto, e iam
 * procurar em três lugares diferentes sem que nada na tela dissesse qual.
 *
 * Cada `return` daqui para baixo carrega agora um {@link DiagnosticoDoCadastro}
 * dizendo em qual porta parou e com o que ela abre. Nenhuma delas passou a ser
 * mais permissiva: o que mudou é que a recusa passou a ser explicada.
 *
 * **Como a unidade do fechamento encontra a do cadastro.** Pelo `codigo`, que é
 * o mesmo identificador nos dois lados: o que a competência do fechamento traz
 * em `unidade_codigo` e o que alguém registrou em `remuneracao_unidade`. Ver
 * {@link resolverUnidade} para as três formas de casar e o que cada uma ignora
 * — e, principalmente, para o que **nenhuma** delas faz, que é adivinhar pelo
 * nome.
 *
 * **O nome sugere; ele não resolve.** Quando nada é encontrado, o texto que a
 * competência carrega é procurado entre os *nomes* das unidades do cadastro
 * mestre ({@link sugestoesPeloTexto}), e a candidata vai para o diagnóstico. É a
 * diferença entre encurtar a procura e adivinhar: a sugestão é oferecida a uma
 * pessoa, que associa a competência à unidade com um clique — e o que passa a
 * valer dali em diante é o `id`, não o nome que levou até ele. Nenhum contrato
 * responde por semelhança de nome, hoje nem depois.
 *
 * **A unidade sem código não é candidata, e o `<> ''` diz isso.** Desde a `0047`
 * o cadastro aceita unidade sem CNPJ, e `''` ali quer dizer "ninguém deu o
 * código" — nunca "o código é vazio". Sem a guarda, uma competência que
 * chegasse com o código em branco casaria com **todas** as unidades ainda não
 * identificadas, e a primeira delas responderia pelo contrato. Quem gravar o
 * CNPJ depois (`informarCodigoDaUnidade`) volta a ser candidata sozinha.
 *
 * **Só a Rota.** O contrato transcrito é o da Rota — a própria aba `Cadastro`
 * escreve `QUANTIDADE DE DOCUMENTOS EMITIDOS - ROTA %` —, e é também o único
 * canal com painel (`CANAIS_COM_PAINEL`). Responder pelo AS com os parâmetros
 * da Rota seria inventar um contrato; responder que o canal não tem contrato é
 * dizer a verdade, e agora ela chega à tela com esse nome.
 */

interface UnidadeDoCadastro {
  scopeHash: string;
  /** O tipo de operação como o cadastro o guarda. `null` é a série sem canal. */
  canal: string | null;
  /** O código como o **cadastro** o escreve, para a tela pôr ao lado. */
  codigo: string;
  /** A unidade canônica deste cadastro. `null` no legado. */
  unidadeId: string | null;
  comoCasou: ComoCasou;
}

/**
 * Uma linha candidata, como o SQL a devolve.
 *
 * `type` e não `interface` porque `db.execute<T>` exige `T extends
 * Record<string, unknown>`, e só o alias de tipo ganha a assinatura de índice
 * implícita que satisfaz a restrição.
 */
type CandidataBruta = {
  scope_hash: string;
  canal: string;
  codigo: string;
  unidade_id: string | null;
};

/**
 * Uma unidade canônica como o SQL a devolve.
 *
 * `type` pela mesma razão de {@link CandidataBruta}: `db.execute<T>` exige `T
 * extends Record<string, unknown>`, e só o alias ganha a assinatura de índice
 * implícita. Os campos são os de `UnidadeCanonicaVista`, e é ela que sai daqui.
 */
type CanonicaBruta = { id: string; nome: string; cnpj: string };

/**
 * A unidade registrada que responde por este código e tipo de operação.
 *
 * **O defeito que esta função conserta.** A consulta era `u.codigo = $codigo`,
 * igualdade textual crua, com `LIMIT 1`. Dois problemas moravam ali, e os dois
 * apareciam como a mesma tela vazia:
 *
 * - **o espaço sobrando.** A tela de fechamento compara com `.trim()` dos dois
 *   lados e diz "existe unidade cadastrada com este código"; o SQL comparava
 *   byte a byte e não achava. As duas telas discordavam sobre o mesmo cadastro,
 *   e a que decidia era a que não explicava. Pior: `normalizarCodigo`, em
 *   `@workspace/remuneracao`, é `trim()` **e nada mais** — o código canônico da
 *   unidade é, por definição do próprio módulo, o digitado sem o espaço em
 *   volta. O backend estava discordando da sua própria regra;
 * - **o `LIMIT 1` silencioso.** Duas unidades com o mesmo código faziam a
 *   primeira responder pelo fechamento da outra, sem nada na tela dizendo que
 *   houve escolha. Agora a ambiguidade é um estado, e ela recusa.
 *
 * **Sobre resolver pela identidade canônica.** Foi o primeiro caminho tentado,
 * e ele **não** serve como resolução única — a razão é o próprio CDD Belém. A
 * identidade canônica de uma UNIDADE, em `@workspace/ingest`, é
 * `normalizeDocumento`: dígitos, com os zeros à esquerda de volta. Um código
 * como `CDD Belém` não tem dígito nenhum e normaliza para `""` — e `""` casaria
 * com **todo** código sem dígito do cadastro. Trocar a igualdade textual pela
 * canônica pura transformaria o defeito atual (não encontra) num defeito muito
 * pior (encontra a errada).
 *
 * Por isso ela entra como **terceiro** critério e só quando os dois lados têm
 * documento de verdade. Aí ela é exatamente o que se quer: `12.345.678/0001-99`
 * e `12345678000199` são o mesmo CNPJ, e o Excel entrega ora um ora outro.
 *
 * A ordem é do mais estrito para o mais frouxo, e para na primeira faixa que
 * acha alguém — um casamento exato nunca é preterido por um aproximado.
 */
async function resolverUnidade(
  db: Database,
  pergunta: { unidadeId: string | null; unidadeCodigo: string },
  tipoDeOperacao: string,
): Promise<{ unidade: UnidadeDoCadastro | null; candidatas: number }> {
  const preferencia = sql`ORDER BY (u.canal = ${tipoDeOperacao}) DESC, (u.canal = '') DESC, u.canal`;
  const { unidadeCodigo } = pergunta;
  const procurado = unidadeCodigo.trim();

  /*
    0. Pela identidade canônica — as duas pontas apontando para a mesma unidade.

    É a faixa que aposenta as outras três, e a única que não compara texto
    nenhum. Quando a competência tem `unidade_id` e existe cadastro de
    Remuneração para a mesma unidade, não há o que casar: é a mesma linha da
    tabela `unidade`, e nenhuma grafia, máscara ou espaço pode desalinhá-las.

    As três faixas seguintes continuam existindo para as competências
    históricas, que ainda não têm identidade — e vão continuar até o passivo
    estar classificado. Uma competência com `unidade_id` nunca chega a elas.
  */
  if (pergunta.unidadeId !== null) {
    const porIdentidade = await db.execute<CandidataBruta>(sql`
      SELECT u.scope_hash, u.canal, u.codigo, u.unidade_id
        FROM remuneracao_unidade u
       WHERE u.unidade_id = ${pergunta.unidadeId}
       ${preferencia}
    `);
    const daIdentidade = escolher(porIdentidade.rows, "IDENTIDADE");
    if (daIdentidade.candidatas > 0) return daIdentidade;
    /*
      Sem cadastro de Remuneração para esta unidade, a resposta é "não há", e
      não "vou tentar pelo texto". Cair nas faixas de texto aqui reabriria a
      porta que a identidade fecha: a competência aponta para a unidade A, o
      texto dela casa com o cadastro da unidade B, e o contrato errado responde.

      Quem chama transforma este vazio em `UNIDADE_SEM_CADASTRO` — e não em
      `UNIDADE_NAO_ENCONTRADA`, que mandaria igualar textos que este caminho
      nunca lê.
    */
    return { unidade: null, candidatas: 0 };
  }

  /* 1. Exato — byte a byte, como sempre foi. */
  const exatas = await db.execute<CandidataBruta>(sql`
    SELECT u.scope_hash, u.canal, u.codigo, u.unidade_id
      FROM remuneracao_unidade u
     WHERE u.codigo = ${unidadeCodigo}
       AND btrim(u.codigo) <> ''
     ${preferencia}
  `);
  const doExato = escolher(exatas.rows, "EXATO");
  if (doExato.candidatas > 0) return doExato;

  /* 2. Só o espaço em volta separava os dois — que é o `normalizarCodigo`. */
  const aparadas = await db.execute<CandidataBruta>(sql`
    SELECT u.scope_hash, u.canal, u.codigo, u.unidade_id
      FROM remuneracao_unidade u
     WHERE btrim(u.codigo) = ${procurado}
       AND btrim(u.codigo) <> ''
     ${preferencia}
  `);
  const doEspaco = escolher(aparadas.rows, "ESPACO");
  if (doEspaco.candidatas > 0) return doEspaco;

  /*
    3. O mesmo documento, com máscara de um lado e sem do outro.

    Só entra quando o código procurado **tem** documento: `CDD Belém` normaliza
    para vazio, e vazio casaria com todos os outros sem dígito. O filtro do lado
    do banco repete a guarda, porque a comparação acontece lá.
  */
  const documento = normalizeDocumento(procurado);
  if (documento === "") return { unidade: null, candidatas: 0 };

  const porDocumento = await db.execute<CandidataBruta>(sql`
    SELECT u.scope_hash, u.canal, u.codigo, u.unidade_id
      FROM remuneracao_unidade u
     WHERE lpad(regexp_replace(u.codigo, '\\D', '', 'g'), 14, '0') = lpad(${documento}, 14, '0')
       AND regexp_replace(u.codigo, '\\D', '', 'g') <> ''
     ${preferencia}
  `);
  return escolher(porDocumento.rows, "DOCUMENTO");
}

/**
 * A candidata única de uma faixa — ou a contagem, quando há mais de uma.
 *
 * Devolver a contagem em vez de escolher é a diferença entre "não encontrei" e
 * "encontrei duas": as duas precisam de conserto, e são consertos opostos.
 */
function escolher(
  linhas: CandidataBruta[],
  comoCasou: ComoCasou,
): { unidade: UnidadeDoCadastro | null; candidatas: number } {
  /*
    A mesma unidade pode ter mais de uma série de canal (`ROTA` e `''`), e isso
    **não** é ambiguidade: é a mesma unidade duas vezes, e a preferência do
    `ORDER BY` já sabe qual delas responde. Ambíguo é haver dois `scope_hash`.
    Contar linhas em vez de unidades faria a unidade normal, com a série do
    canal e a série sem canal, ser recusada por duplicidade.
  */
  const distintas = new Set(linhas.map((l) => l.scope_hash));
  if (distintas.size === 0) return { unidade: null, candidatas: 0 };
  if (distintas.size > 1) return { unidade: null, candidatas: distintas.size };

  const primeira = linhas[0]!;
  return {
    unidade: {
      scopeHash: primeira.scope_hash,
      canal: primeira.canal === "" ? null : primeira.canal,
      codigo: primeira.codigo,
      unidadeId: primeira.unidade_id ?? null,
      comoCasou,
    },
    candidatas: 1,
  };
}

/**
 * O CNPJ que o acervo declara para o escopo de um cadastro de Remuneração.
 *
 * Sai de `snapshot.canonical_scope` — a coluna `Unidade - CNPJ` normalizada por
 * `normalizeDocumento` e protegida por `check` no banco. É a **única** evidência
 * determinística que o acervo oferece, e ela só existe quando há snapshot: sem
 * importação não há CNPJ do lado do arquivo, e `null` é a resposta certa.
 *
 * Não lê `scope.code`: aquele é o texto cru da célula, e o mesmo CNPJ mascarado
 * num arquivo e limpo em outro daria dois valores diferentes para a mesma
 * unidade.
 */
async function cnpjNoAcervo(db: Database, scopeHash: string): Promise<string | null> {
  const { rows } = await db.execute<{ cnpj: string }>(sql`
    SELECT DISTINCT escopo->>'code' AS cnpj
      FROM snapshot s
      CROSS JOIN LATERAL jsonb_array_elements(s.canonical_scope) AS escopo
     WHERE s.scope_hash = ${scopeHash}
       AND s.status <> 'SUPERSEDED'
       AND NOT EXISTS (SELECT 1 FROM import_run WHERE import_run.id = s.import_run_id AND import_run.hidden_at IS NOT NULL)
       AND escopo->>'scopeType' = 'UNIDADE'
       AND escopo->>'code' ~ '^[0-9]{14}$'
     LIMIT 2
  `);
  /*
    Mais de um CNPJ no mesmo escopo é outro problema — do acervo, não deste
    caminho —, e diante dele o honesto é não escolher: sem resposta única, não
    há evidência a confrontar.
  */
  return rows.length === 1 ? rows[0]!.cnpj : null;
}

/**
 * A unidade canônica de um identificador — nome e CNPJ, para a tela nomeá-la.
 *
 * Uma consulta só, usada pelos dois caminhos que precisam dela: o confronto de
 * identidade, que compara o CNPJ contra o do acervo, e o diagnóstico de
 * `UNIDADE_SEM_CADASTRO`, que precisa **dizer o nome** da unidade a que a
 * competência já está associada. Antes o confronto lia só o CNPJ, e a frase da
 * tela não tinha como chamar a unidade pelo nome.
 */
async function unidadeCanonica(
  db: Database,
  id: string,
): Promise<UnidadeCanonicaVista | null> {
  const { rows } = await db.execute<CanonicaBruta>(sql`
    SELECT u.id, u.nome, u.cnpj FROM unidade u WHERE u.id = ${id} LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * O texto sem o que separa duas grafias do mesmo nome, como o SQL o compara.
 *
 * Minúsculas, espaço em volta e no meio normalizados, e os acentos rebaixados
 * pelo `translate` — que é a forma de fazê-lo **sem** exigir a extensão
 * `unaccent`, cuja instalação seria uma dependência nova de banco para um
 * conserto de tela. `CDD Belém`, `cdd belem` e `CDD  BELÉM` viram o mesmo
 * texto, e é só disso que a sugestão precisa.
 *
 * **Não é uma identidade, e não vira uma.** Nada aqui grava, resolve contrato
 * ou escolhe cadastro; o resultado é uma lista de candidatas para uma pessoa
 * confirmar. Ver `PortaDaUnidade.sugestoes`.
 */
function nomeComparavel(texto: unknown) {
  /*
    Duas miudezas que só aparecem em produção, e por isso ficam anotadas.

    O `\\s` é escrito com duas barras porque `sql` é um template **marcado** e o
    drizzle lê a versão cozida das partes: `\s` viraria a letra `s`, e o
    `regexp_replace` passaria a trocar runs de "s" por espaço. É o mesmo `\\D`
    da faixa 3 de `resolverUnidade`, pela mesma razão.

    O `::text` tira do Postgres a escolha entre `btrim(text)` e `btrim(bytea)`
    para o parâmetro do lado direito, que chega sem tipo declarado. A coluna já
    é `text` e nada perde com o cast, então a mesma função serve aos dois lados
    — e é ela ser a mesma que garante que as duas pontas normalizem igual.
  */
  return sql`translate(lower(regexp_replace(btrim(${texto}::text), '\\s+', ' ', 'g')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn')`;
}

/**
 * As unidades cadastradas que o texto da competência descreve — as candidatas.
 *
 * Duas evidências, e as duas são do cadastro mestre (`unidade`), não do
 * cadastro de Remuneração: **o nome**, quando alguém abriu a competência
 * digitando `CDD Belém` no campo do código, e **o CNPJ**, quando o que foi
 * digitado é o documento de uma unidade já cadastrada. As duas apontam para uma
 * linha da tabela `unidade`, que é o que a associação grava.
 *
 * Roda **só quando nada foi encontrado**, e só para a competência sem
 * identidade: é uma consulta a mais que o caminho feliz não paga, e sugerir
 * unidade a quem já tem uma associada seria oferecer trocar a identidade por um
 * palpite.
 */
async function sugestoesPeloTexto(
  db: Database,
  texto: string,
): Promise<UnidadeCanonicaVista[]> {
  const procurado = texto.trim();
  if (procurado === "") return [];
  /*
    O CNPJ entra como `''` quando o texto não tem dígito nenhum — e `''` não
    casa com nenhum CNPJ, porque a coluna é sempre catorze dígitos. É a mesma
    guarda da faixa 3 de `resolverUnidade`, pela mesma razão.
  */
  const documento = normalizeDocumento(procurado);
  const { rows } = await db.execute<CanonicaBruta>(sql`
    SELECT u.id, u.nome, u.cnpj
      FROM unidade u
     WHERE ${nomeComparavel(sql`u.nome`)} = ${nomeComparavel(sql`${procurado}`)}
        OR u.cnpj = ${documento}
     ORDER BY u.nome
     LIMIT ${TETO_DE_SUGESTOES}
  `);
  return rows;
}

/** Quantas unidades o cadastro tem ao todo — o denominador da frase da tela. */
async function contarCadastradas(db: Database): Promise<number> {
  const { rows } = await db.execute<{ total: number }>(
    sql`SELECT count(*)::int AS total FROM remuneracao_unidade`,
  );
  return rows[0]?.total ?? 0;
}

/**
 * Os códigos que as unidades cadastradas de fato têm — o outro lado da
 * comparação.
 *
 * Distintos e sem os vazios: a unidade cadastrada sem código não tem código a
 * mostrar, e listar `''` entre os candidatos sugeriria que o vazio é um valor
 * que se pode digitar. Quantas são as sem código já sai do denominador.
 */
async function codigosCadastrados(db: Database): Promise<string[]> {
  const { rows } = await db.execute<{ codigo: string }>(sql`
    SELECT DISTINCT u.codigo
      FROM remuneracao_unidade u
     WHERE btrim(u.codigo) <> ''
     ORDER BY u.codigo
     LIMIT ${TETO_DE_CODIGOS}
  `);
  return rows.map((l) => l.codigo);
}

/** As vigências dessa unidade que têm alguma linha de planilha digitada. */
async function vigenciasComPlanilha(
  db: Database,
  unidade: UnidadeDoCadastro,
): Promise<string[]> {
  const { rows } = await db.execute<{ effective_date: string }>(sql`
    SELECT DISTINCT p.effective_date::text AS effective_date
      FROM remuneracao_planilha p
     WHERE p.scope_hash = ${unidade.scopeHash}
       AND p.canal = ${unidade.canal ?? ""}
     ORDER BY effective_date
  `);
  return rows.map((l) => l.effective_date);
}

/**
 * A fonte de cadastro do produto — a que `lerResumoDoMes` passou a receber.
 *
 * `tipoDeOperacao` vem da rota porque a pergunta do fechamento
 * (`PerguntaAoCadastro`) não o carrega: ela fala de `canal` no sentido de
 * Rota/AS, que é outro eixo. Os dois convivem, e misturá-los faria a planilha
 * da ROTA responder pelo fechamento da EMPURRADA.
 */
export function cadastroDaRemuneracao(
  db: Database,
  alvo: { tipoDeOperacao: string },
): FonteDeCadastro {
  return {
    async resolver(pergunta): Promise<LeituraDoCadastro> {
      const cadastradas = await contarCadastradas(db);
      const daUnidade = (porta: Partial<PortaDaUnidade>): DiagnosticoDoCadastro =>
        paradoNaUnidade(pergunta.unidadeCodigo, { cadastradas, ...porta });

      if (pergunta.canal !== "ROTA") {
        return {
          resposta: null,
          diagnostico: {
            ...daUnidade({}),
            estado: "CANAL_SEM_CONTRATO",
          },
        };
      }

      const { unidade, candidatas } = await resolverUnidade(
        db,
        pergunta,
        alvo.tipoDeOperacao,
      );
      if (!unidade) {
        /*
          Os códigos entram **só** quando não se achou: é aí que eles servem, e
          é uma consulta a mais que o caminho feliz não precisa pagar.

          E o que se acrescenta a eles depende de a competência ter identidade,
          porque os dois casos têm consertos opostos:

          - **com identidade**, a unidade canônica é lida para a tela poder
            chamá-la pelo nome, e o estado vira `UNIDADE_SEM_CADASTRO` — o que
            falta está do lado de Remuneração, e nenhum texto será comparado;
          - **sem identidade**, o texto vira busca no cadastro mestre, e a
            candidata encontrada é oferecida para associação. Note que nenhuma
            das duas consultas resolve contrato: uma nomeia, a outra sugere.
        */
        return {
          resposta: null,
          diagnostico: daUnidade({
            candidatas,
            codigosCadastrados: await codigosCadastrados(db),
            identidade: pergunta.unidadeId
              ? await unidadeCanonica(db, pergunta.unidadeId)
              : null,
            sugestoes: pergunta.unidadeId
              ? []
              : await sugestoesPeloTexto(db, pergunta.unidadeCodigo),
          }),
        };
      }

      const portaDaUnidade: PortaDaUnidade = {
        codigoProcurado: pergunta.unidadeCodigo,
        cadastradas,
        candidatas: 1,
        comoCasou: unidade.comoCasou,
        codigoNoCadastro: unidade.codigo,
        /* Achou: nem a lista de candidatos nem a sugestão têm para que servir. */
        codigosCadastrados: [],
        identidade: null,
        sugestoes: [],
      };

      /*
        O confronto de identidade — antes de ler vigência ou contrato.

        Só faz sentido quando o cadastro **tem** unidade canônica e o escopo dele
        **tem** snapshot: aí existem dois CNPJs afirmados por fontes
        independentes, e eles precisam concordar. Iguais, confirmam. Diferentes,
        param aqui: nenhum lado é sobrescrito, e o contrato não responde porque
        não se sabe de qual unidade ele é.

        Vem antes das outras portas de propósito — seguir para a vigência e o
        contrato produziria um devido de procedência desconhecida, que é pior do
        que não produzir nenhum.
      */
      if (unidade.unidadeId !== null) {
        const canonica = await unidadeCanonica(db, unidade.unidadeId);
        const doAcervo = await cnpjNoAcervo(db, unidade.scopeHash);
        if (canonica && doAcervo !== null && doAcervo !== canonica.cnpj) {
          return {
            resposta: null,
            diagnostico: {
              estado: "CONFLITO_DE_IDENTIDADE",
              unidade: portaDaUnidade,
              conflito: {
                doCadastro: canonica.cnpj,
                doAcervo,
                scopeHash: unidade.scopeHash,
              },
              vigencia: null,
              contrato: null,
            },
          };
        }
      }

      /*
        Qual aba responde por esta quinzena — inclusive a herança entre as duas
        metades do mês, que é regra de negócio e por isso mora em
        `@workspace/remuneracao`, testada sem banco.
      */
      const todas = await vigenciasComPlanilha(db, unidade);
      const mes = pergunta.inicio.slice(0, 7);
      const doMes = todas.filter((d) => d.slice(0, 7) === mes);
      const escolhida = vigenciaQueResponde(pergunta.inicio, todas);
      if (!escolhida) {
        return {
          resposta: null,
          diagnostico: {
            estado: "SEM_VIGENCIA",
            unidade: portaDaUnidade,
            vigencia: { doMes, todas, vigenteDe: null },
            contrato: null,
          },
        };
      }

      const portaDaVigencia = {
        doMes,
        todas,
        vigenteDe: escolhida.vigenteDe,
      };

      const planilha = await lerPlanilha(db, {
        scopeHash: unidade.scopeHash,
        canal: unidade.canal,
        effectiveDate: escolhida.vigenteDe,
      });

      const { contrato, faltam, assumidasComoZero } = contratoDaPlanilha(
        new Map(planilha.linhas.map((l) => [l.chave, l.valor])),
      );
      /*
        Faltando uma linha obrigatória, não há contrato — e não há devido. É a
        mesma recusa de `contratoDaPlanilha`, repetida aqui só para dizer que
        ela é deliberada: completar as que faltam com zero produziria um número
        que ninguém contratou, e a diferença contra o demonstrativo passaria a
        medir a nossa omissão em vez da divergência real.

        O que mudou é que a recusa passou a **nomear as linhas**. A lista já
        existia — `contratoDaPlanilha` sempre devolveu `faltam` —, e era
        descartada aqui: quem tinha vinte das vinte e duas linhas digitadas lia
        "nenhum cadastro respondeu" e não tinha como saber quais duas.
      */
      /*
        O lastro entra aqui, e não decide nada aqui.

        É a medida de auditabilidade da vigência que respondeu — quantas das
        onze linhas verificáveis o acervo sustenta —, e ela viaja junto com o
        contrato para a tela poder dizer de onde o devido veio. O contrato já
        está montado a esta altura, e nenhuma linha abaixo o consulta: se um dia
        alguém fizer o `if` que falta aqui, `lastro-e-devido.test.ts` cai.
      */
      const lastro = await lerSituacaoDaVigencia(db, {
        scopeHash: unidade.scopeHash,
        canal: unidade.canal,
        effectiveDate: escolhida.vigenteDe,
      });

      const portaDoContrato = {
        faltam,
        assumidasComoZero,
        lidas: CHAVES_DO_CONTRATO.length,
        lastro: {
          comLastro: lastro.comLastro,
          verificaveis: lastro.verificaveis,
          informadas: lastro.informadas,
        },
      };
      if (!contrato) {
        return {
          resposta: null,
          diagnostico: {
            estado: "CONTRATO_INCOMPLETO",
            unidade: portaDaUnidade,
            vigencia: portaDaVigencia,
            contrato: portaDoContrato,
          },
        };
      }

      return {
        resposta: {
          parametros: contrato.parametros,
          custoVariavelPrevistoPor25Viagens: contrato.custoVariavelPrevistoPor25Viagens,
          cadastroId: `${unidade.scopeHash}:${unidade.canal ?? ""}:${escolhida.vigenteDe}`,
          /*
            A vigência que **respondeu**, e não a quinzena que perguntou. É por
            este campo que a herança aparece na tela: a 2ª quinzena que usou a aba
            da 1ª mostra `2026-07-01` ao lado de um período que começa no dia 16,
            e quem lê vê de onde o número veio sem precisar perguntar.
          */
          vigenteDe: escolhida.vigenteDe,
        },
        diagnostico: {
          estado: "RESPONDEU",
          unidade: portaDaUnidade,
          vigencia: portaDaVigencia,
          contrato: portaDoContrato,
        },
      };
    },
  };
}
