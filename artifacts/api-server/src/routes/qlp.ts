import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  codigosDoQuadro,
  conferirAbono,
  conferirBenchmark,
  conferirLinha,
  resumirQuadro,
  resumoDasContas,
  TIPO_DO_QUADRO,
  type LinhaDoQuadro,
  type QuadroDeQlp,
  type RequestedContext,
} from "@workspace/comparison";
import {
  lerQuadroParaAuditoria,
  getDetalheDoCargo,
  getEvolucaoDoQuadro,
  getInconsistenciasDoQuadro,
  getQuadroAdministrativo,
  type FiltrosDoQuadro,
} from "@workspace/qlp";

import { parseContext as parseContextoDaConsulta } from "../lib/contexto";
/**
 * QLP Administrativo — o quadro de pessoal da estrutura administrativa.
 *
 * Quatro rotas, uma por pergunta:
 *
 * - `/qlp/administrativo` — o quadro de uma vigência: cargos por unidade, os
 *   valores que o export declarou e o resumo executivo. Efetivo e custo saem
 *   travados, com o motivo por extenso, enquanto a curadoria não confirmar a
 *   semântica — o portão é o mesmo da Composição e da DRE.
 * - `/qlp/administrativo/entidades/:entityId` — a ficha de um cargo: os fatos
 *   da vigência com a semântica de cada um e a célula de origem (arquivo, aba,
 *   linha, coluna, valor bruto), no mesmo SELECT.
 * - `/qlp/administrativo/evolucao` — a série: presença de cada cargo por
 *   quinzena e contagens de estrutura, com janela De/Até.
 * - `/qlp/administrativo/inconsistencias` — o que **não** entrou: os registros
 *   que a importação deixou em quarentena porque a planilha os trazia duas
 *   vezes com valores que discordam. É a contrapartida obrigatória da
 *   quarentena por chave — o arquivo entra, e o que ficou de fora se lê aqui.
 *
 * O que estas rotas deliberadamente **não** respondem: diferença de valor entre
 * vigências. Isso é comparação, a comparação é do motor canônico, e a tela a
 * pede pelos endpoints de change-set que já existem (`POST /change-sets`,
 * `GET /change-sets/:id/changes`, `GET /changes/:id/provenance`) — as vigências
 * de QLP são snapshots como quaisquer outros e o motor as compara entre si.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SEM_QLP = "Nenhuma vigência de QLP Administrativo importada ainda.";

/**
 * O contexto pedido — **a mesma leitura de `lib/contexto.ts`**, sem a janela.
 *
 * Era uma cópia local, e a cópia era inofensiva enquanto o contexto fosse
 * unidade e canal. Deixou de ser quando a operação entrou: quatro rotas com
 * quatro parsers próprios são quatro chances de uma delas não recortar por
 * operação — e a que não recortasse mostraria, dentro da Auditoria Rota, a
 * composição, a DRE ou o balcão de compras da empurrada, sem nada na tela
 * dizendo isso. Agora o parser é um só, e é o mesmo que as onze outras rotas
 * usam.
 *
 * A janela sai porque estas leituras não a aceitam: elas respondem por **uma**
 * vigência, e um recorte de série aqui mudaria a lista do seletor sem que a
 * resposta mudasse junto — ver o cabeçalho de `routes/frota.ts`.
 */
function parseContext(query: Record<string, unknown>): RequestedContext | undefined {
  const pedido = parseContextoDaConsulta(query);
  if (pedido === undefined) return undefined;
  const { janela: _janela, ...semJanela } = pedido;
  return semJanela;
}

/**
 * A janela De/Até — só a evolução a lê. As leituras de uma vigência não
 * aceitam recorte de série de propósito: a janela mudaria a lista de vigências
 * do seletor, e um seletor que encolhe conforme o filtro é o defeito que
 * `routes/frota.ts` documenta.
 */
function parseJanela(query: Record<string, unknown>): RequestedContext["janela"] {
  const de = typeof query.de === "string" && query.de !== "" ? query.de : undefined;
  const ate = typeof query.ate === "string" && query.ate !== "" ? query.ate : undefined;
  if (de === undefined && ate === undefined) return null;
  return { ...(de !== undefined ? { de } : {}), ...(ate !== undefined ? { ate } : {}) };
}

function parsePeriod(query: Record<string, unknown>): string | undefined {
  return typeof query.period === "string" && query.period !== "" ? query.period : undefined;
}

function parseFiltros(query: Record<string, unknown>): FiltrosDoQuadro {
  return {
    ...(typeof query.busca === "string" && query.busca !== "" ? { busca: query.busca } : {}),
    ...(typeof query.unidade === "string" && query.unidade !== ""
      ? { unidade: query.unidade }
      : {}),
  };
}

