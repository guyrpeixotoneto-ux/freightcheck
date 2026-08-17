import { sql } from "drizzle-orm";
import { viraDinheiro } from "@workspace/curation";
import type { Database } from "@workspace/db";
import { attributeLabel, equipmentLabel } from "./labels";
import { INHERITED_COST_CLASS_JOIN } from "./classification";
import {
  COMPOSITIONS,
  ESCOPOS_DE_CONJUNTO,
  type EscopoDeConjunto,
} from "./composition";
import {
  contextFilter,
  resolveContext,
  type ContextInfo,
  type RequestedContext,
  type SeriesContext,
} from "./series";

/**
 * Panorama — **tudo que mudou** entre as vigências, antes de escolher o quê.
 *
 * A aba Impacto abria direto num parâmetro. Abrir num parâmetro é afirmar, sem
 * dizer, que foi aquele que mudou: quem entrava via a tabela do FINAME e saía
 * com a impressão de que o FINAME havia sido a alteração da quinzena. Nos dados
 * reais ele é o décimo em número de alterações no cavalo, e na carreta os três
 * maiores nem sustentam soma de dinheiro. O dropdown existia, mas descobrir o
 * que mudou não pode depender de abrir um dropdown e percorrer quarenta opções.
 *
 * Esta leitura responde primeiro, e responde por inteiro. Ela não substitui a
 * matriz por vigência — a matriz vira o segundo nível, alcançável clicando na
 * linha. O que ela faz é inverter a ordem das perguntas: *o que mudou* antes de
 * *me mostre este*.
 *
 * Três regras a separam de um `GROUP BY` sobre `fact`, e nenhuma é cosmética:
 *
 * 1. **Duas contas, nunca uma.** "Mais alterado" e "maior impacto financeiro"
 *    são perguntas diferentes e têm rankings diferentes. Um parâmetro em
 *    km/l pode liderar o primeiro e não ter lugar nenhum no segundo — e a soma
 *    dos módulos das variações, que serviria para ordenar os dois, **não** é
 *    impacto financeiro e não aparece como se fosse.
 * 2. **Quem não passa na régua aparece mesmo assim.** Um parâmetro que mudou e
 *    que ainda não sabemos monetizar é informação, não ruído: escondê-lo faria
 *    a tela dizer que nada mudou ali. Ele entra no primeiro ranking, fora do
 *    segundo, com o motivo escrito.
 * 3. **O total manda, a parcela desce.** `cavalo.finame_cavalo` e suas três
 *    parcelas são a mesma alteração vista quatro vezes, e `carreta.finame` já
 *    contém o cavalo inteiro. Listar os seis como seis impactos econômicos
 *    independentes multiplicaria o mesmo real — que é justamente o erro que
 *    `composition.ts` foi escrito para impedir do outro lado do produto.
 * 4. **Fixo e variável se leem separados, e o corte é filtro — nunca uma
 *    segunda contagem.** Custo fixo e custo variável são dois dinheiros, e
 *    quem confere o mês pergunta por um de cada vez: o financiamento subiu, ou
 *    foi o combustível? Os recortes saem dos mesmos rankings já ordenados, com
 *    as mesmas exclusões de parcela e de conjunto aplicadas antes — de modo
 *    que fixo, variável e sem classe **somam exatamente o todo**, e a lista de
 *    um recorte é uma sublista da lista inteira, na mesma ordem.
 */

/**
 * A classe de custo de um parâmetro, na leitura da tela.
 *
 * As duas primeiras são o que a taxonomia declara em `custo_fixo` e
 * `custo_variavel` e todo descendente herda. `SEM_CLASSE` não é uma terceira
 * classe de dinheiro: é a caixa de quem a taxonomia não classifica como custo —
 * o cadastral, que é especificação do ativo e deliberadamente não remunera
 * nada, e o que ainda ninguém classificou. As duas coisas ficam distinguíveis
 * pelo grupo, que vem junto em `grupoDeCusto`.
 */
export type ClasseDeCusto = "FIXO" | "VARIAVEL" | "SEM_CLASSE";

/** O papel de um parâmetro na árvore econômica. */
export type PapelEconomico =
  /** É a soma de parcelas declaradas em `COMPOSITIONS`. */
  | "TOTAL"
  /** Está contido num total — desce para o drill-down dele. */
  | "PARCELA"
  /** Embute o outro equipamento do conjunto (ver `ESCOPOS_DE_CONJUNTO`). */
  | "CONJUNTO"
  /** Não participa de composição nenhuma. */
  | "SIMPLES";

/** Quanto de uma identidade declarada de fato fecha nos dados. */
export interface Reconciliacao {
  /** Linhas (ativo × vigência) em que o total não é zero e as parcelas existem. */
  linhas: number;
  /** Quantas fecham, com tolerância de um centavo. */
  fecham: number;
  /** `fecham / linhas`, em porcento. */
  percentual: number;
}

