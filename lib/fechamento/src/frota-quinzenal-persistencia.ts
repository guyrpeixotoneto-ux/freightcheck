import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import {
  fechamentoCompetenciaTable,
  fechamentoDocumentoTable,
  fechamentoFrotaPromaxTable,
} from "@workspace/db";
import {
  contarFrotaPorQuinzena,
  MAXIMO_DE_QUINZENAS,
  QUINZENAS_POR_PADRAO,
  type CompetenciaDaSerie,
  type CoberturaDaQuinzena,
  type PlacaReportada,
  type SerieDaFrota,
  type SituacaoDaFrota,
} from "./frota-quinzenal";

/**
 * A LEITURA DA SÉRIE DE FROTA — as quinzenas, as placas de cada uma, e o
 * `where` que impede a tela de somar o que não é dela.
 *
 * **Arquivo separado de `persistencia.ts` pela mesma razão que
 * `referencia-persistencia.ts` é**: aquele módulo é onde o cálculo lê o que vai
 * virar dinheiro. Este só conta placas. Nenhuma função daqui é chamada de lá, e
 * a fronteira é conferível por leitura de imports.
 *
 * ---------------------------------------------------------------------------
 * Três filtros, e nenhum deles é opcional por acidente
 * ---------------------------------------------------------------------------
 *
 * 1. **Documento vigente.** `fechamento_documento.vigente` marca o envio que a
 *    apuração usa; um reenvio derruba o anterior e apaga as linhas dele, mas a
 *    **quarentena** entra já com `vigente = false` e as linhas de pé. Contar por
 *    `competencia_id`, sem passar pelo documento, misturaria essas linhas com as
 *    boas — e o gráfico mostraria uma frota que ninguém tem.
 * 2. **Tipo de operação.** É o recorte que faz o Fechamento Rota e o Empurrada
 *    serem dois acervos, e não o mesmo acervo com dois nomes. Ausente, a leitura
 *    responde pelo acervo inteiro — que é o que a Visão executiva pede quando
 *    ninguém escolheu ainda.
 * 3. **Unidade.** Opcional, e é o filtro da tela. Sem ele, a série é do
 *    conjunto — e é aí que a cobertura vira obrigatória: a quinzena em que uma
 *    unidade não mandou arquivo tem menos placas, e sem dizer isso o gráfico
 *    mentiria uma frota encolhendo. Ver `CoberturaDaQuinzena`.
 *
 * ---------------------------------------------------------------------------
 * Placas distintas, e a distinção contada em TypeScript
 * ---------------------------------------------------------------------------
 *
 * A contagem poderia ser um `count(distinct placa)` por situação no Postgres, e
 * seria mais rápida. Não é, por uma razão: a placa que aparece **nas duas**
 * situações precisa ser contada nas duas e reportada como contradição
 * (`emAmbasAsSituacoes`), e isso é uma decisão de leitura, não de agregação.
 * Fazê-la no SQL espalharia a régua por dois lugares.
 *
 * O volume permite: a frota de um CDD é da ordem de centenas de placas, e a
 * janela é de quinzenas — algumas milhares de linhas, com índice por documento.
 */

/** O recorte da série. Tudo opcional: ausente é "o acervo inteiro". */
export interface RecorteDaSerieDeFrota {
  /** `EMPURRADA`, `ROTA` — o recorte que separa os dois acervos. */
  tipoDeOperacao?: string | null;
  /** O código da unidade, como a competência o guarda (`081-0443`). */
  unidadeCodigo?: string | null;
  /** Quantas quinzenas, da mais recente para trás. */
  limite?: number;
}

const TIPOS_DE_FROTA: Readonly<Record<SituacaoDaFrota, string>> = {
  ATIVA: "FROTA_PROMAX_ATIVA",
  INATIVA: "FROTA_PROMAX_INATIVA",
};

/** As unidades que aparecem no acervo do recorte — o seletor da tela. */
export async function unidadesComFrota(
  db: Database,
  tipoDeOperacao?: string | null,
): Promise<{ codigo: string; nome: string | null; quinzenas: number }[]> {
  const filtro = filtroDaOperacao(tipoDeOperacao);
  const linhas = await db
    .select({
      codigo: fechamentoCompetenciaTable.unidadeCodigo,
      nome: sql<string | null>`max(${fechamentoCompetenciaTable.unidadeNome})`,
      quinzenas: sql<number>`count(distinct ${fechamentoCompetenciaTable.chave})::int`,
    })
    .from(fechamentoCompetenciaTable)
    .where(filtro)
    .groupBy(fechamentoCompetenciaTable.unidadeCodigo)
    .orderBy(fechamentoCompetenciaTable.unidadeCodigo);
  return linhas;
}

/**
 * A série de frota do recorte — ativos e parados, quinzena a quinzena.
 *
 * Devolve `{ quinzenas: [] }` quando não há competência nenhuma no recorte: a
 * lista vazia é a resposta honesta de "não há acervo aqui", e quem chama
 * distingue isso de uma série com quinzenas sem relatório.
 */
