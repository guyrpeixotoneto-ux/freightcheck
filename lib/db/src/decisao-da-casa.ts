import pg from "pg";

/**
 * A decisão da casa sobrevive ao DDL que vem de fora da fila.
 *
 * ---------------------------------------------------------------------------
 * O buraco que este módulo fecha
 * ---------------------------------------------------------------------------
 * `modulo_universal` guarda o que a instalação desligou para todo mundo, e
 * `modulo_universal_evento` guarda quem desligou, quando e por quê. As duas são
 * **decisão humana**: nenhuma consulta as recompõe, e o histórico é append-only
 * justamente porque é a única resposta para "quem tirou esta tela do menu?".
 *
 * Três vezes em setembro de 2026 o menu inteiro voltou a aparecer para quem o
 * tinha desligado, e a cadeia é sempre a mesma — está escrita por extenso em
 * `bridge.ts`, em `reconvergencia.ts` e no teste `portao-de-publicacao.test.ts`:
 *
 * 1. o banco de Development fica **atrás** da fila versionada que Production já
 *    aplicou (basta não reiniciar o workspace depois de uma migration entrar);
 * 2. o Provision do Publishing compara os dois **schemas reais** e propõe
 *    remover de Production o que só Production tem — entre eles as colunas, os
 *    índices e as chaves primárias destas duas tabelas;
 * 3. publicar executa esse DDL destrutivo **por fora da fila**, e as linhas vão
 *    junto;
 * 4. a partida seguinte reconverge a estrutura a partir das próprias migrations
 *    (`reconvergencia.ts`), sem nada pendente e sem nenhuma falha — e as tabelas
 *    voltam **vazias**. Vazio, nesta camada, quer dizer "tudo ligado".
 *
 * Nada nesse caminho está errado isoladamente. O que faltava é que, na etapa 4,
 * a estrutura voltava e o conteúdo não: "o conteúdo deles não volta sozinho",
 * como o log da partida diz. Para dado derivado isso é aceitável — o produto o
 * recomputa. Para **decisão humana** não é: ela não volta por caminho nenhum, e
 * a única defesa oferecida até aqui era alguém lembrar de rodar
 * `publicar:conferir` antes de todo Publish. Lembrar não é estrutura, e foi
 * exatamente o que falhou.
 *
 * ---------------------------------------------------------------------------
 * O que este módulo faz
 * ---------------------------------------------------------------------------
 * Mantém um **espelho** das duas tabelas no schema `drizzle` — fora de
 * `public`, que é o único schema que o Provision do Publishing introspecta e
 * mexe. É a mesma propriedade em que `bridge-guarda.ts` já se apoia para
 * atravessar o ciclo do bridge, agora estendida ao ciclo do deploy, que é o que
 * ninguém cobria.
 *
 * **Não são duas fontes de verdade.** Quem responde qualquer pergunta do
 * produto é `public.modulo_universal`, sempre — nenhuma leitura de menu, de
 * sessão ou de portão passa por aqui. O espelho é escrito **dentro da mesma
 * transação** que grava a decisão, então ele não tem como discordar dela; e é
 * lido uma vez só, na partida, sob uma condição que só existe depois de uma
 * perda estrutural.
 *
 * ---------------------------------------------------------------------------
 * A impressão digital da perda, e por que ela não confunde nada
 * ---------------------------------------------------------------------------
 * `reporDecisaoDaCasa` só escreve quando **as duas** tabelas de `public` estão
 * vazias e o espelho tem linha. Isso não é um "vazio ≈ perdido" frouxo: é a
 * única combinação que o produto não consegue produzir sozinho.
 *
 * · Uma casa que religa tudo esvazia `modulo_universal` — e **não** esvazia
 *   `modulo_universal_evento`, que é append-only e registra o religamento. As
 *   duas vazias com espelho cheio é estrutura recriada do zero, e nada mais.
 * · Uma casa que nunca desligou nada tem o espelho vazio também, e a condição
 *   não se arma.
 * · Entre o `down` e o `up` do bridge as tabelas nem existem em `public`, e a
 *   reposição exige que existam.
 *
 * Fora dessa condição o módulo não escreve uma linha, e em nenhuma condição ele
 * escreve por cima de linha que já esteja lá.
 */

/** O que uma consulta precisa saber fazer para este módulo funcionar. */
export type Consulta = (sql: string) => Promise<Record<string, unknown>[]>;

/**
 * As duas tabelas protegidas, e o nome do espelho de cada uma.
 *
 * A ordem é a da reposição — e, entre estas duas, ela é indiferente: nenhuma
 * pendura na outra, e a chave das duas é texto.
 *
 * O sufixo é `__casa`, e **não** `__guardado`: `bridge-guarda.ts` usa esse outro
 * nome no mesmo schema para o cofre do ciclo do bridge, que ele cria no `down` e
 * **apaga** no fim do `up`. Um espelho permanente com aquele nome seria destruído
 * pela primeira publicação que passasse pelo bridge — o oposto do que este
 * módulo existe para fazer.
 */
