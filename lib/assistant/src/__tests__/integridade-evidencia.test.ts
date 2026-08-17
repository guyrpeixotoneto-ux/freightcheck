/**
 * A invariável: **conteúdo utilizável ⊆ evidência autorizada.**
 *
 * Todo número que uma ferramenta mostra ao modelo tem de estar autorizado pela
 * `Evidencia` daquela chamada. Não é preferência de estilo — é a condição para o
 * agente conseguir publicar o que ele legitimamente descobriu.
 *
 * **O defeito que isto mede.** Na primeira rodada real do PR 7 o agente
 * investigou bem — encadeou até onze consultas, cruzou alterações com semântica,
 * separou fato de leitura — e **nenhuma resposta saiu limpa**: três descartadas,
 * cinco podadas. Os números que a trava recusou eram corretos e vinham das
 * próprias ferramentas: `43%`, `749 valores`, `20 grupos`, o tamanho da frota.
 * O modelo lia `conteudo`, que é rico, e a trava conferia contra
 * `evidencias.numeros`, que é um subconjunto.
 *
 * Não é o modelo inventando. É a ferramenta mostrando sem autorizar — e o
 * conserto é enriquecer a evidência na origem, nunca abrir exceção na trava.
 *
 * **Por que um teste e não uma auditoria à mão.** Porque a lacuna é por campo, e
 * um campo novo numa ferramenta reintroduz o defeito sem que nada acuse. Aqui a
 * conferência é a mesma que a trava faz, sobre a mesma extração de tokens, e ela
 * roda a cada commit.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { getGroupedView } from "@workspace/comparison";
import { executar, registroPadrao } from "../ferramentas/registro";
import type { ChamadaDeFerramenta, ContextoDaFerramenta } from "../ferramentas/registro";

const url = process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;
const comBanco = url ? describe : describe.skip;

/**
 * Os tokens numéricos de um texto — a mesma extração que `numerosSemLastro` faz.
 *
 * Reimplementá-la aqui seria criar uma segunda verdade sobre o que conta como
 * número; o que se faz é usar a mesma forma, para que passar neste teste
 * signifique passar na trava.
 */
function numerosDe(texto: string): string[] {
  return texto.match(/\d[\d.,]*/g) ?? [];
}

/** Tudo o que a evidência de uma chamada autoriza citar. */
function autorizados(chamada: ChamadaDeFerramenta): Set<string> {
  const set = new Set<string>();
  const registrar = (v: unknown) => {
    if (v === null || v === undefined) return;
    for (const t of numerosDe(String(v))) {
      set.add(t);
      set.add(t.replace(/\./g, ""));
    }
  };

  for (const e of chamada.evidencias) {
    registrar(e.titulo);
    registrar(e.nota);
    registrar(e.origem);
    for (const n of e.numeros) {
      registrar(n);
      registrar(Math.abs(n));
      registrar(n.toLocaleString("pt-BR"));
      registrar(n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
      registrar(Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
    }
    for (const f of e.fatos) {
      registrar(f.rotulo);
      registrar(f.valor);
      registrar(f.detalhe);
    }
    if (e.recorte) {
      registrar(e.recorte.vigencia);
      registrar(e.recorte.intervalo);
      registrar(e.recorte.contexto);
    }
  }
  return set;
}

/**
 * Os números que o modelo vê no conteúdo e não pode citar.
 *
 * Um algarismo isolado fica de fora pela mesma razão que a trava o ignora: ele é
 * numeração de lista ou ordinal, não afirmação. Datas em `AAAA-MM-DD` também —
 * a trava tem tratamento próprio para elas.
 */
function semLastro(chamada: ChamadaDeFerramenta): string[] {
  const permitidos = autorizados(chamada);

  /*
    A extração percorre os **valores**, e não a serialização.

    Rodar a expressão sobre `JSON.stringify` parecia equivalente e não é: em
    `{"impacto":0,"grupos":20}` o `[\d.,]*` engole a vírgula estrutural e produz
    o token `0,`, que não existe em lugar nenhum e reprova a ferramenta por um
    defeito do medidor. A trava roda sobre texto redigido, onde vírgula é
    decimal; aqui a fonte é uma árvore, e ela precisa ser percorrida como tal.
  */
  /*
    E o número é lido pela mesma expressão, e não pela sua serialização.

    `String(-7700.16)` é `"-7700.16"`, e a trava jamais produz esse token: a
    expressão dela começa em `\d`, então o que ela vê num texto redigido é
    `7700.16`. Empurrar a forma com sinal para a comparação acusava de órfão
    exatamente os impactos negativos que a evidência já autorizava — e quase
    fez remendar quatro ferramentas sadias.

    A regra vale para os dois lados da conferência: só entra como token o que a
    expressão da trava consegue extrair.
  */
  const vistos: string[] = [];
  const andar = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (typeof v === "number") {
      vistos.push(
        ...numerosDe(String(v)),
        ...numerosDe(Math.abs(v).toLocaleString("pt-BR")),
      );
      return;
    }
    if (typeof v === "string") {
      // Datas em AAAA-MM-DD são referência de tempo; a trava as trata à parte.
      const tokens = numerosDe(v.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " "));
      vistos.push(...tokens);
      /*
        ---- e a forma em que uma pessoa escreveria cada decimal --------------

        Aqui morava o buraco que fez esta auditoria dar 20/20 sobre um defeito
        que quebrou sete das nove perguntas da bateria real.

        Um decimal dentro de uma string chega cru do banco: `"2.19 → 0"`. A
        auditoria extraía `2.19`, encontrava `2.19` autorizado, e aprovava. Mas
        a trava não confere o conteúdo — confere o **texto redigido**, e o texto
        é em português: o modelo escreve `2,19`. As duas medições nunca se
        encontravam, e a que valia era a que ninguém estava rodando.

        **Só decimais crus, e a precisão importa.** A primeira tentativa aqui
        converteu todo token, lendo-o como pt-BR — e produziu fantasmas: `2.19`
        virou `219,00` e o ano `2026` virou `2.026,00`, números que ninguém
        jamais escreveria. Um medidor que inventa o que acusa é o defeito que
        este arquivo já cometeu duas vezes.

        `\d+\.\d{1,2}` é a forma inequívoca: ponto seguido de uma ou duas casas
        é decimal cru do banco, nunca separador de milhar. Inteiros ficam de
        fora porque são escritos como estão, e tokens que já trazem vírgula
        ficam de fora porque já estão em português.

        Conferir isto não afrouxa nada — o número continua tendo de estar
        autorizado. O que muda é a auditoria perguntar o que a trava pergunta,
        em vez de uma versão mais fácil da mesma pergunta.
      */
      for (const t of tokens) {
        if (!/^\d+\.\d{1,2}$/.test(t)) continue;
        const n = Number(t);
        if (!Number.isFinite(n)) continue;
        vistos.push(
          n.toLocaleString("pt-BR"),
          n.toLocaleString("pt-BR", { minimumFractionDigits: 2 }),
        );
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const i of v) andar(i);
      return;
    }
    if (typeof v === "object") for (const i of Object.values(v)) andar(i);
  };
  andar(chamada.conteudo);

  return [
    ...new Set(
      vistos.filter(
        (t) => t.length > 1 && !permitidos.has(t) && !permitidos.has(t.replace(/\./g, "")),
      ),
    ),
  ];
}

