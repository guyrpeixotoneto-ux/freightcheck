/**
 * De quem é a pré-condição "as comparações necessárias existem".
 *
 * **O estado que este arquivo interroga.** `change` e `change_set` são estado
 * derivado: eles nascem de `computeChangeSet`. Um banco pode ter snapshots
 * válidos, fatos importados, semântica confirmada — e nenhuma comparação
 * materializada. A leitura desse banco devolve zero, e zero é indistinguível de
 * "esta vigência não mudou nada".
 *
 * **Por que isso é uma pergunta de arquitetura e não um detalhe.** Porque a
 * resposta muda conforme quem pergunta. Até esta mudança, sete lugares criavam
 * o estado derivado por conta própria — a promoção de uma importação, dois
 * endpoints de tela, a ficha de composição, a série consolidada, um CLI, e a
 * orquestração do planejador — e nenhum deles era o dono. O agente nunca
 * garantiu nada: ele recebia a garantia de carona, porque `responder` orquestra
 * antes de investigar. No dia em que o planejador saísse — que é o destino
 * desta migração — o agente perderia a pré-condição num diff que não fala de
 * comparações.
 *
 * Não é hipótese. A auditoria de integridade Tool→Evidência chama as
 * ferramentas direto, sem passar por `responder`, e viveu esse futuro: dezessete
 * casos aprovados sobre conteúdo vazio, e um relatório de "16 de 18 ferramentas
 * íntegras" que na verdade era 12.
 *
 * **O que se prova aqui**, e é o teste negativo que o desenho pedia: num banco
 * com snapshots e fatos válidos e **sem** estado derivado materializado, os dois
 * caminhos não podem divergir só porque foram chamados por portas diferentes. E
 * o caminho que ninguém reparou não pode devolver zero com cara de resposta.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getGroupedView, listContexts } from "@workspace/comparison";
import type { Database } from "@workspace/db";
import { alteracoes } from "../ferramentas/alteracoes";
import { resolverContexto, resumoDaVigencia } from "../ferramentas";
import { responder } from "../resposta";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

comBanco("a pré-condição das comparações tem um dono só", () => {
  let db: Database;
  let banco: Awaited<
    ReturnType<typeof import("@workspace/comparison/testing").criarBancoComModelosCurados>
  >;
  let recorte: { scopeHash: string; channel: string | null };
  let vigencia: string;
  let anterior: string;

  /**
   * O banco nasce **real e completo**, e só então perde o estado derivado.
   *
   * Montar snapshots à mão daria o mesmo vazio com menos fidelidade: o que se
   * quer reproduzir não é um banco pequeno, é o banco de verdade no estado em
   * que ninguém rodou a comparação — que é como um restore, um seed, ou uma
   * importação cuja promoção não terminou o deixam. Apagar `change` e
   * `change_set` de uma base curada produz exatamente isso, e nada mais.
   */
  beforeAll(async () => {
    const { criarBancoComModelosCurados } = await import("@workspace/comparison/testing");
    banco = await criarBancoComModelosCurados("precondicao_comparacoes");
    db = banco.db;

    await db.execute(sql`DELETE FROM change`);
    await db.execute(sql`DELETE FROM change_set`);

    const contextos = await listContexts(db);
    const ctx = contextos[0]!;
    recorte = { scopeHash: ctx.scopeHash, channel: ctx.channel };

    const { rows } = await db.execute<{ d: string }>(sql`
      SELECT DISTINCT effective_date::text AS d
        FROM snapshot WHERE status <> 'SUPERSEDED'
       ORDER BY d DESC LIMIT 2
    `);
    vigencia = rows[0]!.d;
    anterior = rows[1]!.d;
  }, 300_000);

  afterAll(async () => {
    await banco?.drop();
  });

  /**
   * A premissa. Se ela cair, todo o resto deste arquivo passa por acidente.
   */
  it("o banco tem snapshot e fato, e nenhuma comparação materializada", async () => {
    const conta = async (tabela: string) => {
      const { rows } = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.raw(tabela)}`,
      );
      return rows[0]!.n;
    };

    expect(await conta("snapshot"), "sem snapshot não há o que comparar").toBeGreaterThan(0);
    expect(await conta("fact"), "sem fato o vazio seria legítimo").toBeGreaterThan(0);
    expect(await conta("change_set"), "o fixture não pode ter comparado").toBe(0);
    expect(await conta("change")).toBe(0);
  });

  /**
   * A leitura declara o estado em vez de devolver zero — a correção que torna
   * honesto todo caminho que não reparou o banco antes de ler.
   */
  it("`getGroupedView` distingue «não comparada» de «não mudou»", async () => {
    const visao = await getGroupedView(db, vigencia, recorte);

    expect(visao, "o recorte existe; a visão não deveria ser nula").not.toBeNull();
    expect(visao!.totals.changes, "sem comparação materializada, não há alteração lida").toBe(0);
    expect(
      visao!.comparacao,
      "zero alterações e nenhuma comparação são estados opostos, e a leitura tem de " +
        "dizer qual dos dois é — foi por não dizer que o assistente respondeu «sem " +
        "alterações neste recorte» num banco com 124 mil fatos",
    ).toBe("NAO_MATERIALIZADA");
  });

  /**
   * O caso que dá nome ao arquivo: a ferramenta chamada **fora** de `responder`
   * — como a auditoria a chama, e como qualquer CLI ou teste a chamaria.
   */
  it("a ferramenta chamada direto recusa-se a devolver zero com cara de resposta", async () => {
    const r = await alteracoes.executar({ db, recorte }, { nivel: "total" });
    const c = r.conteudo as Record<string, unknown>;

    expect(
      typeof c.erro === "string",
      "sem a garantia, esta chamada devolvia `{changes: 0, groups: 0}` — material " +
        "suficiente para o modelo escrever «nada mudou nesta vigência» sobre uma " +
        "comparação que não existe",
    ).toBe(true);
    expect(String(c.erro)).toMatch(/não foi comparada|não significa que nada mudou/i);
    expect(r.evidencias, "uma falha declarada não autoriza citar número nenhum").toEqual([]);
  });

  /**
   * **`resumoDaVigencia`, nomeadamente** — e não por cobertura indireta.
   *
   * Esta é a função do caminho determinístico que responde "o que mudou nesta
   * vigência?", e era a última leitura silenciosa de estado derivado. O campo
   * `comparacao` sempre esteve disponível para ela: `FamiliesView extends
   * GroupedView` e `getFamiliesView` devolve `{...view}`. Propagava e ninguém
   * lia — que é o que acontece quando a condição excepcional mora num campo
   * opcional, e a sétima função é escrita copiando a sexta.
   *
   * O que se exige aqui é o oposto exato do defeito: sobre um banco sem
   * comparação materializada, a função **não pode** devolver o fato
   * "Alterações: 0". Ou ela declara a pendência, ou ela mente com a fonte ao
   * lado — não há terceira saída, e é por isso que este caso não se contenta
   * com "não retornou null".
   */
  it("`resumoDaVigencia` declara a pendência em vez de relatar «Alterações: 0»", async () => {
    const ctx = await resolverContexto(db, recorte);
    expect(ctx, "o recorte precisa resolver para a função ser exercitada").toBeTruthy();

    const e = await resumoDaVigencia(db, ctx!);

    expect(
      e,
      "devolver `null` seria silêncio: quem chama não distingue «não há recorte» de " +
        "«a comparação não foi calculada», e o dossiê segue sem dizer nada a ninguém",
    ).not.toBeNull();

    const alteracoes = e!.fatos.find((f) => f.rotulo === "Alterações");
    expect(
      alteracoes,
      "este é o defeito, escrito por extenso: um fato «Alterações: 0» sobre uma " +
        "comparação que nunca aconteceu é a pior resposta que este produto pode dar — " +
        "errada, fluente e indistinguível de uma certa",
    ).toBeUndefined();

    const estado = e!.fatos.find((f) => f.rotulo === "Estado da comparação");
    expect(estado?.valor, "a pendência tem de estar dita no fato").toMatch(/não calculada/i);
    expect(e!.numeros, "não há número a citar sobre uma comparação que não existe").toEqual([]);
    expect(e!.nota, "e a instrução de não concluir ausência precisa chegar a quem redige")
      .toMatch(/não conclua que nada mudou/i);
  });

  /**
   * O outro lado do mesmo campo: comparação **existente** com zero alterações é
   * uma resposta legítima, e não pode ser confundida com a pendência.
   *
   * Sem este caso, a correção poderia ter sido "declarar pendência sempre que
   * `changes === 0`" — que troca um erro por outro e faz o assistente recusar-se
   * a dizer "nada mudou" justamente quando nada mudou.
   */
  it("comparação existente com zero alterações continua sendo resposta, não pendência", async () => {
    const { rows } = await db.execute<{ d: string }>(sql`
      SELECT min(effective_date)::text AS d FROM snapshot WHERE status <> 'SUPERSEDED'
    `);
    const visao = await getGroupedView(db, rows[0]!.d, recorte);

    expect(visao!.totals.changes, "a primeira vigência não tem movimento a relatar").toBe(0);
    expect(
      visao!.comparacao,
      "ela não tem anterior com que comparar; nada está pendente, e chamar isto de " +
        "pendência faria o aviso aparecer para sempre no começo de todo histórico",
    ).toBe("SEM_ALTERACOES");
  });

  /**
   * **O teste negativo pedido.** Os dois caminhos, a mesma pergunta, o mesmo
   * banco — e nenhuma diferença semântica que venha só da porta de entrada.
   *
   * Roda sem chave de modelo de propósito: com `semIa`, os dois caminhos usam a
   * redação determinística sobre o material que cada um juntou, e o que se
   * compara é o **material**, não a prosa. Uma diferença aqui é diferença de
   * realidade, e é a única coisa que este caso quer poder ver.
   */
  it("planejador e agente enxergam a mesma realidade — a garantia é de quem os chama", async () => {
    const comum = { recorte, semIa: true as const, diagnostico: true as const };

    const planejador = await responder(db, "o que mudou nesta vigência?", {
      ...comum,
      agente: false,
    });

    /*
      Depois da primeira chamada o banco **já está reparado** — a garantia é
      idempotente e roda uma vez. É de propósito: o que se quer provar é que os
      dois veem o mesmo, e não que cada um repara por conta própria. Reparar
      duas vezes seria o desenho que este arquivo rejeita.
    */
    const agente = await responder(db, "o que mudou nesta vigência?", {
      ...comum,
      agente: true,
    });

    const comparadoAgora = await getGroupedView(db, vigencia, recorte);
    expect(
      comparadoAgora!.comparacao,
      "quem chama reparou o banco — é esse o dono da pré-condição",
    ).toBe("COM_ALTERACOES");
    expect(comparadoAgora!.totals.changes).toBeGreaterThan(0);

    /*
      A afirmação que interessa não é sobre texto: é sobre existir material. Uma
      resposta que declara lacuna e outra que descreve alterações são
      semanticamente diferentes, e era essa a divergência possível.
    */
    for (const [nome, r] of [["planejador", planejador], ["agente", agente]] as const) {
      expect(
        r.tecnico.contexto.fatos,
        `o caminho ${nome} respondeu sem fato nenhum — a pré-condição não chegou até ele`,
      ).toBeGreaterThan(0);
    }
  }, 120_000);
});
