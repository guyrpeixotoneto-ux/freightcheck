import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  MODULO_DO_CARGO,
  SITUACOES_DA_EQUIPE,
  TIPO_DO_QUADRO,
  codigoDoEfetivo,
  codigosDoQuadro,
  computeChangeSet,
  consolidarEquipe,
  getChangeSetForPair,
  linhasDeQlpComparado,
  listChanges,
  listComparableSnapshots,
  modulosDoQlp,
  motivoSemPar,
  normalizarLinhasDeEquipe,
  operacaoDoSnapshot,
  quadroDoMonitor,
  resumirModulosDeEquipe,
  somarEfetivo,
  vigenciasQueCobrem,
  type LinhaDoMonitorDeEquipe,
  type ParDoMonitorDeEquipe,
  type QuadroDeQlp,
  type SituacaoDaLinhaDeEquipe,
  type VigenciaEmparelhavel,
} from "@workspace/comparison";
import { DATASET_FAMILY_QUADRO_DE_PESSOAL } from "@workspace/ingest/tipos";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";

/**
 * MONITOR EQUIPE — os módulos do quadro de pessoal numa resposta só.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota também é curta
 * ---------------------------------------------------------------------------
 * Pela mesma razão que a do Monitor Custo Fixo: ela não compara e não agrega. O
 * motor compara, `listChanges` lê, `qlp-comparacao.ts` traduz,
 * `monitor-equipe.ts` compõe — e aqui só se costura. Uma rota que fizesse conta
 * própria seria a segunda régua da mesma pergunta, e a primeira a divergir
 * seria esta, que é a que consolida as outras.
 *
 * ---------------------------------------------------------------------------
 * Duas leituras, porque são duas séries
 * ---------------------------------------------------------------------------
 * O administrativo e o operacional são a mesma família (`QUADRO_DE_PESSOAL`) e
 * séries próprias dentro dela: o motor recusa um par entre coberturas
 * diferentes. Então o par é **por quadro**, e cada quadro tem o `change_set`
 * dele — duas leituras, e não uma. É o contrário do Monitor Custo Fixo, onde os
 * quatro módulos leem a mesma família e uma leitura basta; e é exatamente o
 * caso que `ParDoMonitor` antecipou ao recusar publicar o par como campo único
 * do consolidado.
 *
 * Um quadro sem par não some da resposta: ele volta com `ausente` preenchido,
 * com a frase que `motivoSemPar` decide. Sumir com ele faria a ausência parecer
 * escolha da tela.
 *
 * ---------------------------------------------------------------------------
 * O que os filtros fazem
 * ---------------------------------------------------------------------------
 * Eles **recortam as linhas**, e os agregados saem sobre o recorte — recorte
 * antes do resumo, como lá, que é o que impede o cartão de contradizer a
 * tabela. Aqui não há um segundo passo de "pedir o impacto ao módulo" porque
 * não há impacto: todo agregado desta tela é contagem, e contagem de um
 * subconjunto é a contagem daquele subconjunto.
 *
 * ---------------------------------------------------------------------------
 * O que esta rota nunca devolve
 * ---------------------------------------------------------------------------
 * Um número em reais. As colunas do QLP chegam sem semântica confirmada, e o
 * consolidado publica, no lugar onde o Monitor Custo Fixo publica dinheiro, a
 * frase que diz por que ele não existe — a mesma de `/qlp/comparacao`, e não
 * uma segunda redação dela.
 */
const router: IRouter = Router();

const QUADROS: readonly QuadroDeQlp[] = ["OPERACIONAL", "ADMINISTRATIVO"];

/** Um parâmetro de consulta que pode vir repetido, normalizado em lista. */
function lista(valor: unknown): string[] {
  if (typeof valor === "string") {
    return valor
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
  }
  if (Array.isArray(valor)) return valor.flatMap((v) => lista(v));
  return [];
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor.trim() : null;
}

/**
 * Os filtros, já validados contra o que existe.
 *
 * **Valor inválido não esvazia a tela**, e é a mesma decisão do Monitor Custo
 * Fixo: um `modulo=CAFE` na URL — de um link velho, de um typo — cai no padrão
 * e a tela avisa que ignorou. Recortar por um valor que não existe daria zero
 * linhas, correto e inexplicável.
 *
 * A lista de módulos válidos sai do **catálogo** (`modulosDoQlp`), e não de uma
 * constante escrita aqui: é o catálogo que decide quais assuntos existem, e uma
 * segunda lista recusaria amanhã a rubrica que a lateral já oferece.
 */