export const ESPELHOS_DA_CASA: ReadonlyArray<{
  tabela: string;
  espelho: string;
}> = [
  { tabela: "modulo_universal", espelho: "modulo_universal__casa" },
  {
    tabela: "modulo_universal_evento",
    espelho: "modulo_universal_evento__casa",
  },
];

async function existeEm(
  consultar: Consulta,
  schema: string,
  tabela: string,
): Promise<boolean> {
  const linhas = await consultar(
    `SELECT to_regclass('"${schema}"."${tabela}"') IS NOT NULL AS existe`,
  );
  return linhas[0]?.["existe"] === true;
}

async function quantasLinhas(
  consultar: Consulta,
  schema: string,
  tabela: string,
): Promise<number> {
  const linhas = await consultar(
    `SELECT count(*)::int AS n FROM "${schema}"."${tabela}"`,
  );
  return Number(linhas[0]?.["n"] ?? 0);
}

async function colunasDe(
  consultar: Consulta,
  schema: string,
  tabela: string,
): Promise<string[]> {
  const linhas = await consultar(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = '${schema}' AND table_name = '${tabela}'
      ORDER BY column_name`,
  );
  return linhas.map((l) => String(l["column_name"]));
}

/**
 * Cria o espelho que ainda não existe, e **nunca** toca no que já existe.
 *
 * Chamada na partida, antes de qualquer escrita, para que a casa que decidiu
 * antes deste módulo existir passe a ser protegida sem precisar decidir de novo.
 *
 * A recusa de mexer num espelho existente é o que torna esta função segura de
 * chamar na partida: uma partida que rodasse logo depois de uma perda
 * estrutural encontraria `public` vazio, e recriar o espelho a partir dele
 * apagaria justamente o que ele guardava. Por isso a partida repõe primeiro e
 * garante depois (`protegerDecisaoDaCasa`), e por isso o refresco autoritativo
 * mora em `espelharDecisaoDaCasa`, que só roda dentro da transação da decisão —
 * o único momento em que `public` é, por definição, a verdade mais recente.
 */
export async function garantirEspelhoDaCasa(
  consultar: Consulta,
): Promise<string[]> {
  const criados: string[] = [];
  await consultar(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);

  for (const { tabela, espelho } of ESPELHOS_DA_CASA) {
    if (await existeEm(consultar, "drizzle", espelho)) continue;
    if (!(await existeEm(consultar, "public", tabela))) continue;
    await consultar(
      `CREATE TABLE "drizzle"."${espelho}" AS TABLE "public"."${tabela}"`,
    );
    criados.push(espelho);
  }

  return criados;
}

/**
 * Refaz o espelho a partir de `public` — o refresco autoritativo.
 *
 * Roda **dentro da transação que grava a decisão**, e é isso que impede o
 * espelho de discordar dela: ou as duas escritas entram, ou nenhuma entra. Não
 * há janela em que o banco tenha uma decisão sem espelho, nem espelho de uma
 * decisão que não foi confirmada.
 *
 * Refaz por inteiro (`DROP` + `CREATE TABLE AS`) em vez de acompanhar linha a
 * linha, e isso não é preguiça: as duas tabelas têm dezenas de linhas no pior
 * caso, e copiar tudo é o único jeito de o espelho não depender de alguém ter
 * lembrado de espelhar cada caminho de escrita novo. `CREATE TABLE AS` também
 * resolve sozinho uma coluna que uma migration futura acrescente — não há lista
 * escrita à mão para envelhecer.
 */
export async function espelharDecisaoDaCasa(
  consultar: Consulta,
): Promise<void> {
  await consultar(`CREATE SCHEMA IF NOT EXISTS "drizzle"`);

  for (const { tabela, espelho } of ESPELHOS_DA_CASA) {
    if (!(await existeEm(consultar, "public", tabela))) continue;
    await consultar(`DROP TABLE IF EXISTS "drizzle"."${espelho}"`);
    await consultar(
      `CREATE TABLE "drizzle"."${espelho}" AS TABLE "public"."${tabela}"`,
    );
  }
}

export interface ReposicaoDaDecisaoDaCasa {
  /** Repôs alguma linha? `false` é o caso normal de toda partida. */
  repos: boolean;
  /** Por que não repôs — a frase vai para o log, nunca para o silêncio. */
  motivo: string;
  /** O que voltou, por tabela. */
  linhas: Array<{ tabela: string; linhas: number }>;
}

/**
 * Repõe a decisão da casa quando — e somente quando — a estrutura voltou vazia.
 *
 * A condição está no cabeçalho do arquivo, e é conferida inteira antes de
 * qualquer escrita. Duas recusas a mais, que valem dizer:
 *
 * · **colunas diferentes entre o espelho e a tabela** — aborta nomeando a
 *   diferença, como `bridge-guarda.ts` faz e pela mesma razão: adivinhar o
 *   encaixe é exatamente o que não se deve fazer com decisão humana. O espelho
 *   fica onde está, e a próxima partida tenta de novo;
 * · **tabela com linha dentro** — não repõe nada. Somar o que o espelho tem ao
 *   que já está lá exigiria uma regra de precedência que ninguém escreveu.
 */
export async function reporDecisaoDaCasa(
  consultar: Consulta,
): Promise<ReposicaoDaDecisaoDaCasa> {
  const vazio: ReposicaoDaDecisaoDaCasa = {
    repos: false,
    motivo: "",
    linhas: [],
  };

  for (const { tabela, espelho } of ESPELHOS_DA_CASA) {
    if (!(await existeEm(consultar, "public", tabela))) {
      return {
        ...vazio,
        motivo: `${tabela} não existe em public — nada a repor.`,
      };
    }
    if (!(await existeEm(consultar, "drizzle", espelho))) {
      return { ...vazio, motivo: `não há espelho de ${tabela} para repor.` };
    }
  }

  let noEspelho = 0;
  for (const { tabela, espelho } of ESPELHOS_DA_CASA) {
    if ((await quantasLinhas(consultar, "public", tabela)) !== 0) {
      return {
        ...vazio,
        motivo: `${tabela} tem linha — a decisão da casa está onde deveria estar.`,
      };
    }
    noEspelho += await quantasLinhas(consultar, "drizzle", espelho);
  }

  if (noEspelho === 0) {
    return {
      ...vazio,
      motivo: "esta casa nunca desligou nada — nada a repor.",
    };
  }

  const repostas: Array<{ tabela: string; linhas: number }> = [];
  for (const { tabela, espelho } of ESPELHOS_DA_CASA) {
    const doEspelho = await colunasDe(consultar, "drizzle", espelho);
    const daTabela = await colunasDe(consultar, "public", tabela);
    const soNoEspelho = doEspelho.filter((c) => !daTabela.includes(c));
    const soNaTabela = daTabela.filter((c) => !doEspelho.includes(c));
    if (soNoEspelho.length > 0 || soNaTabela.length > 0) {
      throw new Error(
        `"${tabela}" mudou de forma e o espelho da decisão da casa não sabe encaixar: ` +
          `${soNoEspelho.length > 0 ? `só no espelho: ${soNoEspelho.join(", ")}. ` : ""}` +
          `${soNaTabela.length > 0 ? `só na tabela: ${soNaTabela.join(", ")}. ` : ""}` +
          `A decisão continua guardada em drizzle."${espelho}".`,
      );
    }

    const colunas = doEspelho.map((c) => `"${c}"`).join(", ");
    await consultar(
      `INSERT INTO "public"."${tabela}" (${colunas}) SELECT ${colunas} FROM "drizzle"."${espelho}"`,
    );
    repostas.push({
      tabela,
      linhas: await quantasLinhas(consultar, "public", tabela),
    });
  }

  return {
    repos: true,
    motivo:
      "as duas tabelas da decisão da casa voltaram vazias com espelho cheio — " +
      "estrutura recriada por fora da fila, conteúdo reposto.",
    linhas: repostas,
  };
}

/**
 * O que a partida chama: repõe primeiro, garante o espelho depois.
 *
 * A ordem é a única possível, e o motivo está em `garantirEspelhoDaCasa`:
 * garantir antes de repor, numa partida logo após a perda, criaria o espelho a
 * partir de um `public` já vazio.
 */
export async function protegerDecisaoDaCasa(consultar: Consulta): Promise<{
  reposicao: ReposicaoDaDecisaoDaCasa;
  espelhosCriados: string[];
}> {
  const reposicao = await reporDecisaoDaCasa(consultar);
  const espelhosCriados = await garantirEspelhoDaCasa(consultar);
  return { reposicao, espelhosCriados };
}

/**
 * A porta de entrada da partida — abre a conexão, faz tudo numa transação só.
 *
 * Transação porque a reposição são dois `INSERT … SELECT` e uma condição lida
 * antes deles: metade reposta é um estado que ninguém saberia ler, e o produto
 * inteiro passaria a descrever uma casa que nunca existiu.
 *
 * `max: 1` e conexão própria, como a reconvergência e a fila: este caminho roda
 * na partida, antes de o pool do processo existir, e não divide teto com o
 * tráfego do produto.
 */
export async function protegerDecisaoDaCasaNoBanco(
  connectionString: string,
): Promise<{ reposicao: ReposicaoDaDecisaoDaCasa; espelhosCriados: string[] }> {
  const pool = new pg.Pool({ connectionString, max: 1 });
  const cliente = await pool.connect();
  try {
    await cliente.query("BEGIN");
    const resultado = await protegerDecisaoDaCasa(async (texto) => {
      const { rows } = await cliente.query(texto);
      return rows as Record<string, unknown>[];
    });
    await cliente.query("COMMIT");
    return resultado;
  } catch (erro) {
    await cliente.query("ROLLBACK").catch(() => {});
    throw erro;
  } finally {
    cliente.release();
    await pool.end();
  }
}
