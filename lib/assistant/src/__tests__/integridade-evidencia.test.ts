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

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
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
  const bruto = JSON.stringify(chamada.conteudo ?? {}).replace(
    /\b\d{4}-\d{2}-\d{2}\b/g,
    " ",
  );
  return [
    ...new Set(
      numerosDe(bruto).filter(
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
  ["recortes", {}],
  ["parametros", { busca: "ipva", limite: 5 }],
  ["comparar", {}],
  ["ordenacao", { por: "criticidade" }],
  ["ordenacao", { por: "dinheiro", sentido: "perda" }],
  ["veiculos", {}],
  ["resultado", {}],
  ["documentos", { busca: "combustível" }],
  ["estado_do_dado", { aspecto: "curadoria" }],
  ["estado_do_dado", { aspecto: "panorama" }],
  ["estado_do_dado", { aspecto: "sem_preco" }],
  ["estado_do_dado", { aspecto: "importacoes" }],
  ["estado_do_dado", { aspecto: "balanco" }],
];

comBanco("integridade Tool → Evidência", () => {
  let ctx: ContextoDaFerramenta;
  const registro = registroPadrao();

  beforeAll(() => {
    const db: Database = createDb(url!).db;
    ctx = { db, recorte: {} };
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