export interface FiltrosDoMonitorDeEquipe {
  modulos: string[];
  quadros: QuadroDeQlp[];
  situacoes: SituacaoDaLinhaDeEquipe[];
  busca: string | null;
}

export function modulosValidos(): string[] {
  return [...modulosDoQlp().map((m) => m.chave), MODULO_DO_CARGO];
}

export function parseFiltrosDeEquipe(query: Record<string, unknown>): {
  filtros: FiltrosDoMonitorDeEquipe;
  ignorados: string[];
} {
  const ignorados: string[] = [];
  const validos = modulosValidos();

  const pedidos = lista(query.modulo);
  const modulos = pedidos.filter((m) => validos.includes(m));
  for (const m of pedidos) {
    if (!validos.includes(m)) ignorados.push(`módulo "${m}"`);
  }

  const quadrosPedidos = lista(query.quadro).map((q) => q.toUpperCase());
  const quadros = quadrosPedidos.filter((q): q is QuadroDeQlp =>
    (QUADROS as readonly string[]).includes(q),
  );
  for (const q of quadrosPedidos) {
    if (!(QUADROS as readonly string[]).includes(q)) ignorados.push(`quadro "${q}"`);
  }

  const situacoesPedidas = lista(query.situacao).map((s) => s.toUpperCase());
  const situacoes = situacoesPedidas.filter((s): s is SituacaoDaLinhaDeEquipe =>
    (SITUACOES_DA_EQUIPE as readonly string[]).includes(s),
  );
  for (const s of situacoesPedidas) {
    if (!(SITUACOES_DA_EQUIPE as readonly string[]).includes(s)) {
      ignorados.push(`situação "${s}"`);
    }
  }

  return {
    filtros: {
      modulos,
      quadros: quadros.length > 0 ? quadros : [...QUADROS],
      situacoes,
      busca: texto(query.busca),
    },
    ignorados,
  };
}

export function passaNoModulo(l: LinhaDoMonitorDeEquipe, modulos: string[]): boolean {
  return modulos.length === 0 || modulos.includes(l.modulo);
}

export function passaNaSituacaoDeEquipe(
  l: LinhaDoMonitorDeEquipe,
  situacoes: SituacaoDaLinhaDeEquipe[],
): boolean {
  return situacoes.length === 0 || situacoes.includes(l.situacao.tipo);
}

/**
 * A busca lê o **rótulo do cargo** quando há um, e a chave quando não há.
 *
 * O motor grava em `entity_label` a chave normalizada
 * (`07526557001505CARGOGERENTE…`), e quem procura "gerente" está procurando a
 * forma legível — que o acervo tem e que esta rota devolve no dicionário de
 * rótulos. Buscar só na chave faria a caixa parecer quebrada em toda busca por
 * nome de cargo; buscar só no rótulo perderia quem colou a chave de um link.
 */
export function passaNaBuscaDeEquipe(
  l: LinhaDoMonitorDeEquipe,
  busca: string | null,
  rotulos: Record<string, string>,
): boolean {
  if (busca === null) return true;
  const alvo = busca.toLowerCase();
  return (
    l.cargo.chave.toLowerCase().includes(alvo) ||
    (rotulos[l.cargo.chave] ?? "").toLowerCase().includes(alvo) ||
    l.variavel.rotulo.toLowerCase().includes(alvo) ||
    (l.variavel.attributeCode ?? "").toLowerCase().includes(alvo) ||
    l.modulo.toLowerCase().includes(alvo)
  );
}

/**
 * Por que este quadro não entrou — a frase, e não um booleano.
 *
 * `motivoSemPar` separa "não importaram" de "importaram uma só" de "são de
 * unidades diferentes", e cada um pede uma frase diferente de quem lê. A
 * quarta razão não vem dele: é o par que a tela **não escolheu**, quando ela
 * pediu um quadro só.
 */