export async function serieDeFrotaQuinzenal(
  db: Database,
  recorte: RecorteDaSerieDeFrota = {},
): Promise<SerieDaFrota> {
  const limite = Math.min(
    Math.max(1, recorte.limite ?? QUINZENAS_POR_PADRAO),
    MAXIMO_DE_QUINZENAS,
  );

  const filtro = and(
    filtroDaOperacao(recorte.tipoDeOperacao),
    recorte.unidadeCodigo
      ? eq(fechamentoCompetenciaTable.unidadeCodigo, recorte.unidadeCodigo)
      : undefined,
  );

  /*
    As quinzenas são a régua, e elas são do **período** e não da unidade: com
    mais de uma unidade no recorte, `2026-07-Q2` é uma coluna só do gráfico,
    alimentada por todas as competências daquele período.
  */
  const periodos = await db
    .select({
      chave: fechamentoCompetenciaTable.chave,
      ano: fechamentoCompetenciaTable.ano,
      mes: fechamentoCompetenciaTable.mes,
      quinzena: fechamentoCompetenciaTable.quinzena,
      inicio: sql<string>`min(${fechamentoCompetenciaTable.inicio})`,
      fim: sql<string>`max(${fechamentoCompetenciaTable.fim})`,
    })
    .from(fechamentoCompetenciaTable)
    .where(filtro)
    .groupBy(
      fechamentoCompetenciaTable.chave,
      fechamentoCompetenciaTable.ano,
      fechamentoCompetenciaTable.mes,
      fechamentoCompetenciaTable.quinzena,
    )
    .orderBy(
      desc(fechamentoCompetenciaTable.ano),
      desc(fechamentoCompetenciaTable.mes),
      desc(fechamentoCompetenciaTable.quinzena),
    )
    .limit(limite);

  if (periodos.length === 0) return { quinzenas: [] };

  /* Do banco vêm da mais recente para a mais antiga; a série se lê ao contrário. */
  const janela = [...periodos].reverse();
  const chaves = janela.map((p) => p.chave);

  /*
    Quem abriu cada quinzena, e quem mandou cada um dos dois relatórios. É esta
    consulta — e não a das placas — que separa "não tem veículo parado" de "o
    relatório de parados não veio".
  */
  const documentos = await db
    .select({
      chave: fechamentoCompetenciaTable.chave,
      unidadeCodigo: fechamentoCompetenciaTable.unidadeCodigo,
      tipo: fechamentoDocumentoTable.tipo,
    })
    .from(fechamentoCompetenciaTable)
    .leftJoin(
      fechamentoDocumentoTable,
      and(
        eq(
          fechamentoDocumentoTable.competenciaId,
          fechamentoCompetenciaTable.id,
        ),
        eq(fechamentoDocumentoTable.vigente, true),
        inArray(fechamentoDocumentoTable.tipo, [
          TIPOS_DE_FROTA.ATIVA,
          TIPOS_DE_FROTA.INATIVA,
        ]),
      ),
    )
    .where(and(filtro, inArray(fechamentoCompetenciaTable.chave, chaves)));

  const placas: PlacaReportada[] = (
    await db
      .select({
        chave: fechamentoCompetenciaTable.chave,
        unidadeCodigo: fechamentoCompetenciaTable.unidadeCodigo,
        placa: fechamentoFrotaPromaxTable.placa,
        situacao: fechamentoFrotaPromaxTable.situacao,
      })
      .from(fechamentoFrotaPromaxTable)
      .innerJoin(
        fechamentoDocumentoTable,
        and(
          eq(
            fechamentoDocumentoTable.id,
            fechamentoFrotaPromaxTable.documentoId,
          ),
          eq(fechamentoDocumentoTable.vigente, true),
        ),
      )
      .innerJoin(
        fechamentoCompetenciaTable,
        eq(
          fechamentoCompetenciaTable.id,
          fechamentoFrotaPromaxTable.competenciaId,
        ),
      )
      .where(and(filtro, inArray(fechamentoCompetenciaTable.chave, chaves)))
  ).map((linha) => ({
    competencia: linha.chave,
    unidadeCodigo: linha.unidadeCodigo,
    placa: linha.placa,
    /* A coluna tem `check (situacao in ('ATIVA','INATIVA'))` no banco. */
    situacao: linha.situacao as SituacaoDaFrota,
  }));

  const competencias: CompetenciaDaSerie[] = janela.map((p) => ({
    competencia: p.chave,
    ano: p.ano,
    mes: p.mes,
    quinzena: p.quinzena as 1 | 2,
    inicio: p.inicio,
    fim: p.fim,
    cobertura: coberturaDe(documentos, p.chave),
  }));

  return contarFrotaPorQuinzena(competencias, placas);
}

function filtroDaOperacao(tipoDeOperacao?: string | null) {
  const pedido = tipoDeOperacao?.trim().toUpperCase();
  return pedido
    ? eq(fechamentoCompetenciaTable.tipoDeOperacao, pedido)
    : undefined;
}

/** Quem abriu a quinzena, e quem mandou cada relatório dela. */
function coberturaDe(
  documentos: readonly {
    chave: string;
    unidadeCodigo: string;
    tipo: string | null;
  }[],
  chave: string,
): CoberturaDaQuinzena {
  const unidades = new Set<string>();
  const comAtiva = new Set<string>();
  const comInativa = new Set<string>();
  for (const d of documentos) {
    if (d.chave !== chave) continue;
    unidades.add(d.unidadeCodigo);
    if (d.tipo === TIPOS_DE_FROTA.ATIVA) comAtiva.add(d.unidadeCodigo);
    if (d.tipo === TIPOS_DE_FROTA.INATIVA) comInativa.add(d.unidadeCodigo);
  }
  return {
    unidades: [...unidades].sort(),
    comFrotaAtiva: [...comAtiva].sort(),
    comFrotaInativa: [...comInativa].sort(),
  };
}
