import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  BALCAO_SEM_DADO,
  buscarPlacas,
  CATALOGO,
  matrizDaFrota,
  matrizDoQlp,
  remuneradoDaPlaca,
  remuneradoDoQlp,
  type EscopoDaConsulta,
} from "@workspace/compras";

import { parseContext as parseContextoDaConsulta } from "../lib/contexto";
import { operacaoDaConsulta } from "../lib/operacao";
/**
 * Compras — o remunerado de um produto, antes de o pedido ser liberado.
 *
 * Seis rotas, e nenhuma delas calcula nada:
 *
 * - `/compras/catalogo` — o que se compra e a rubrica do modelo que remunera
 *   cada coisa. Responde com o banco vazio, de propósito: é o mapa, não uma
 *   projeção dos nossos fatos.
 * - `/compras/placas?termo=` — o teclado da tela. Prefixo, no máximo doze.
 * - `/compras/remunerado/frota?placa=` — o balcão da frota: o que a Ambev
 *   remunera naquele veículo, produto a produto, na vigência corrente.
 * - `/compras/remunerado/frota/matriz` — a mesma leitura com o eixo virado: a
 *   frota inteira em linhas, os produtos em colunas. É a resposta a "quanto a
 *   Ambev remunera pneu na frota", que por placa custaria sessenta e quatro
 *   consultas e uma soma feita à mão.
 * - `/compras/remunerado/qlp` — o balcão da estrutura: uniforme, telefonia,
 *   frota leve e benefício com valor unitário, quantidade e despesa.
 * - `/compras/remunerado/qlp/matriz` — o mesmo balcão com o eixo virado: os
 *   cargos em linhas, os produtos em colunas. É a leitura do balcão transposta
 *   por uma função pura, e não uma segunda consulta: os dois desenhos mostram
 *   literalmente o mesmo objeto.
 *
 * **O que esta superfície deliberadamente não faz: comparar com o preço do
 * pedido.** O pedido não está no banco, e um "cobre / não cobre" calculado
 * sobre um preço que o produto não conhece seria um veredito com cara de conta.
 * A tela devolve o remunerado; quem assina compara.
 *
 * A leitura da frota é a mesma de `/composition/equipment/:id` — literalmente,
 * `montarComposicao` — reagrupada por produto. Existisse aqui um segundo
 * caminho até o número, a tela de compra e a ficha do equipamento poderiam
 * divergir, e quem confere um pedido veria um valor que a auditoria não
 * reconhece.
 */
const router: IRouter = Router();

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
function parseContext(query: Record<string, unknown>): EscopoDaConsulta | undefined {
  const pedido = parseContextoDaConsulta(query);
  if (pedido === undefined) return undefined;
  const { janela: _janela, ...semJanela } = pedido;
  return semJanela;
}

function parsePeriod(query: Record<string, unknown>): string | undefined {
  return typeof query.period === "string" && query.period !== "" ? query.period : undefined;
}

/**
 * O catálogo, e o balcão que ainda não abriu.
 *
 * Não toca o banco. É o que permite à tela desenhar a lista de produtos antes
 * de qualquer importação — e dizer, com o banco vazio, o que ela vai responder
 * quando houver dado.
 */
router.get("/compras/catalogo", (_req, res): void => {
  res.json({ produtos: CATALOGO, operacional: BALCAO_SEM_DADO });
});

router.get("/compras/placas", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const termo = typeof query.termo === "string" ? query.termo : "";
  /*
    Termo curto devolve lista vazia, e não erro: quem está digitando a primeira
    letra não cometeu falha nenhuma, e um 400 a cada tecla encheria o log de
    ruído. A regra de quantas letras bastam mora em `buscarPlacas`.
  */
  res.json({
    placas: await buscarPlacas(db, termo, undefined, operacaoDaConsulta(query)),
  });
});

router.get("/compras/remunerado/frota", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const placa = typeof query.placa === "string" ? query.placa.trim() : "";
  if (placa === "") {
    res.status(400).json({ error: "Informe a placa do veículo." });
    return;
  }

  const consulta = await remuneradoDaPlaca(db, placa, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!consulta) {
    /*
      Um 404 só, para dois estados que a tela precisa distinguir — placa
      inexistente e acervo sem vigência. A frase carrega a diferença porque a
      leitura não a carrega: `remuneradoDaPlaca` devolve `null` nos dois casos,
      e inventar aqui um segundo `SELECT` para descobrir qual foi custaria uma
      consulta a cada digitação errada.
    */
    res.status(404).json({
      error: `Nenhum veículo com a placa ${placa} neste acervo — ou nenhuma vigência importada ainda.`,
    });
    return;
  }
  res.json(consulta);
});

/**
 * A matriz — a frota inteira, produto a produto.
 *
 * Vem inteira, sem paginar, pela mesma razão que `/frota/ativos`: uma frota real
 * deste export são 64 cavalos e 80 carretas, e quem confere um pedido de pneu
 * precisa do rodapé da coluna — um "há mais" no fim da página tornaria o total
 * uma soma da primeira página, que é pior do que total nenhum.
 *
 * `entityType` aceita repetição (`?entityType=CAVALO&entityType=CARRETA`) e é
 * opcional: sem ele, `TIPOS_DA_MATRIZ` responde. Um tipo sem regra declarada
 * não é recusado aqui como em `/frota/panorama` — `regraDe` já tem o padrão
 * permissivo, e a matriz sai vazia dizendo que a vigência não trouxe aquele
 * equipamento, que é uma frase sobre o arquivo e não sobre o nosso código.
 */
router.get("/compras/remunerado/frota/matriz", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const pedidos = Array.isArray(query.entityType)
    ? query.entityType
    : query.entityType !== undefined
      ? [query.entityType]
      : [];
  const entityTypes = pedidos
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t !== "");

  const matriz = await matrizDaFrota(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
    ...(entityTypes.length > 0 ? { entityTypes } : {}),
  });
  if (!matriz) {
    res.status(404).json({ error: "Nenhuma vigência importada ainda." });
    return;
  }
  res.json(matriz);
});

router.get("/compras/remunerado/qlp", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const consulta = await remuneradoDoQlp(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!consulta) {
    res.status(404).json({ error: "Nenhuma vigência de QLP Administrativo importada ainda." });
    return;
  }
  res.json(consulta);
});

/**
 * A matriz do QLP — os cargos em linhas, os produtos em colunas.
 *
 * Chama a mesma `remuneradoDoQlp` da rota acima e transpõe o resultado com
 * `matrizDoQlp`, que é pura. Não há segunda consulta e não há segundo cálculo:
 * a célula da matriz é o mesmo objeto que a linha da tabela do produto.
 *
 * A célula leva os três papéis — unitário, quantidade e despesa —, e a tela
 * escolhe qual mostrar. Devolver só o papel pedido faria três consultas para
 * três perguntas sobre a mesma vigência, e a terceira poderia chegar de uma
 * importação diferente das duas primeiras.
 */
router.get("/compras/remunerado/qlp/matriz", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const consulta = await remuneradoDoQlp(db, {
    ...(parsePeriod(query) !== undefined ? { period: parsePeriod(query)! } : {}),
    ...(parseContext(query) !== undefined ? { context: parseContext(query)! } : {}),
  });
  if (!consulta) {
    res.status(404).json({ error: "Nenhuma vigência de QLP Administrativo importada ainda." });
    return;
  }
  res.json({ ...matrizDoQlp(consulta), operacional: consulta.operacional });
});

export default router;
