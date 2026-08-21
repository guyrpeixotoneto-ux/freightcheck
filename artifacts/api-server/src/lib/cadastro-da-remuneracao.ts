import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type {
  ComoCasou,
  DiagnosticoDoCadastro,
  FonteDeCadastro,
  LeituraDoCadastro,
  PortaDaUnidade,
} from "@workspace/fechamento";
import { paradoNaUnidade, TETO_DE_CODIGOS } from "@workspace/fechamento";
import { normalizeDocumento } from "@workspace/ingest";
import {
  CHAVES_DO_CONTRATO,
  contratoDaPlanilha,
  lerPlanilha,
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
};

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
      SELECT u.scope_hash, u.canal, u.codigo
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
    */
    return { unidade: null, candidatas: 0 };
  }

  /* 1. Exato — byte a byte, como sempre foi. */
  const exatas = await db.execute<CandidataBruta>(sql`
    SELECT u.scope_hash, u.canal, u.codigo
      FROM remuneracao_unidade u
     WHERE u.codigo = ${unidadeCodigo}
       AND btrim(u.codigo) <> ''
     ${preferencia}
  `);
  const doExato = escolher(exatas.rows, "EXATO");
  if (doExato.candidatas > 0) return doExato;

  /* 2. Só o espaço em volta separava os dois — que é o `normalizarCodigo`. */
  const aparadas = await db.execute<CandidataBruta>(sql`
    SELECT u.scope_hash, u.canal, u.codigo
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
    SELECT u.scope_hash, u.canal, u.codigo
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
      comoCasou,
    },
    candidatas: 1,
  };
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
        */
        return {
          resposta: null,
          diagnostico: daUnidade({
            candidatas,
            codigosCadastrados: await codigosCadastrados(db),
          }),
        };
      }

      const portaDaUnidade: PortaDaUnidade = {
        codigoProcurado: pergunta.unidadeCodigo,
        cadastradas,
        candidatas: 1,
        comoCasou: unidade.comoCasou,
        codigoNoCadastro: unidade.codigo,
        /* Achou: a lista de candidatos não tem para que servir. */
        codigosCadastrados: [],
      };

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
            vigencia: { doMes, todas, vigenteDe: null, herdadaDaOutraQuinzena: false },
            contrato: null,
          },
        };
      }

      const portaDaVigencia = {
        doMes,
        todas,
        vigenteDe: escolhida.vigenteDe,
        herdadaDaOutraQuinzena: escolhida.herdadaDaOutraQuinzena,
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
      const portaDoContrato = {
        faltam,
        assumidasComoZero,
        lidas: CHAVES_DO_CONTRATO.length,
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
