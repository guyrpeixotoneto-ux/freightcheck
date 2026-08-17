import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ContextNotFoundError,
  analiseDeFrota,
  linhasDeEquipamento,
  type SeriesContext,
} from "@workspace/comparison";

/**
 * Análise de frota — a tela que mostrava zero, e por quê.
 *
 * ---------------------------------------------------------------------------
 * O que saiu daqui
 * ---------------------------------------------------------------------------
 *
 * Esta rota lia um `.xlsx` de `attached_assets` em runtime. `findExcelFile`
 * pegava o **primeiro** arquivo em ordem alfabética — `Modelo_Carreta.xlsx` —,
 * e procurava dentro dele as abas `carretas` e `cavalos`. Aquele arquivo tem
 * uma aba só, chamada `Modelo_Carreta`.
 *
 * `XLSX.utils.sheet_to_json(undefined)` devolve `[]` sem reclamar. A tela ficava
 * com zero linhas, todo campo do resumo em zero, e 657 linhas esperando no
 * arquivo. Nenhum erro em log, nenhuma tela de falha: a resposta era um sucesso
 * vazio. Foi o caso literal que abriu esta auditoria — o dado existe e o módulo
 * diz que não há dados.
 *
 * Era também a **fonte paralela de leitura** que a Parte A do baseline nomeia:
 * um número na tela que não vinha do canônico, não passava por curadoria, não
 * tinha vigência nem escopo, e não era rastreável até célula nenhuma. Duas
 * portas de entrada, e esta rota lia por uma terceira.
 *
 * ---------------------------------------------------------------------------
 * O que entrou no lugar
 * ---------------------------------------------------------------------------
 *
 * `analiseDeFrota` e `linhasDeEquipamento`, em `@workspace/comparison`. A rota
 * **não calcula**: ela chama a autoridade e traduz o formato para o que a tela
 * lê, como `routes/coverage.ts` já faz. A forma da resposta é a mesma que o ADR
 * registra e que `fleet-analysis-contrato.test.ts` prende — a tela não muda uma
 * linha.
 *
 * Duas coisas na resposta são novas, e nenhuma delas quebra a tela:
 * `manutencaoCavalos` pode vir `null` com o motivo em `naoCalculavel`, porque
 * dividir por doze sem saber a periodicidade era palpite; e `ausencias` conta,
 * por campo, quantas entidades tinham a coluna entregue e sem valor — a soma
 * passou a ser do que existe, e o que faltou vem dito em vez de virar zero.
 *
 * Ver `docs/ADR-FLEET-ANALYSIS-CANONICO.md`.
 */
const router: IRouter = Router();

/**
 * O de-para de coluna: código canônico → o nome que a tela espera.
 *
 * A tela lê `custoFixo`; o canônico guarda `carreta.custo_fixo`. A tradução
 * mora aqui, e não na biblioteca, porque é ela que conhece o formato da tela —
 * a biblioteca fala em código de atributo, que é a linguagem do dado.
 */
const COLUNAS_DA_CARRETA: Record<string, string> = {
  "carreta.implemento": "implemento",
  "carreta.modelo": "modelo",
  "carreta.ano": "ano",
  "carreta.custo_fixo": "custoFixo",
  "carreta.finame_implemento": "finameImplemento",
  "carreta.seguro": "seguro",
  "carreta.ipva_licenciamento": "ipvaLicenciamento",
  "carreta.valor_nf_compra": "valorNfCompra",
  "carreta.status_financiamento": "statusFinanciamento",
};

const COLUNAS_DO_CAVALO: Record<string, string> = {
  "cavalo.placa_carreta": "Placa Carreta",
  "cavalo.montadora": "montadora",
  "cavalo.ano_bid": "anoBid",
  "cavalo.ativo": "ativo",
  "cavalo.faixa_km": "faixaKm",
  "cavalo.finame_cavalo": "finameCavalo",
  "cavalo.manutencao_ano": "manutencaoAno",
  "cavalo.reaiskm": "reaiskm",
  "cavalo.valor_nf_compra": "valorNfCompra",
};

/** O contexto pedido, quando pedido. Nada pedido é o censo, como no Painel. */
function parseContext(query: Record<string, unknown>): Partial<SeriesContext> | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== ""
      ? query.scopeHash
      : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

/**
 * Traduz uma linha canônica para o formato da tela.
 *
 * O que **não** é traduzido: `Placa`, `Operador - Nome` e `Vigencia` já vêm com
 * o nome da tela, porque não são fato — são identidade, escopo e a vigência que
 * os produziu. A descoberta de que duas colunas da tabela não estão em `fact`
 * foi a que mais mudou esta migração; uma versão que as procurasse lá concluiria
 * que o dado sumiu.
 */
function traduzir(
  linha: Record<string, unknown>,
  colunas: Record<string, string>,
): Record<string, unknown> {
  const saida: Record<string, unknown> = {
    Placa: linha.Placa ?? null,
    "Operador - Nome": linha["Operador - Nome"] ?? null,
    Vigencia: linha.Vigencia ?? null,
  };
  for (const [code, nome] of Object.entries(colunas)) {
    const bruto = linha[code];
    // Número continua número: a tela formata moeda e ordena por valor, e uma
    // string ali viraria ordenação alfabética silenciosa.
    const numero = bruto === null || bruto === undefined ? null : Number(bruto);
    saida[nome] =
      numero !== null && !Number.isNaN(numero) ? numero : ((bruto as string) ?? null);
  }
  return saida;
}

function responderErro(res: Parameters<Parameters<IRouter["get"]>[1]>[1], err: unknown) {
  if (err instanceof ContextNotFoundError) {
    res.status(404).json({ error: err.message });
    return true;
  }
  return false;
}

router.get("/fleet-analysis/summary", async (req, res): Promise<void> => {
  try {
    const analise = await analiseDeFrota(db, parseContext(req.query as Record<string, unknown>));
    res.json(analise);
  } catch (err) {
    if (responderErro(res, err)) return;
    req.log.error({ err }, "Error building fleet analysis summary");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/fleet-analysis/carretas", async (req, res): Promise<void> => {
  try {
    const q = req.query as Record<string, unknown>;
    const linhas = await linhasDeEquipamento(db, "CARRETA", Object.keys(COLUNAS_DA_CARRETA), {
      vigencia: typeof q.vigencia === "string" && q.vigencia !== "" ? q.vigencia : undefined,
      contexto: parseContext(q),
    });
    res.json(linhas.map((l) => traduzir(l, COLUNAS_DA_CARRETA)));
  } catch (err) {
    if (responderErro(res, err)) return;
    req.log.error({ err }, "Error listing fleet carretas");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/fleet-analysis/cavalos", async (req, res): Promise<void> => {
  try {
    const q = req.query as Record<string, unknown>;
    const linhas = await linhasDeEquipamento(db, "CAVALO", Object.keys(COLUNAS_DO_CAVALO), {
      vigencia: typeof q.vigencia === "string" && q.vigencia !== "" ? q.vigencia : undefined,
      contexto: parseContext(q),
    });
    res.json(linhas.map((l) => traduzir(l, COLUNAS_DO_CAVALO)));
  } catch (err) {
    if (responderErro(res, err)) return;
    req.log.error({ err }, "Error listing fleet cavalos");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