/** Uma ponta da série, do ponto de vista de um parâmetro. */
export interface PontaDoParametro {
  effectiveDate: string;
  sourceLabel: string;
  /** A soma da coluna. Aritmética sobre o arquivo — dinheiro só quando somável. */
  total: number | null;
  /** Ativos com valor apurado neste parâmetro nesta vigência. */
  withValue: number;
}

/**
 * A variação entre as duas pontas, já separada do tamanho da frota.
 *
 * `preco` é a única parcela que responde "ficou mais caro?", e é a que ordena o
 * ranking financeiro. `frota` é o que entrou menos o que saiu — dinheiro real,
 * e mesmo assim não é preço.
 */
export interface VariacaoDecomposta {
  total: number;
  preco: number;
  frota: number;
  entraram: { entities: number; amount: number };
  sairam: { entities: number; amount: number };
  comparados: number;
}

export interface ParametroAlterado {
  code: string;
  title: string;
  entityType: string;
  equipment: string;

  // ---- o que mudou -------------------------------------------------------
  /** Transições de valor entre vigências entregues consecutivas. */
  changes: number;
  /** Ativos com pelo menos uma transição. */
  entities: number;
  /** Ativos do tipo que apareceram na série, com ou sem alteração. */
  entitiesNaSerie: number;

  // ---- as pontas ---------------------------------------------------------
  from: PontaDoParametro | null;
  to: PontaDoParametro | null;
  /** Null quando o parâmetro não sustenta soma — e aí não há variação a mostrar. */
  variacao: VariacaoDecomposta | null;

  // ---- a régua -----------------------------------------------------------
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string;
  /** Passa na régua: semântica confirmada, monetário e somável. */
  impactoCalculavel: boolean;
  /** Por que não passa. Vazio quando passa. */
  impactoMotivo: string;

  // ---- a classe de custo -------------------------------------------------
  /**
   * FIXO ou VARIAVEL, herdada do nó mais próximo da taxonomia que declara
   * classe. `SEM_CLASSE` quando nenhum ancestral declara — e aí a razão está
   * no grupo.
   */
  classeDeCusto: ClasseDeCusto;
  /**
   * O nó da taxonomia em que o parâmetro está pendurado: "Combustível",
   * "Seguros e tributos", "Especificação técnica". É o *porquê* da classe, e
   * sem ele "custo variável" seria um rótulo que ninguém consegue conferir.
   */
  grupoDeCusto: string | null;

  // ---- a economia --------------------------------------------------------
  papel: PapelEconomico;
  /** O código do total que já contém este parâmetro, quando é parcela. */
  dentroDe: string | null;
  /** As parcelas declaradas, quando é total. */
  parcelas: string[];
  /** O que este total embute do outro equipamento, quando é de conjunto. */
  contem: string | null;
  /** A evidência da composição ou do escopo, para a tela poder citá-la. */
  evidencia: string | null;
  reconciliacao: Reconciliacao | null;
}

export interface PanoramaPeriodo {
  effectiveDate: string;
  sourceLabel: string;
  /** Os equipamentos que esta vigência entregou. */
  entityTypes: string[];
}

/**
 * Um ranking financeiro por periodicidade.
 *
 * A separação é estrutural, e não um detalhe da tela: R$ 731 mil por ano e
 * R$ 52 mil por mês não se ordenam numa lista só sem uma conversão que este
 * produto trata como projeção, nunca como fato.
 */
export interface ImpactoPorPeriodicidade {
  periodicity: string | null;
  codes: string[];
}

export interface TotaisDoPanorama {
  /** Linhas econômicas — totais e simples, sem as parcelas. */
  linhasEconomicas: number;
  parametrosAlterados: number;
  comImpacto: number;
  semImpacto: number;
  alteracoes: number;
  ativosAfetados: number;
}

/** As listas de uma leitura: a inteira, ou a de uma classe de custo. */
export interface LeituraDeAlteracoes {
  /** Códigos, por número de alterações. Inclui não monetários. */
  maisAlterados: string[];
  /** Códigos, só os que passam na régua. Achatado de `impactoPorPeriodicidade`. */
  maiorImpacto: string[];
  /** O ranking financeiro como ele deve ser lido: uma lista por periodicidade. */
  impactoPorPeriodicidade: ImpactoPorPeriodicidade[];
  /** Códigos que mudaram e que ainda não sabemos ler financeiramente. */
  semLeituraFinanceira: string[];
  /** As colunas que já contêm o outro equipamento — fora dos rankings, na tela. */
  visaoDeConjunto: string[];
  totais: TotaisDoPanorama;
}

/**
 * O panorama visto por uma classe de custo só.
 *
 * Cada recorte é a leitura inteira filtrada, e não refeita: mesmas exclusões,
 * mesma ordem, mesmas contas. Um recorte vazio é um resultado — "nada de custo
 * variável mudou" —, e por isso os três vêm sempre, com `nome` e `descricao`
 * prontos para a tela nomear a caixa em vez de traduzir um enum.
 */
export interface RecorteDeCusto extends LeituraDeAlteracoes {
  classe: ClasseDeCusto;
  nome: string;
  descricao: string;
}