/**
 * As chamadas que a auditoria percorre.
 *
 * Uma por eixo relevante de cada ferramenta, e não uma por ferramenta: o defeito
 * mora nos campos que só aparecem em certos níveis — `gruposNoTotal` e
 * `posicaoNaFila` só existem em `nivel: "grupos"`, e `linhasNoTotal` só em
 * `"linhas"`. Auditar só o caminho mais simples é como o buraco passou pelo
 * teste do PR 5.
 */
const CHAMADAS: [string, Record<string, unknown>][] = [
  ["alteracoes", { nivel: "total" }],
  ["alteracoes", { nivel: "grupos", limite: 5 }],
  ["alteracoes", { nivel: "grupos", ordenarPor: "impacto", limite: 5 }],
  ["alteracoes", { nivel: "grupos", equipamento: "CAVALO", limite: 5 }],
  ["alteracoes", { nivel: "linhas", atributo: "cavalo.manutencao_reais_km", limite: 5 }],
  ["recortes", {}],
  ["parametros", { busca: "ipva", limite: 5 }],
  ["comparar", {}],
  ["ordenacao", { por: "criticidade" }],
  ["ordenacao", { por: "dinheiro", sentido: "perda" }],
  ["veiculos", {}],
  ["resultado", {}],
  ["documentos", { busca: "combustível" }],
  ["documentos", { busca: "combustível", bloco: "combustível" }],
  ["estado_do_dado", { aspecto: "curadoria" }],
  ["estado_do_dado", { aspecto: "panorama" }],
  ["estado_do_dado", { aspecto: "sem_preco" }],
  ["estado_do_dado", { aspecto: "importacoes" }],
  ["estado_do_dado", { aspecto: "balanco" }],
];

