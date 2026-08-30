import { sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import { PARES_DE_CONJUNTO } from "./composition";

/**
 * Quem estava com quem, **em cada vigência** — a composição do conjunto no tempo.
 *
 * `vinculos.ts` já lê este mesmo vínculo, e para outra coisa: lá a pergunta é
 * "que coluna da carreta embute o cavalo?", e a resposta só precisa do par como
 * um índice sem data. Aqui a data é o assunto. Uma carreta troca de cavalo entre
 * maio e junho — medido: 5 dos 64 cavalos do export real trocaram em maio/2026 —
 * e uma leitura que usasse "o par de hoje" para montar a matriz de janeiro
 * atribuiria o histórico ao conjunto errado, calado.
 *
 * ---------------------------------------------------------------------------
 * A chave de uma composição
 * ---------------------------------------------------------------------------
 * O conjunto **não é entidade** e não tem identificador próprio (ver
 * `tipos.ts`): ele é o par, declarado na linha do cavalo pela placa da carreta.
 * Então a chave é o par de ids — `cavalo|carreta` —, e ela é deliberadamente
 * **sensível à troca**: quando o cavalo passa a puxar outra carreta, o que
 * existe são dois conjuntos, e a matriz mostra duas linhas. Tratar os dois como
 * a mesma composição histórica esconderia exatamente o que esta aba existe para
 * mostrar.
 *
 * Um lado sozinho também é uma composição — `cavalo|` ou `|carreta`. Não é
 * elegância: é o que faz a soma fechar. Se o ativo sem par ficasse de fora, o
 * total da aba Conjunto seria menor que o das abas Cavalo e Carreta, e ninguém
 * saberia dizer por quanto. Na vigência mais recente do acervo real são 9
 * carretas sem cavalo.
 *
 * ---------------------------------------------------------------------------
 * A ambiguidade, e por que ela recusa em vez de escolher
 * ---------------------------------------------------------------------------
 * O vínculo é dado do cliente, não invariante nosso. Se dois cavalos declararem
 * a **mesma** carreta na mesma vigência, o dinheiro daquela carreta pertenceria
 * a dois conjuntos — e somar os dois contaria a carreta duas vezes, que é
 * precisamente o defeito que esta aba não pode ter. Então a leitura **desfaz o
 * par** dos envolvidos naquela vigência (cada um vira um lado sozinho) e devolve
 * a ocorrência em {@link ComposicaoDoIntervalo.ambiguidades}, para a tela dizer
 * o que aconteceu em vez de escolher um vencedor em silêncio.
 *
 * Medido no acervo real: **zero ocorrências** nas 9 vigências. A guarda existe
 * porque "hoje não acontece" e "não pode acontecer" são afirmações diferentes.
 *
 * ---------------------------------------------------------------------------
 * A dívida herdada, dita por extenso
 * ---------------------------------------------------------------------------
 * A placa é resolvida em entidade pelo identificador **corrente**
 * (`entity_identifier.is_current`), que é o que `vinculos.ts` e
 * `tipos-da-vigencia.ts` já fazem. Isso é uma dívida conhecida e registrada em
 * `docs/DIVIDA-VINCULO-DO-CONJUNTO.md`: no dia em que um reemplacamento fechar
 * um identificador, a resolução histórica muda retroativamente. Ela **não** é
 * consertada aqui de propósito — corrigi-la é mudar a semântica de três
 * leituras ao mesmo tempo, e esta aba não é o lugar de tomar essa decisão
 * sozinha. O que esta leitura não faz é criar uma quarta regra: ela usa a mesma
 * que o resto do produto usa, e a dívida continua com um endereço só.
 */

/** Um par observado numa vigência. Um dos lados pode faltar. */
export interface ComposicaoNaVigencia {
  period: string;
  /** `cavalo|carreta`, com o lado ausente vazio. É a chave da linha da matriz. */
  chave: string;
  cavaloId: string | null;
  carretaId: string | null;
}

/** Dois cavalos disputando a mesma carreta na mesma vigência. */
export interface AmbiguidadeDeComposicao {
  period: string;
  /** A placa do equipamento declarado, como ela veio no arquivo. */
  declarado: string;
  /** Quantos declarantes a reivindicaram. */
  declarantes: number;
}

export interface ComposicaoDoIntervalo {
  /** A composição de cada ativo, por vigência: `entityId|period` → chave do par. */
  chavePorAtivo: Map<string, string>;
  /** Todas as composições observadas, por vigência. */
  composicoes: ComposicaoNaVigencia[];
  /** Em quantas vigências cada par apareceu junto — o "4 de 5" do painel. */
  vigenciasJuntos: Map<string, number>;
  ambiguidades: AmbiguidadeDeComposicao[];
}

const chaveDoPar = (cavaloId: string | null, carretaId: string | null): string =>
  `${cavaloId ?? ""}|${carretaId ?? ""}`;

export const chaveDaComposicao = chaveDoPar;

/**
 * As composições das vigências informadas.
 *
 * `snapshotsPorPeriodo` é a data de cada snapshot que a janela leu — a
 * composição é lida no snapshot que a comparação **explica** (o lado B), que é
 * a vigência em que a matriz desenha a célula.
 *
 * Uma consulta só, com `ANY(...)`: uma por vigência seria o N+1 que uma matriz
 * de oito colunas transformaria em oito idas ao banco para responder o que uma
 * responde.
 */
export async function carregarComposicoes(
  db: Pick<Database, "execute">,
  /**
   * Os snapshots de cada vigência, e o papel de cada um.
   *
   * `DESTINO` é o lado B — o snapshot que a comparação explica, e a composição
   * que a célula representa. `ORIGEM` é o lado A, e entra **só** para os ativos
   * que não estão no destino: um ativo removido na vigência tem linha de
   * alteração e nenhum fato do lado B, e sem a origem ele cairia num par
   * sozinho que ninguém observou. A precedência é sempre do destino — quando o
   * par mudou entre as duas pontas, a composição da vigência é a de chegada.
   */
  snapshotsPorPeriodo: {
    snapshotId: string;
    period: string;
    papel?: "DESTINO" | "ORIGEM";
  }[],
): Promise<ComposicaoDoIntervalo> {
  const vazio: ComposicaoDoIntervalo = {
    chavePorAtivo: new Map(),
    composicoes: [],
    vigenciasJuntos: new Map(),
    ambiguidades: [],
  };
  if (snapshotsPorPeriodo.length === 0 || PARES_DE_CONJUNTO.length === 0) return vazio;

  const par = PARES_DE_CONJUNTO[0]!;
  /*
    A lista de snapshots é escrita à mão, e não por `inArray(factTable...)`: o
    query builder qualificaria a coluna como `"fact"."snapshot_id"`, e esta
    consulta lê a **view** `fato_visivel` com o alias `f`. Foi o que
    `vinculos.ts` resolveu chamando o alias de `"fact"`; aqui há dois `FROM` da
    view e um alias emprestado esconderia qual deles a cláusula recorta.
  */
  const snapshotIds = [...new Set(snapshotsPorPeriodo.map((s) => s.snapshotId))];
  const dosSnapshots = sql`f.snapshot_id IN (${sql.join(
    snapshotIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
  /*
    O mesmo snapshot é destino de uma vigência e origem da seguinte — 2026-05-02
    explica maio e é o ponto de partida de junho. Por isso a precedência é por
    **(snapshot, vigência)**, e não por snapshot: indexá-la só pelo id fazia a
    entrada de abril contar como destino de maio, e a composição de maio saía a
    de abril, sem nada quebrar. Foi o defeito que a leitura contra o export real
    pegou — a troca de carreta aparecia uma vigência atrasada.
  */
  const entradas = [...snapshotsPorPeriodo].sort((a, b) => {
    const peso = (papel?: string) => (papel === "ORIGEM" ? 1 : 0);
    return peso(a.papel) - peso(b.papel) || a.period.localeCompare(b.period);
  });

  const { rows: declaracoes } = await db.execute<{
    snapshot_id: string;
    declarante_id: string;
    declarado_texto: string;
    declarado_id: string | null;
  }>(sql`
    SELECT f.snapshot_id::text  AS snapshot_id,
           f.entity_id::text    AS declarante_id,
           f.value_text         AS declarado_texto,
           declarado.entity_id::text AS declarado_id
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id AND a.code = ${par.code}
      JOIN entity_identifier declarado
        ON declarado.identifier_type = 'PLACA'
       AND declarado.is_current
       AND declarado.identifier_value = f.value_text
      JOIN entity e
        ON e.id = declarado.entity_id AND e.entity_type = ${par.declarado}
     WHERE ${dosSnapshots}
       AND NOT f.is_null
       AND f.value_text IS NOT NULL
  `);

  const { rows: presentes } = await db.execute<{
    snapshot_id: string;
    entity_id: string;
    entity_type: string;
  }>(sql`
    SELECT DISTINCT f.snapshot_id::text AS snapshot_id,
           f.entity_id::text            AS entity_id,
           e.entity_type
      FROM fato_visivel f
      JOIN entity e ON e.id = f.entity_id
     WHERE ${dosSnapshots}
       AND e.entity_type IN (${par.declarante}, ${par.declarado})
  `);

  const declaracoesDe = new Map<string, typeof declaracoes>();
  for (const linha of declaracoes) {
    const lista = declaracoesDe.get(linha.snapshot_id) ?? [];
    lista.push(linha);
    declaracoesDe.set(linha.snapshot_id, lista);
  }
  const presentesDe = new Map<string, typeof presentes>();
  for (const linha of presentes) {
    const lista = presentesDe.get(linha.snapshot_id) ?? [];
    lista.push(linha);
    presentesDe.set(linha.snapshot_id, lista);
  }

  // ---- a guarda de ambiguidade, sobre o destino de cada vigência -----------
  const ambiguidades: AmbiguidadeDeComposicao[] = [];
  const disputados = new Set<string>();
  for (const entrada of entradas) {
    if (entrada.papel === "ORIGEM") continue;
    const porDeclarado = new Map<string, { declarantes: Set<string>; texto: string }>();
    for (const linha of declaracoesDe.get(entrada.snapshotId) ?? []) {
      if (linha.declarado_id === null) continue;
      const atual =
        porDeclarado.get(linha.declarado_id) ??
        { declarantes: new Set<string>(), texto: linha.declarado_texto };
      atual.declarantes.add(linha.declarante_id);
      porDeclarado.set(linha.declarado_id, atual);
    }
    for (const [declaradoId, { declarantes, texto }] of porDeclarado) {
      if (declarantes.size <= 1) continue;
      disputados.add(`${entrada.period}|${declaradoId}`);
      ambiguidades.push({
        period: entrada.period,
        declarado: texto,
        declarantes: declarantes.size,
      });
    }
  }

  // ---- o par de cada ativo, por vigência -----------------------------------
  const chavePorAtivo = new Map<string, string>();
  const composicoes: ComposicaoNaVigencia[] = [];

  for (const entrada of entradas) {
    for (const linha of declaracoesDe.get(entrada.snapshotId) ?? []) {
      if (linha.declarado_id === null) continue;
      if (disputados.has(`${entrada.period}|${linha.declarado_id}`)) continue;
      /*
        A origem só preenche o que o destino não preencheu — e por isso as
        entradas já vêm ordenadas. Sem isso, o lado A sobrescreveria a
        composição de chegada e a matriz mostraria o par do mês anterior na
        coluna do mês.
      */
      if (chavePorAtivo.has(`${linha.declarante_id}|${entrada.period}`)) continue;
      if (chavePorAtivo.has(`${linha.declarado_id}|${entrada.period}`)) continue;

      const chave = chaveDoPar(linha.declarante_id, linha.declarado_id);
      chavePorAtivo.set(`${linha.declarante_id}|${entrada.period}`, chave);
      chavePorAtivo.set(`${linha.declarado_id}|${entrada.period}`, chave);
      composicoes.push({
        period: entrada.period,
        chave,
        cavaloId: linha.declarante_id,
        carretaId: linha.declarado_id,
      });
    }
  }

  /*
    Quem ficou sem par na vigência entra como um lado sozinho. É o que mantém a
    partição total: todo ativo presente pertence a exatamente uma composição
    naquela vigência, e por isso somar as composições dá o mesmo que somar os
    ativos.
  */
  for (const entrada of entradas) {
    for (const p of presentesDe.get(entrada.snapshotId) ?? []) {
      if (chavePorAtivo.has(`${p.entity_id}|${entrada.period}`)) continue;
      const cavaloId = p.entity_type === par.declarante ? p.entity_id : null;
      const carretaId = p.entity_type === par.declarado ? p.entity_id : null;
      const chave = chaveDoPar(cavaloId, carretaId);
      chavePorAtivo.set(`${p.entity_id}|${entrada.period}`, chave);
      composicoes.push({ period: entrada.period, chave, cavaloId, carretaId });
    }
  }

  composicoes.sort(
    (a, b) => a.period.localeCompare(b.period) || a.chave.localeCompare(b.chave),
  );

  /*
    "Vigências juntos" conta vigências, e não linhas: um par lido no destino e
    também na origem da mesma vigência é uma vigência, não duas.
  */
  const vigenciasJuntos = new Map<string, number>();
  for (const composicao of composicoes) {
    const vistas = vigenciasJuntos.get(composicao.chave) ?? 0;
    vigenciasJuntos.set(composicao.chave, vistas);
  }
  for (const chave of vigenciasJuntos.keys()) {
    vigenciasJuntos.set(
      chave,
      new Set(composicoes.filter((c) => c.chave === chave).map((c) => c.period)).size,
    );
  }

  return {
    chavePorAtivo,
    composicoes,
    vigenciasJuntos,
    ambiguidades: ambiguidades.sort(
      (a, b) => a.period.localeCompare(b.period) || a.declarado.localeCompare(b.declarado),
    ),
  };
}