export interface PanoramaDeAlteracoes extends LeituraDeAlteracoes {
  context: ContextInfo;
  periods: PanoramaPeriodo[];
  /** Tudo que mudou, na ordem de relevância econômica. */
  parametros: ParametroAlterado[];
  /** As mesmas listas, por classe de custo. Fixo, variável e sem classe. */
  recortes: RecorteDeCusto[];
}

export interface PanoramaOptions {
  context?: RequestedContext;
}

/**
 * Como cada classe se chama e o que ela reúne.
 *
 * O texto vem daqui, e não da tela, porque é a mesma frase que a taxonomia
 * sustenta: quem quiser conferir por que o combustível é variável segue de
 * `cv_combustivel` até `custo_variavel` em `@workspace/curation`. A ordem é a
 * da conta — fixo, variável, e o que não é custo por último.
 */
const CLASSES: { classe: ClasseDeCusto; nome: string; descricao: string }[] = [
  {
    classe: "FIXO",
    nome: "Custo fixo",
    descricao:
      "O que se paga por ter o ativo: financiamento, depreciação, seguros, " +
      "tributos e a remuneração de capital.",
  },
  {
    classe: "VARIAVEL",
    nome: "Custo variável",
    descricao:
      "O que se paga por rodar: combustível, manutenção, pneus e o lucro " +
      "variável previsto.",
  },
  {
    classe: "SEM_CLASSE",
    nome: "Sem classe",
    descricao:
      "A taxonomia não declara custo para estes. São os cadastrais — " +
      "especificação, contrato, identificação, que não remuneram nada — e os " +
      "que ainda ninguém classificou. O grupo de cada linha diz qual é o caso.",
  },
];

const round2 = (valor: number) => Math.round(valor * 100) / 100;
const num = (valor: string | null): number | null =>
  valor === null ? null : Number(valor);

/** Um centavo. A tolerância das identidades declaradas em `COMPOSITIONS`. */
const CENTAVO = 0.01;

/**
 * Uma lista de textos como array de verdade para o `= ANY (…)`.
 *
 * O driver deste projeto é o `pg`, e nele um array JS interpolado num template
 * vira uma lista de parâmetros — `($1, $2)` —, que o Postgres recusa com
 * "op ANY/ALL (array) requires array on right side". O `ARRAY[…]` explícito é
 * o mesmo caminho que `@workspace/coverage` já usa, e o cast garante o tipo
 * quando a lista chega vazia.
 */