export function motivoDoQuadroAusente(
  quadro: QuadroDeQlp,
  vigencias: readonly VigenciaEmparelhavel[],
  pediuPar: boolean,
): string | null {
  if (pediuPar) return null;
  const motivo = motivoSemPar(vigencias);
  const nome = quadro === "ADMINISTRATIVO" ? "administrativo" : "operacional";
  if (!motivo) {
    return `Nenhum par foi escolhido para o quadro ${nome} nesta leitura.`;
  }
  switch (motivo.motivo) {
    case "LISTA_VAZIA":
      return `Nenhuma vigência do quadro ${nome} foi importada ainda.`;
    case "UMA_SO":
      return `Só uma vigência do quadro ${nome} foi importada — comparar exige duas.`;
    case "UNIDADES_DIFERENTES":
      return (
        `As vigências do quadro ${nome} desta lista são de unidades diferentes, e o ` +
        `motor não compara unidades distintas. Escolha uma unidade na lateral.`
      );
    default:
      return (
        `As vigências do quadro ${nome} chegaram cobrindo conjuntos diferentes de ` +
        `entidade (${motivo.coberturas.join(" e ")}), e o motor só compara ` +
        `vigências de mesma cobertura.`
      );
  }
}

/**
 * O efetivo somado de uma ponta — a leitura por snapshot, e não pelo quadro.
 *
 * É a mesma consulta que `/qlp/comparacao` faz, e pela mesma razão: a leitura
 * consolidada do quadro responde por todas as unidades autorizadas, enquanto o
 * par é de um escopo só. Medir pelo consolidado daria a diferença de todas as
 * unidades ao lado de uma lista de alterações de uma.
 */
async function efetivoDaPonta(
  quadro: QuadroDeQlp,
  snapshotId: string,
): Promise<number | null> {
  const codigo = codigoDoEfetivo(quadro);
  const { rows } = await db.execute<{ valor: string | null }>(sql`
    SELECT CASE WHEN f.is_null THEN NULL ELSE f.value_numeric::text END AS valor
      FROM fato_visivel f
      JOIN attribute a ON a.id = f.attribute_id
     WHERE f.snapshot_id = ${snapshotId}::uuid
       AND a.code = ${codigo}
  `);
  return somarEfetivo(rows.map((linha) => linha.valor));
}

/**
 * Os cargos deste quadro, da chave normalizada para a forma legível.
 *
 * Uma consulta por quadro, e não uma por linha: a tabela repete o mesmo cargo
 * em várias variáveis. A mesma leitura de `/qlp/comparacao` — e o mesmo
 * contrato: sem entrada no dicionário, a tela cai na chave, que é menos bonita
 * e igualmente verdadeira.
 */
async function rotulosDosCargos(entityType: string): Promise<Record<string, string>> {
  const { rows } = await db.execute<{ valor: string; legivel: string | null }>(sql`
    SELECT ei.identifier_value AS valor,
           ei.identifier_value_raw AS legivel
      FROM entity_identifier ei
      JOIN entity e ON e.id = ei.entity_id
     WHERE ei.identifier_type = 'PLACA'
       AND ei.is_current
       AND e.entity_type = ${entityType}
  `);
  const rotulos: Record<string, string> = {};
  for (const linha of rows) {
    if (linha.legivel !== null && linha.legivel !== linha.valor) {
      rotulos[linha.valor] = linha.legivel;
    }
  }
  return rotulos;
}

/** O par que o endereço pede para um quadro, quando pede os dois lados. */
function parPedido(
  query: Record<string, unknown>,
  quadro: QuadroDeQlp,
): { base: string; comparada: string } | null {
  const sufixo = quadro === "ADMINISTRATIVO" ? "Administrativo" : "Operacional";
  const base = texto(query[`base${sufixo}`]);
  const comparada = texto(query[`comparada${sufixo}`]);
  return base && comparada ? { base, comparada } : null;
}

/**
 * `GET /monitor-equipe/consolidado`
 *
 * O par vai **por quadro**: `baseOperacional`/`comparadaOperacional` e
 * `baseAdministrativo`/`comparadaAdministrativo`. Nenhum dos dois é
 * obrigatório — sem nenhum, a resposta é a tela dizendo, quadro a quadro, por
 * que não há o que mostrar, que é diferente de uma tela vazia.
 *
 * Mais os filtros: `modulo`, `quadro`, `situacao`, `busca` — todos repetíveis
 * ou separados por vírgula, todos opcionais, e nenhum deles capaz de esvaziar a
 * tela por um valor inválido.
 */