router.get("/qlp/administrativo", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const view = await getQuadroAdministrativo(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    filtros: parseFiltros(query),
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

router.get("/qlp/administrativo/evolucao", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const janela = parseJanela(query);
  const view = await getEvolucaoDoQuadro(db, {
    context: { ...parseContext(query), ...(janela ? { janela } : {}) },
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

/**
 * A fila do que falta, e não um retrato da vigência selecionada.
 *
 * `period` é aceito — ele decide a vigência corrente do contexto devolvido, que
 * a tela usa para se situar —, mas a lista de pendências é do contexto inteiro:
 * dado que falta não deixa de faltar por estarmos olhando outra quinzena. Ver
 * `lib/qlp/src/inconsistencias.ts`.
 */
router.get("/qlp/administrativo/inconsistencias", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const view = await getInconsistenciasDoQuadro(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!view) {
    res.status(404).json({ error: SEM_QLP });
    return;
  }
  res.json(view);
});

router.get("/qlp/administrativo/entidades/:entityId", async (req, res): Promise<void> => {
  const { entityId } = req.params;
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de cargo inválido." });
    return;
  }
  const query = req.query as Record<string, unknown>;
  const detalhe = await getDetalheDoCargo(db, entityId, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!detalhe) {
    res.status(404).json({ error: "Cargo não encontrado, ou nenhum QLP importado ainda." });
    return;
  }
  res.json(detalhe);
});

/**
 * A AUDITORIA DO QUADRO — as contas que o próprio quadro declara.
 *
 * `GET /qlp/auditoria?quadro=ADMINISTRATIVO|OPERACIONAL&period=<data>`
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota não compara vigências
 * ---------------------------------------------------------------------------
 * Porque a comparação já tem dono, e está dito no cabeçalho deste arquivo: as
 * vigências de QLP são snapshots como quaisquer outros, e o motor canônico as
 * compara pelos endpoints de change-set. O que não tinha rota é a conferência
 * **dentro** de uma vigência: `quantidade × valor = despesa` no administrativo,
 * e a cadeia dos subtotais no operacional.
 *
 * Nenhuma conta mora aqui. `@workspace/comparison/qlp` confere, e esta rota lê o
 * quadro e devolve — é a mesma divisão das seis auditorias de rubrica.
 *
 * **A leitura é a do quadro** (`lerQuadroParaAuditoria`), e não a genérica de
 * entidade: o QLP forma vigências próprias, na família QUADRO_DE_PESSOAL, e a
 * leitura genérica resolve o contexto na família de equipamento — ver o
 * cabeçalho de `lib/qlp/src/auditoria.ts`. É dela que vem também o nome legível
 * de cada cargo: a chave que o acervo guarda é `20618821000799AUXILIARADM`, e
 * sem a forma legível a tela listaria trinta linhas que ninguém distingue.
 */
router.get("/qlp/auditoria", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const pedido = typeof query.quadro === "string" ? query.quadro.toUpperCase() : "";
  if (pedido !== "ADMINISTRATIVO" && pedido !== "OPERACIONAL") {
    res.status(400).json({ error: "Informe quadro=ADMINISTRATIVO ou quadro=OPERACIONAL." });
    return;
  }
  const quadro = pedido as QuadroDeQlp;

  /*
    A leitura é a do **quadro**, e não a genérica de entidade.

    `getEntityTable` resolve o contexto pelo padrão do produto, que é a família
    de equipamento: com o QLP importado, a data mais recente do contexto era a
    do cavalo e esta tela vinha vazia nos dois quadros — e, com `?period=` de
    uma quinzena de QLP, respondia 404 sobre um acervo que tinha o arquivo. Ver
    o cabeçalho de `lib/qlp/src/auditoria.ts`.
  */
  const tabela = await lerQuadroParaAuditoria(
    db,
    TIPO_DO_QUADRO[quadro],
    codigosDoQuadro(quadro),
    {
      ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
      ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    },
  );

  /*
    404 aqui não é defeito: é "nenhuma vigência deste quadro importada ainda", e
    esse estado tem tela própria — o mesmo desenho das outras rotas deste
    arquivo. No operacional ele é a resposta esperada até o primeiro export
    chegar, e a tela diz isso em vez de mostrar um quadro vazio.
  */
  if (!tabela) {
    res.status(404).json({
      error:
        quadro === "ADMINISTRATIVO"
          ? SEM_QLP
          : "Nenhuma vigência de QLP Operacional importada ainda.",
    });
    return;
  }

  const linhas: LinhaDoQuadro[] = tabela.linhas.map((linha) => {
    const valores: Record<string, number | null> = {};
    for (const code of codigosDoQuadro(quadro)) {
      valores[code] = comoNumero(linha.valores[code] ?? null);
    }
    return { chave: linha.chave, nome: linha.nome, valores };
  });

  res.json({
    quadro,
    /* O diagnóstico da leitura viaja junto: uma tabela vazia com colunas
       desconhecidas tem duas causas com conserto oposto, e a leitura do quadro
       já as distingue. */
    serieEntregue: tabela.serieEntregue,
    colunasDesconhecidas: tabela.colunasDesconhecidas,
    resumo: resumirQuadro(linhas, quadro),
    contas: resumoDasContas(linhas, quadro),
    benchmark: quadro === "ADMINISTRATIVO" ? conferirBenchmark(linhas) : null,
    abono: quadro === "OPERACIONAL" ? conferirAbono(linhas) : null,
    linhas: linhas.map((l) => conferirLinha(l, quadro)),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * Nesta rubrica o branco decide um veredito: `Number("")` é `0`, e uma
 * quantidade zero inventada pela conversão faria a conta esperar R$ 0,00 e
 * acusar de divergência uma linha que só está incompleta.
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

export default router;