export const listaDeTexto = (valores: string[]) =>
  sql`ARRAY[${sql.join(
    valores.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;

const PARCELA_DE = new Map<string, string>();
for (const c of COMPOSITIONS) for (const p of c.parts) PARCELA_DE.set(p, c.total);

const COMPOSICAO_POR_TOTAL = new Map(COMPOSITIONS.map((c) => [c.total, c]));
const ESCOPO_POR_CODIGO = new Map<string, EscopoDeConjunto>(
  ESCOPOS_DE_CONJUNTO.map((e) => [e.code, e]),
);

/**
 * O motivo de um parâmetro não sustentar impacto financeiro.
 *
 * A mesma régua de `assessImpact`, dita na ordem em que a curadoria a resolve —
 * semântica primeiro, porque é o portão, e as outras duas depois. A frase vai
 * inteira para a tela: "não calculável" sem motivo é uma célula vazia com outro
 * nome, e uma célula vazia numa tela de auditoria é lida como zero.
 */
function motivoDaRegua(a: {
  semanticsStatus: string;
  isMonetary: boolean | null;
  aggregation: string | null;
  unit: string | null;
}): string {
  // A régua é `viraDinheiro`, e nada além dela: esta função já foi a terceira
  // redação da mesma regra, com frases próprias para os mesmos três casos.
  return viraDinheiro(a).motivo;
}

/**
 * Tudo que mudou entre as vigências do contexto, por parâmetro.
 *
 * Devolve `null` quando o contexto não tem vigência nenhuma, para a rota
 * traduzir em 404 — a tela mostra o convite a importar, e não uma lista vazia
 * que se pareceria com "nada mudou".
 */
export async function getPanoramaDeAlteracoes(
  db: Database,
  options: PanoramaOptions = {},
): Promise<PanoramaDeAlteracoes | null> {
  const context = await resolveContext(db, options.context);
  if (!context) return null;

  // ---- o eixo do tempo ------------------------------------------------------
  const { rows: periodRows } = await db.execute<{
    effective_date: string;
    source_label: string;
    entity_types: string[];
  }>(sql`
    SELECT s.effective_date::text AS effective_date,
           string_agg(DISTINCT s.source_label, ' · ') AS source_label,
           array_agg(DISTINCT t) AS entity_types
      FROM snapshot s,
           unnest(string_to_array(s.entity_type_set, '+')) t
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1
     ORDER BY 1
  `);
  if (periodRows.length === 0) return null;

  const periods: PanoramaPeriodo[] = periodRows.map((p) => ({
    effectiveDate: p.effective_date,
    sourceLabel: p.source_label,
    entityTypes: p.entity_types,
  }));

  /*
    As pontas são por equipamento, e não da série inteira. Uma quinzena que veio
    só com carretas não é uma ponta do cavalo — tomá-la como tal leria a frota
    inteira de cavalos como "saiu", que é o mesmo erro que `impacto.ts` descreve
    na regra 2 e pela mesma razão.
  */
  const pontasPorTipo = new Map<string, { first: string; last: string }>();
  for (const p of periods) {
    for (const tipo of p.entityTypes) {
      const atual = pontasPorTipo.get(tipo);
      if (!atual) pontasPorTipo.set(tipo, { first: p.effectiveDate, last: p.effectiveDate });
      else atual.last = p.effectiveDate;
    }
  }

  // ---- quantas alterações, em quantos ativos ---------------------------------
  /*
    A contagem sai do Postgres por `LAG`, e não de um pivô em memória: são
    quarenta parâmetros por equipamento em nove vigências, e trazer o fato a fato
    para contar transições seria puxar dezenas de milhares de linhas para
    produzir quarenta números.

    A célula vazia entra na série e **quebra a cadeia**, em vez de ser pulada.
    Sair de um valor para uma célula vazia é ausência, não mudança de preço, e
    voltar a ter valor depois não é "mudou de 100 para 120" — são duas
    aparições com um buraco no meio. Pular o vazio contaria uma alteração que a
    matriz do segundo nível não mostra, e o número da lista deixaria de bater
    com o que se vê ao clicar nela. É a mesma regra que `impacto.ts` aplica ao
    pintar o movimento de cada célula.
  */
  const { rows: mudancas } = await db.execute<{
    code: string;
    changes: number;
    entities: number;
  }>(sql`
    WITH vig AS (
      SELECT s.id, s.effective_date
        FROM snapshot s
       WHERE s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
    ),
    serie AS (
      SELECT a.code,
             f.entity_id,
             CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END AS value_numeric,
             LAG(CASE WHEN f.is_null THEN NULL ELSE f.value_numeric END) OVER (
               PARTITION BY f.entity_id, f.attribute_id
               ORDER BY v.effective_date
             ) AS anterior
        FROM fact f
        JOIN vig v       ON v.id = f.snapshot_id
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.data_type = 'NUMERIC'
    )
    SELECT code,
           COUNT(*)::int AS changes,
           COUNT(DISTINCT entity_id)::int AS entities
      FROM serie
     WHERE anterior IS NOT NULL
       AND value_numeric <> anterior
     GROUP BY 1
  `);
  if (mudancas.length === 0) {
    const vazio = {
      maisAlterados: [],
      maiorImpacto: [],
      impactoPorPeriodicidade: [],
      semLeituraFinanceira: [],
      visaoDeConjunto: [],
      totais: {
        linhasEconomicas: 0,
        parametrosAlterados: 0,
        comImpacto: 0,
        semImpacto: 0,
        alteracoes: 0,
        ativosAfetados: 0,
      },
    };
    return {
      context,
      periods,
      parametros: [],
      ...vazio,
      // Os três recortes vêm mesmo assim: a tela oferece o corte antes de saber
      // o que tem dentro, e uma lista de recortes vazia a faria esconder o
      // seletor justamente quando a resposta é "nada mudou em lugar nenhum".
      recortes: CLASSES.map((c) => ({ ...c, ...vazio })),
    };
  }
  const alterados = new Set(mudancas.map((m) => m.code));

  // ---- a régua de cada um ---------------------------------------------------
  /*
    A classe de custo entra aqui, na mesma leitura, e não numa segunda consulta:
    ela é atributo do parâmetro tanto quanto a unidade, e o recorte da tela é
    inútil se um parâmetro puder aparecer na lista sem saber em que caixa cai.
    A junção é a de `classification.ts` — o nó mais próximo que declara classe —
    importada de lá para que exista uma definição só de "fixo ou variável".
  */
  const { rows: atributos } = await db.execute<{
    code: string;
    source_name: string;
    display_name: string | null;
    entity_type: string;
    unit: string | null;
    periodicity: string | null;
    aggregation: string | null;
    is_monetary: boolean | null;
    semantics_status: string;
    cost_class: string | null;
    taxonomy_name: string | null;
  }>(sql`
    SELECT a.code, a.source_name, a.display_name, a.entity_type, a.unit, a.periodicity,
           a.aggregation, a.is_monetary,
           a.semantics_status::text AS semantics_status,
           inherited.cost_class,
           node.name AS taxonomy_name
      FROM attribute a
      LEFT JOIN taxonomy_node node ON node.id = a.taxonomy_node_id
      ${INHERITED_COST_CLASS_JOIN}
     WHERE a.data_type = 'NUMERIC'
  `);
  const reguaDe = new Map(atributos.map((a) => [a.code, a]));

  // ---- a soma da coluna em cada vigência ------------------------------------
  const { rows: totaisPorVigencia } = await db.execute<{
    code: string;
    effective_date: string;
    total: string | null;
    com_valor: number;
  }>(sql`
    SELECT a.code,
           s.effective_date::text AS effective_date,
           SUM(f.value_numeric)::text AS total,
           COUNT(*)::int AS com_valor
      FROM fact f
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.data_type = 'NUMERIC'
       AND NOT f.is_null
       AND f.value_numeric IS NOT NULL
       AND s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1, 2
  `);
  const colunaDe = new Map<string, { total: number | null; comValor: number }>();
  for (const t of totaisPorVigencia) {
    colunaDe.set(`${t.code}@${t.effective_date}`, {
      total: t.total === null ? null : round2(Number(t.total)),
      comValor: t.com_valor,
    });
  }

  // ---- quantos ativos de cada tipo apareceram na série ----------------------
  const { rows: frota } = await db.execute<{ entity_type: string; ativos: number }>(sql`
    SELECT e.entity_type, COUNT(DISTINCT e.id)::int AS ativos
      FROM entity e
      JOIN fact f     ON f.entity_id = e.id
      JOIN snapshot s ON s.id = f.snapshot_id
     WHERE s.status <> 'SUPERSEDED'
       AND ${contextFilter("s", context)}
     GROUP BY 1
  `);
  const frotaDe = new Map(frota.map((f) => [f.entity_type, f.ativos]));

  // ---- os valores nas duas pontas, ativo a ativo ----------------------------
  /*
    Só das duas pontas de cada equipamento, e só dos parâmetros que mudaram — é
    o que a decomposição preço/frota precisa, e traz duas colunas em vez das
    nove. Sem ela a variação seria o total de uma coluna menos o da outra, que
    responde errado toda vez que entrou ou saiu ativo.
  */
  const datasDePonta = [
    ...new Set([...pontasPorTipo.values()].flatMap((p) => [p.first, p.last])),
  ];
  const { rows: pontas } = await db.execute<{
    code: string;
    entity_id: string;
    effective_date: string;
    value_numeric: string | null;
  }>(sql`
    SELECT a.code,
           f.entity_id::text AS entity_id,
           s.effective_date::text AS effective_date,
           f.value_numeric::text AS value_numeric
      FROM fact f
      JOIN snapshot s  ON s.id = f.snapshot_id
      JOIN attribute a ON a.id = f.attribute_id
     WHERE a.data_type = 'NUMERIC'
       AND NOT f.is_null
       AND f.value_numeric IS NOT NULL
       AND s.status <> 'SUPERSEDED'
       AND s.effective_date::text = ANY (${listaDeTexto(datasDePonta)})
       AND a.code = ANY (${listaDeTexto([...alterados])})
       AND ${contextFilter("s", context)}
  `);
  /*
    Indexado por (parâmetro, vigência) e só então por ativo. A primeira versão
    guardava uma chave composta única e varria o mapa inteiro uma vez por
    parâmetro para achar os ativos dele — trinta e cinco varreduras sobre dez
    mil chaves para produzir trinta e cinco decomposições.
  */
  const valorNaPonta = new Map<string, Map<string, number>>();
  for (const p of pontas) {
    const v = num(p.value_numeric);
    if (v === null) continue;
    const chave = `${p.code}@${p.effective_date}`;
    let coluna = valorNaPonta.get(chave);
    if (!coluna) valorNaPonta.set(chave, (coluna = new Map()));
    coluna.set(p.entity_id, v);
  }

  // ---- o quanto cada identidade declarada fecha ------------------------------
  const reconciliacoes = await medirReconciliacoes(db, context);

  // ---- monta as linhas ------------------------------------------------------
  const rotuloDaData = new Map(periods.map((p) => [p.effectiveDate, p.sourceLabel]));

  const parametros: ParametroAlterado[] = [];
  for (const m of mudancas) {
    const regua = reguaDe.get(m.code);
    if (!regua) continue;

    const pontasDoTipo = pontasPorTipo.get(regua.entity_type);
    const motivo = motivoDaRegua({
      semanticsStatus: regua.semantics_status,
      isMonetary: regua.is_monetary,
      aggregation: regua.aggregation,
      unit: regua.unit,
    });
    const calculavel = motivo === "";

    const ponta = (data: string | undefined): PontaDoParametro | null => {
      if (data === undefined) return null;
      const c = colunaDe.get(`${m.code}@${data}`);
      return {
        effectiveDate: data,
        sourceLabel: rotuloDaData.get(data) ?? data,
        total: c?.total ?? null,
        withValue: c?.comValor ?? 0,
      };
    };

    const composicao = COMPOSICAO_POR_TOTAL.get(m.code);
    const escopo = ESCOPO_POR_CODIGO.get(m.code);
    const dentroDe = PARCELA_DE.get(m.code) ?? null;
    const papel: PapelEconomico = escopo
      ? "CONJUNTO"
      : composicao
        ? "TOTAL"
        : dentroDe
          ? "PARCELA"
          : "SIMPLES";

    parametros.push({
      code: m.code,
      title: attributeLabel(m.code, regua.source_name, regua.display_name),
      entityType: regua.entity_type,
      equipment: equipmentLabel(regua.entity_type),
      changes: m.changes,
      entities: m.entities,
      entitiesNaSerie: frotaDe.get(regua.entity_type) ?? 0,
      from: ponta(pontasDoTipo?.first),
      to: ponta(pontasDoTipo?.last),
      variacao:
        calculavel && pontasDoTipo
          ? decompor(m.code, pontasDoTipo, valorNaPonta, colunaDe)
          : null,
      unit: regua.unit,
      periodicity: regua.periodicity,
      aggregation: regua.aggregation,
      isMonetary: regua.is_monetary,
      semanticsStatus: regua.semantics_status,
      impactoCalculavel: calculavel,
      impactoMotivo: motivo,
      /*
        Só FIXO e VARIAVEL são classes de custo. Qualquer outra coisa que o
        banco traga — inclusive nada — cai em SEM_CLASSE em vez de virar uma
        quarta caixa que a tela não sabe nomear.
      */
      classeDeCusto:
        regua.cost_class === "FIXO" || regua.cost_class === "VARIAVEL"
          ? regua.cost_class
          : "SEM_CLASSE",
      grupoDeCusto: regua.taxonomy_name,
      papel,
      dentroDe,
      parcelas: composicao?.parts ?? [],
      contem: escopo?.contem ?? null,
      evidencia: escopo?.evidence ?? composicao?.evidence ?? null,
      reconciliacao: reconciliacoes.get(m.code) ?? null,
    });
  }

  /*
    A ordem da lista é a relevância econômica, e ela é composta de propósito: o
    que tem dinheiro apurado primeiro, ordenado pelo módulo da variação de
    preço; depois o que mudou muito e ainda não sabemos ler. Ordenar tudo por
    número de alterações poria `manutencao_vida_meses` — 494 mudanças, nenhuma
    em reais — acima de qualquer coisa que custe dinheiro.
  */
  const precoDe = (p: ParametroAlterado) => Math.abs(p.variacao?.preco ?? 0);
  parametros.sort((a, b) => {
    if (a.impactoCalculavel !== b.impactoCalculavel) return a.impactoCalculavel ? -1 : 1;
    if (a.impactoCalculavel) return precoDe(b) - precoDe(a);
    return b.changes - a.changes;
  });

  /*
    Duas exclusões, e as duas evitam contar o mesmo real duas vezes.

    **A coluna de conjunto sai.** `carreta.custo_fixo` já contém o
    `cavalo.finame_cavalo` inteiro — listar as duas como linhas econômicas
    somaria R$ 867 mil de cavalo dentro do número da carreta. É a mesma decisão
    que `motor.ts` toma ao mandá-las para `naoApurados` com
    `ESCOPO_DE_CONJUNTO`, e elas continuam alcançáveis: saem do ranking, não da
    tela.

    **A parcela cujo total ficou também sai.** As 27 transições de
    `juros_finame_cavalo` já estão dentro das 37 do `finame_cavalo`.

    A ordem entre as duas importa: quando o total sai por escopo de conjunto, as
    parcelas dele **voltam a ser raiz** — senão `carreta.lucro_fixomodelo_novo_ciclo`
    desapareceria junto com o `custo_fixo` que o continha, e a carreta perderia
    uma linha econômica que é só dela. É a mesma regra que
    `regras.test.ts` protege do outro lado do produto.
  */
  const ehDeConjunto = (code: string) => ESCOPO_POR_CODIGO.has(code);
  const totalCobre = (p: ParametroAlterado) =>
    p.dentroDe !== null && alterados.has(p.dentroDe) && !ehDeConjunto(p.dentroDe);
  const linhaEconomica = (p: ParametroAlterado) =>
    !ehDeConjunto(p.code) && !totalCobre(p);

  /*
    O ranking financeiro é por periodicidade, e não uma lista só.

    Sem isso o IPVA — R$ 731 mil por **ano** — lidera sobre o FINAME —
    R$ 52 mil por **mês**, que são R$ 627 mil no ano —, e a ordem inverte assim
    que alguém anualiza. Converter para comparar seria projeção linear, que o
    produto só admite na Simulação e sempre marcada como premissa
    (`lib/simulation/src/periodicity.ts`). Aqui vale a mesma saída das outras
    telas: mostrar MENSAL e ANUAL lado a lado, e nunca no mesmo ranking.
  */
  const ORDEM_DA_PERIODICIDADE = ["MENSAL", "ANUAL", "PONTUAL"];
  const ordemDaPeriodicidade = (p: string | null) => {
    const i = ORDEM_DA_PERIODICIDADE.indexOf(p ?? "");
    return i === -1 ? ORDEM_DA_PERIODICIDADE.length : i;
  };

  const calculaveis = parametros.filter((p) => p.impactoCalculavel && linhaEconomica(p));
  const impactoPorPeriodicidade: ImpactoPorPeriodicidade[] = [
    ...new Set(calculaveis.map((p) => p.periodicity)),
  ]
    .sort((a, b) => ordemDaPeriodicidade(a) - ordemDaPeriodicidade(b))
    .map((periodicity) => ({
      periodicity,
      codes: calculaveis
        .filter((p) => p.periodicity === periodicity)
        .sort((a, b) => precoDe(b) - precoDe(a))
        .map((p) => p.code),
    }));

  const maiorImpacto = impactoPorPeriodicidade.flatMap((g) => g.codes);

  const maisAlterados = parametros
    .filter(linhaEconomica)
    .sort((a, b) => b.changes - a.changes || b.entities - a.entities)
    .map((p) => p.code);

  const semLeituraFinanceira = parametros
    .filter((p) => !p.impactoCalculavel && linhaEconomica(p))
    .sort((a, b) => b.changes - a.changes)
    .map((p) => p.code);

  const visaoDeConjunto = parametros
    .filter((p) => ehDeConjunto(p.code))
    .sort((a, b) => precoDe(b) - precoDe(a) || b.changes - a.changes)
    .map((p) => p.code);

  /*
    O recorte é **filtro das listas prontas**, e a diferença não é de estilo.

    Refazer os rankings dentro de cada classe recalcularia `linhaEconomica`
    sobre um subconjunto, e a regra depende de quem mais mudou: uma parcela cujo
    total está em outra classe voltaria a ser raiz e apareceria como linha
    econômica que o panorama inteiro não tem. Filtrando o que já está ordenado,
    fixo + variável + sem classe reconstroem exatamente o todo — que é o que
    permite à tela oferecer o corte sem que os números mudem de significado ao
    trocar de aba.
  */
  const classeDe = new Map(parametros.map((p) => [p.code, p.classeDeCusto]));
  const recorte = (descricao: (typeof CLASSES)[number]): RecorteDeCusto => {
    const daClasse = (code: string) => classeDe.get(code) === descricao.classe;
    const dentro = parametros.filter((p) => p.classeDeCusto === descricao.classe);
    const maisAlteradosDaClasse = maisAlterados.filter(daClasse);
    const maiorImpactoDaClasse = maiorImpacto.filter(daClasse);
    const semLeituraDaClasse = semLeituraFinanceira.filter(daClasse);

    return {
      ...descricao,
      maisAlterados: maisAlteradosDaClasse,
      maiorImpacto: maiorImpactoDaClasse,
      impactoPorPeriodicidade: impactoPorPeriodicidade
        .map((g) => ({ periodicity: g.periodicity, codes: g.codes.filter(daClasse) }))
        // Uma periodicidade que ficou sem nenhum código nesta classe não é um
        // grupo vazio na tela: ela simplesmente não existe neste recorte.
        .filter((g) => g.codes.length > 0),
      semLeituraFinanceira: semLeituraDaClasse,
      visaoDeConjunto: visaoDeConjunto.filter(daClasse),
      totais: {
        linhasEconomicas: maisAlteradosDaClasse.length,
        parametrosAlterados: dentro.length,
        comImpacto: maiorImpactoDaClasse.length,
        semImpacto: semLeituraDaClasse.length,
        alteracoes: dentro.reduce((s, p) => s + p.changes, 0),
        ativosAfetados: Math.max(0, ...dentro.map((p) => p.entities)),
      },
    };
  };

  return {
    context,
    periods,
    parametros,
    maisAlterados,
    maiorImpacto,
    impactoPorPeriodicidade,
    semLeituraFinanceira,
    visaoDeConjunto,
    recortes: CLASSES.map(recorte),
    totais: {
      linhasEconomicas: maisAlterados.length,
      parametrosAlterados: parametros.length,
      comImpacto: calculaveis.length,
      semImpacto: semLeituraFinanceira.length,
      alteracoes: parametros.reduce((s, p) => s + p.changes, 0),
      ativosAfetados: Math.max(0, ...parametros.map((p) => p.entities)),
    },
  };
}

/**
 * A variação entre as pontas, separada em preço e frota.
 *
 * Mesma decomposição de `decomporPontaAPonta` em `impacto.ts`, aplicada a um
 * parâmetro sem montar a matriz inteira. A identidade que ela preserva é a
 * mesma e é o ponto: `total = preco + frota`, sempre, para que a tela nunca
 * atribua a preço o que foi tamanho de frota.
 */
function decompor(
  code: string,
  pontas: { first: string; last: string },
  valorNaPonta: Map<string, Map<string, number>>,
  colunaDe: Map<string, { total: number | null; comValor: number }>,
): VariacaoDecomposta | null {
  if (pontas.first === pontas.last) return null;

  const naPrimeira = valorNaPonta.get(`${code}@${pontas.first}`) ?? new Map();
  const naUltima = valorNaPonta.get(`${code}@${pontas.last}`) ?? new Map();
  const ativos = new Set([...naPrimeira.keys(), ...naUltima.keys()]);

  let comparados = 0;
  let deltaComparados = 0;
  let entraram = 0;
  let valorQueEntrou = 0;
  let sairam = 0;
  let valorQueSaiu = 0;

  for (const entity of ativos) {
    const a = naPrimeira.get(entity);
    const b = naUltima.get(entity);
    if (a !== undefined && b !== undefined) {
      comparados++;
      deltaComparados += b - a;
    } else if (b !== undefined) {
      entraram++;
      valorQueEntrou += b;
    } else if (a !== undefined) {
      sairam++;
      valorQueSaiu += a;
    }
  }

  const de = colunaDe.get(`${code}@${pontas.first}`)?.total ?? 0;
  const para = colunaDe.get(`${code}@${pontas.last}`)?.total ?? 0;

  return {
    total: round2(para - de),
    preco: round2(deltaComparados),
    frota: round2(valorQueEntrou - valorQueSaiu),
    entraram: { entities: entraram, amount: round2(valorQueEntrou) },
    sairam: { entities: sairam, amount: round2(valorQueSaiu) },
    comparados,
  };
}

/**
 * Quanto cada identidade de `COMPOSITIONS` fecha nestes dados.
 *
 * A evidência gravada em `composition.ts` foi medida uma vez, sobre um export.
 * Este número é medido de novo a cada leitura, sobre o que está no banco agora —
 * e é o que permite à tela dizer "97% reconciliado" em vez de repetir uma
 * medição que pode ter envelhecido. Quando a identidade parar de fechar, a tela
 * mostra isso antes de alguém precisar rodar um script.
 */
async function medirReconciliacoes(
  db: Database,
  context: SeriesContext,
): Promise<Map<string, Reconciliacao>> {
  const pares = COMPOSITIONS.flatMap((c) =>
    c.parts.map((parte) => ({ total: c.total, parte })),
  );
  if (pares.length === 0) return new Map();

  const envolvidos = [
    ...new Set(COMPOSITIONS.flatMap((c) => [c.total, ...c.parts])),
  ];

  /*
    A conta inteira acontece em NUMERIC, dentro do Postgres, e é uma decisão e
    não uma preferência: somar as parcelas em ponto flutuante produz diferenças
    da ordem de 1e-14 e transforma acerto em falha logo na borda do centavo. A
    primeira versão desta função somava em JS e reportava 521 das 533 linhas do
    `finame_cavalo` fechando, contra as 532 que a mesma identidade fecha em
    aritmética exata — onze acertos viraram divergência por causa do tipo.
    É o mesmo cuidado que `composition.ts` registra no método das medições dele.
  */
  const mapa = sql.join(
    pares.map((p) => sql`(${p.total}, ${p.parte})`),
    sql`, `,
  );

  const { rows } = await db.execute<{
    total_code: string;
    linhas: number;
    fecham: number;
  }>(sql`
    WITH mapa(total_code, part_code) AS (VALUES ${mapa}),
    esperado AS (
      SELECT total_code, COUNT(*)::int AS n FROM mapa GROUP BY 1
    ),
    v AS (
      SELECT a.code, f.entity_id, s.effective_date, f.value_numeric
        FROM fact f
        JOIN snapshot s  ON s.id = f.snapshot_id
        JOIN attribute a ON a.id = f.attribute_id
       WHERE a.code = ANY (${listaDeTexto(envolvidos)})
         AND NOT f.is_null
         AND f.value_numeric IS NOT NULL
         AND s.status <> 'SUPERSEDED'
         AND ${contextFilter("s", context)}
    ),
    linha AS (
      SELECT t.code AS total_code,
             t.value_numeric AS total,
             SUM(p.value_numeric) AS soma,
             COUNT(*)::int AS partes,
             e.n
        FROM v t
        JOIN esperado e ON e.total_code = t.code
        JOIN mapa m     ON m.total_code = t.code
        JOIN v p        ON p.code = m.part_code
                       AND p.entity_id = t.entity_id
                       AND p.effective_date = t.effective_date
       -- Total zero não testa identidade nenhuma: zero é igual à soma de três
       -- ausências, e contá-lo como acerto inflaria o percentual com linhas
       -- que não dizem nada.
       WHERE t.value_numeric <> 0
       GROUP BY t.code, t.entity_id, t.effective_date, t.value_numeric, e.n
    )
    SELECT total_code,
           COUNT(*)::int AS linhas,
           COUNT(*) FILTER (WHERE abs(total - soma) <= ${CENTAVO})::int AS fecham
      FROM linha
     -- Uma parcela ausente tira a linha da conta em vez de contar como
     -- divergência: senão o percentual mediria cobertura de coluna, e não
     -- aderência da identidade.
     WHERE partes = n
     GROUP BY 1
  `);

  return new Map(
    rows.map((r) => [
      r.total_code,
      {
        linhas: r.linhas,
        fecham: r.fecham,
        percentual: Math.round((r.fecham / r.linhas) * 1000) / 10,
      },
    ]),
  );
}