router.get("/monitor-equipe/consolidado", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const { filtros, ignorados } = parseFiltrosDeEquipe(query);

  const pares = new Map<QuadroDeQlp, { base: string; comparada: string }>();
  for (const quadro of QUADROS) {
    const par = parPedido(query, quadro);
    if (par && filtros.quadros.includes(quadro)) pares.set(quadro, par);
  }

  for (const par of pares.values()) {
    for (const id of [par.base, par.comparada]) {
      await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
    }
  }

  try {
    const vigencias = await listComparableSnapshots(db, {
      datasetFamily: DATASET_FAMILY_QUADRO_DE_PESSOAL,
      operacao: operacaoDaConsulta(query),
    });

    const linhas: LinhaDoMonitorDeEquipe[] = [];
    const quadros = [];
    const rotulos: Record<string, string> = {};
    const changeSets: Record<string, string> = {};

    for (const quadro of QUADROS) {
      const tipo = TIPO_DO_QUADRO[quadro];
      const doQuadro = vigenciasQueCobrem(vigencias, tipo);
      const par = filtros.quadros.includes(quadro) ? pares.get(quadro) : undefined;

      if (!par) {
        quadros.push(
          quadroDoMonitor(
            quadro,
            null,
            [],
            null,
            filtros.quadros.includes(quadro)
              ? motivoDoQuadroAusente(quadro, doQuadro, false)
              : `Este quadro está fora do recorte escolhido nos filtros.`,
          ),
        );
        continue;
      }

      /*
        Reaproveita a comparação já calculada; só manda calcular quando ela não
        existe. É o mesmo caminho de `/qlp/comparacao` — e é o que faz as duas
        telas responderem o mesmo número para o mesmo par.
      */
      const changeSet =
        (await getChangeSetForPair(db, par.base, par.comparada)) ??
        (await computeChangeSet(db, par.base, par.comparada, {
          computedBy: "api:monitor-equipe",
        }));
      changeSets[quadro] = changeSet.id;

      const { rows } = await listChanges(db, changeSet.id, {
        attributeCodes: codigosDoQuadro(quadro),
        entityType: tipo,
        limit: 5000,
      });

      const snapshotA = doQuadro.find((v) => v.id === par.base);
      const snapshotB = doQuadro.find((v) => v.id === par.comparada);
      const parDoQuadro: ParDoMonitorDeEquipe = {
        quadro,
        baseId: par.base,
        comparadaId: par.comparada,
        baseRotulo: snapshotA?.sourceLabel ?? null,
        comparadaRotulo: snapshotB?.sourceLabel ?? null,
        baseData: snapshotA?.effectiveDate ?? null,
        comparadaData: snapshotB?.effectiveDate ?? null,
      };

      Object.assign(rotulos, await rotulosDosCargos(tipo));

      const normalizadas = normalizarLinhasDeEquipe(
        linhasDeQlpComparado(rows, quadro),
        parDoQuadro,
        changeSet.id,
      );
      /*
        O recorte acontece **antes** do resumo, e é por isso que o cartão e a
        tabela nunca se contradizem: o número que o cartão publica é a contagem
        de exatamente estas linhas.
      */
      const visiveis = normalizadas.filter(
        (l) =>
          passaNoModulo(l, filtros.modulos) &&
          passaNaSituacaoDeEquipe(l, filtros.situacoes) &&
          passaNaBuscaDeEquipe(l, filtros.busca, rotulos),
      );

      /*
        O efetivo das **duas pontas**, e não o que a lista de alterações
        registra: um cargo que sai do quadro é uma linha só no motor, sem
        atributo, então o efetivo dele não aparece em alteração nenhuma.
      */
      const [base, comparada] = await Promise.all([
        efetivoDaPonta(quadro, par.base),
        efetivoDaPonta(quadro, par.comparada),
      ]);

      linhas.push(...visiveis);
      quadros.push(
        quadroDoMonitor(quadro, parDoQuadro, visiveis, { base, comparada }, null),
      );
    }

    /* A ordem dos módulos é a do catálogo — ver `resumirModulosDeEquipe`. */
    const resumo = consolidarEquipe(
      resumirModulosDeEquipe(
        linhas,
        modulosDoQlp().map((m) => m.chave),
      ),
      quadros,
    );

    res.json({
      changeSets,
      resumo,
      linhas,
      rotulos,
      filtros,
      /*
        O que a resposta ignorou, dito por extenso. Um filtro inválido que
        sumisse em silêncio deixaria a tela mostrando mais linhas do que o
        usuário pediu, sem explicação — e o contrário, se ele recortasse, seria
        uma tela vazia sem explicação.
      */
      ignorados,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Consolidado do Monitor Equipe recusado");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