comBanco("integridade Tool → Evidência", () => {
  let ctx: ContextoDaFerramenta;
  let banco: Awaited<
    ReturnType<typeof import("@workspace/comparison/testing").criarBancoComModelosCurados>
  >;
  const registro = registroPadrao();

  /**
   * A auditoria tem **banco próprio**, e a razão não é higiene.
   *
   * Esta suíte já deu verde falso uma vez, e não por falta de asserção: rodou
   * num banco cujas comparações derivadas nunca haviam sido materializadas,
   * `alteracoes` devolveu `{gruposNoTotal: 0, grupos: []}` com `erro: null` —
   * sucesso legítimo, conteúdo vazio — e os quatro casos que mais importam
   * passaram sem conferir nada. O relatório disse "16 de 18". Com o dado no
   * lugar, eram 12.
   *
   * O banco compartilhado não conserta isso, porque o problema não é o estado
   * inicial: é o estado **mudar durante a medição**. A suíte `fase1` apaga
   * `change` e `change_set` de propósito, para provar outra coisa, e os
   * arquivos rodam em paralelo. Medida assim, esta auditoria oscila entre 20 de
   * 20 e falhas em ferramentas sadias — já aconteceu, com um `2026` de rótulo
   * de vigência acusado de órfão porque a vigência lida deixou de ser a mesma
   * no meio do caso.
   *
   * Um instrumento cuja leitura depende de quem mais está no laboratório não
   * mede o que diz medir. Este clona a base curada e responde só por ela.
   */
  beforeAll(async () => {
    const { criarBancoComModelosCurados } = await import("@workspace/comparison/testing");
    banco = await criarBancoComModelosCurados("integridade_evidencia");
    const db: Database = banco.db;
    ctx = { db, recorte: {} };

    /*
      E a pré-condição conferida, não suposta. Se a fixture mudar e deixar de
      produzir comparação, a suíte inteira falha aqui — em vez de vinte casos
      passarem sobre o nada, que é como o defeito se apresentou da primeira vez.
    */
    const visao = await getGroupedView(db, undefined, {});
    expect(visao, "a fixture precisa de um recorte com vigência").not.toBeNull();
    expect(
      visao!.comparacao,
      "a vigência da fixture não foi comparada — a auditoria não tem conteúdo para " +
        "medir, e passar aqui seria dizer «aprovado» sobre o vazio",
    ).toBe("COM_ALTERACOES");
    expect(
      visao!.totals.changes,
      "a vigência comparada não tem alteração nenhuma; não há o que auditar",
    ).toBeGreaterThan(0);
  }, 300_000);

  afterAll(async () => {
    await banco?.drop();
  });

  it.each(CHAMADAS)("%s %j — tudo que mostra, autoriza", async (nome, args) => {
    const chamada = await executar(registro, nome, args, ctx);

    /*
      Chamada que falha **reprova**, e não é pulada.

      A primeira versão fazia `if (!chamada.ok) return`, com o raciocínio de que
      uma falha declarada não expõe número ao modelo. É verdade e é irrelevante:
      o que o caso existe para provar é a invariável sobre conteúdo real, e um
      `return` aqui transforma banco quebrado em verde. Rodando num sandbox cuja
      fila de migrations estava inconsistente, dezessete casos passaram sobre
      conteúdo vazio e a auditoria inteira não mediu nada — quase reportada como
      aprovada.

      "Não medi" e "medi e aprovei" pedem ações opostas. É a mesma distinção que
      o portão do PR 7 e o `exigir()` do script já precisaram aprender.
    */
    expect(
      chamada.erro,
      `${nome} ${JSON.stringify(args)} não pôde ser executada, então a invariável não foi ` +
        "medida. Isto não é aprovação: é ambiente sem o dado que a auditoria precisa. " +
        "Confira se a fila de migrations do banco está em dia e se há vigência comparável.",
    ).toBeNull();

    const orfaos = semLastro(chamada);

    expect(
      orfaos,
      `${nome} ${JSON.stringify(args)} mostra ao modelo ${orfaos.length} número(s) que a ` +
        `evidência não autoriza: ${orfaos.slice(0, 15).join(", ")}. ` +
        "O modelo lê o conteúdo e cita o que viu; a trava confere contra a evidência. " +
        "O conserto é registrar esses valores em `numeros` ou em `fatos` da própria " +
        "ferramenta — nunca abrir exceção na trava.",
    ).toEqual([]);
  });

  it("a auditoria cobre os campos que o PR 7 flagrou", async () => {
    /*
      Os nomes que apareceram na rodada real, presos por nome. Se um deles voltar
      a existir no conteúdo sem lastro, este caso falha mesmo que a extração
      genérica acima mude de forma.
    */
    const c = await executar(registro, "alteracoes", { nivel: "grupos", limite: 5 }, ctx);
    expect(c.erro, "sem esta chamada a auditoria dos campos nomeados não mede nada").toBeNull();

    const conteudo = c.conteudo as Record<string, unknown>;
    const permitidos = autorizados(c);

    for (const campo of ["gruposNoTotal", "mostrando"]) {
      const valor = conteudo[campo];
      if (typeof valor !== "number") continue;
      expect(
        permitidos.has(String(valor)),
        `\`${campo}\` = ${valor} aparece no conteúdo e não está autorizado`,
      ).toBe(true);
    }

    const grupos = (conteudo.grupos ?? []) as Record<string, unknown>[];
    for (const g of grupos) {
      for (const campo of ["frota", "veiculos", "alteracoes", "posicaoNaFila"]) {
        const valor = g[campo];
        if (typeof valor !== "number") continue;
        expect(
          permitidos.has(String(valor)),
          `grupo.${campo} = ${valor} aparece no conteúdo e não está autorizado`,
        ).toBe(true);
      }
    }
  });
});
