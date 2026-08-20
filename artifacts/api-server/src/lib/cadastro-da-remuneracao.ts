import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type { FonteDeCadastro, RespostaDoCadastro } from "@workspace/fechamento";
import { contratoDaPlanilha, lerPlanilha, vigenciaQueResponde } from "@workspace/remuneracao";

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
 * **Como a unidade do fechamento encontra a do cadastro.** Pelo `codigo`, que é
 * o mesmo identificador nos dois lados: o que a competência do fechamento traz
 * em `unidade_codigo` e o que alguém registrou em `remuneracao_unidade`. Não há
 * aproximação nenhuma — código com máscara de um lado e sem do outro **não**
 * casa, pela mesma razão que `normalizarCodigo` recusa adivinhar. Quando não
 * casa, a resposta é `null`, e a tela diz "sem cadastro" em vez de mostrar um
 * devido tirado do contrato de outra unidade.
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
 * da Rota seria inventar um contrato; responder `null` é dizer a verdade.
 */

interface UnidadeDoCadastro {
  scopeHash: string;
  /** O tipo de operação como o cadastro o guarda. `null` é a série sem canal. */
  canal: string | null;
}

/**
 * A unidade registrada que responde por este código e tipo de operação.
 *
 * A preferência é a série do próprio tipo de operação; sem ela, a série sem
 * canal (`''`), que é como o cadastro guarda a unidade cuja aba foi digitada
 * antes de qualquer export chegar. Ver `canaisComPlanilha` em
 * `@workspace/remuneracao`.
 */
async function unidadeDoCadastro(
  db: Database,
  unidadeCodigo: string,
  tipoDeOperacao: string,
): Promise<UnidadeDoCadastro | null> {
  const { rows } = await db.execute<{ scope_hash: string; canal: string }>(sql`
    SELECT u.scope_hash, u.canal
      FROM remuneracao_unidade u
     WHERE u.codigo = ${unidadeCodigo}
       AND u.codigo <> ''
     ORDER BY (u.canal = ${tipoDeOperacao}) DESC, (u.canal = '') DESC, u.canal
     LIMIT 1
  `);
  const linha = rows[0];
  if (!linha) return null;
  return { scopeHash: linha.scope_hash, canal: linha.canal === "" ? null : linha.canal };
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
    async resolver(pergunta): Promise<RespostaDoCadastro | null> {
      if (pergunta.canal !== "ROTA") return null;

      const unidade = await unidadeDoCadastro(
        db,
        pergunta.unidadeCodigo,
        alvo.tipoDeOperacao,
      );
      if (!unidade) return null;

      /*
        Qual aba responde por esta quinzena — inclusive a herança entre as duas
        metades do mês, que é regra de negócio e por isso mora em
        `@workspace/remuneracao`, testada sem banco.
      */
      const escolhida = vigenciaQueResponde(
        pergunta.inicio,
        await vigenciasComPlanilha(db, unidade),
      );
      if (!escolhida) return null;

      const planilha = await lerPlanilha(db, {
        scopeHash: unidade.scopeHash,
        canal: unidade.canal,
        effectiveDate: escolhida.vigenteDe,
      });

      const { contrato } = contratoDaPlanilha(
        new Map(planilha.linhas.map((l) => [l.chave, l.valor])),
      );
      /*
        Faltando uma linha obrigatória, não há contrato — e não há devido. É a
        mesma recusa de `contratoDaPlanilha`, repetida aqui só para dizer que
        ela é deliberada: completar as que faltam com zero produziria um número
        que ninguém contratou, e a diferença contra o demonstrativo passaria a
        medir a nossa omissão em vez da divergência real.
      */
      if (!contrato) return null;

      return {
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
      };
    },
  };
}
