import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  acrescentarRoteiro,
  arquivarFluxo,
  atualizarConexao,
  atualizarEtapa,
  atualizarFluxo,
  CATALOGO,
  criarConexao,
  criarEtapa,
  criarFluxo,
  desligarSubfluxo,
  detalharEtapa,
  duplicarFluxo,
  ehEspecieDeItem,
  ehStatusDoFluxo,
  excluirConexao,
  excluirEtapa,
  FluxoNaoEncontrado,
  importarFluxo,
  interpretarRoteiro,
  lerFluxo,
  ligarSubfluxo,
  listarFluxos,
  MODELOS,
  modeloPorSlug,
  modelosJaMapeados,
  organizarFluxo,
  RecusaDeFluxo,
  reposicionarEtapas,
  semearModelos,
  substituirAcoes,
  substituirIndicadores,
  substituirItens,
  trocarStatus,
  validarPosicoes,
} from "@workspace/fluxos";
import type { FluxoDeclarado } from "@workspace/fluxos";
import {
  autorDaRequisicao,
  resolverEmpresa,
} from "../lib/empresa-da-requisicao";
import { instrumentarCicloDaRequisicao } from "../lib/observabilidade";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";

/**
 * FLUXOS OPERACIONAIS — a superfície HTTP do motor.
 *
 * Esta rota **não decide nada de domínio**. Ela faz três coisas: resolve de
 * quem é a requisição (`resolverEmpresa`), traduz caminho e corpo em chamada de
 * `@workspace/fluxos`, e devolve o que veio. Toda validação, toda recusa e todo
 * escopo moram no motor — o que significa que o teste do motor cobre o que esta
 * rota faz, e que a próxima superfície (um CLI, um import em massa) herda as
 * mesmas regras sem copiá-las.
 *
 * ---------------------------------------------------------------------------
 * Contratos explícitos, e nenhum `PATCH /qualquer-coisa/:id`
 * ---------------------------------------------------------------------------
 *
 * Cada caminho abaixo nomeia o que faz com o quê. Não há rota que aceite um
 * objeto de campos arbitrários e os aplique: `POST /fluxos/:id/arquivar` diz
 * "arquive", `PUT /fluxos/:id/posicoes` diz "grave onde os cartões estão".
 * A diferença aparece no dia em que alguém acrescenta uma coluna que não
 * deveria ser editável pela tela — com contrato explícito, ela simplesmente não
 * é alcançável.
 *
 * ---------------------------------------------------------------------------
 * Nenhum `try/catch` aqui, e é de propósito
 * ---------------------------------------------------------------------------
 *
 * As recusas do motor (`RecusaDeFluxo` e suas filhas) sobem até
 * `middlewares/contrato-json.ts`, que as traduz pela tabela de
 * `lib/recusa-de-dominio.ts` — mesma política de todas as outras rotas deste
 * servidor, e a razão de `o-contrato-cobre-todas-as-rotas.test.ts` existir.
 * Um `catch` aqui converteria uma recusa nomeada em 500 genérico, que é
 * exatamente o defeito que aquele arquivo prende.
 */
const router: IRouter = Router();

router.use("/fluxos", instrumentarCicloDaRequisicao);
router.use(
  "/fluxos",
  contextoDeSchema(
    "Fluxos Operacionais não tem onde guardar os processos: as tabelas que a migration 0068_fluxos_operacionais cria não existem neste banco.",
  ),
);

/**
 * O vocabulário do motor — tipos de etapa, de conexão, espécies, status.
 *
 * A tela consome daqui em vez de ter a própria cópia da lista. É o que impede
 * o defeito clássico: um tipo novo aparece no banco e não aparece na interface,
 * porque duas listas existiam e só uma foi atualizada.
 *
 * Não depende de empresa e não lê o banco — só de sessão, como toda rota.
 */
router.get("/fluxos/catalogo", (_req, res): void => {
  res.json({
    ...CATALOGO,
    modelos: MODELOS.map((m) => ({
      slug: m.declarado.slug,
      nome: m.declarado.nome,
      categoria: m.declarado.categoria,
      resumo: m.resumo,
      jaMapeado: m.jaMapeado,
      etapas: m.declarado.etapas.length,
    })),
  });
});

/** A lista da tela de Processos → Fluxos Operacionais. */
router.get("/fluxos", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status !== undefined && !ehStatusDoFluxo(status)) {
    throw new RecusaDeFluxo("FLUXO_STATUS_INVALIDO", `Status desconhecido: ${status}.`);
  }
  const fluxos = await listarFluxos(db, empresaId, {
    incluirArquivados: req.query.incluirArquivados === "1",
    status,
    categoria: typeof req.query.categoria === "string" ? req.query.categoria : undefined,
  });
  res.json({ empresaId, fluxos });
});

/** Um fluxo inteiro: cabeçalho, etapas com material, e conexões. */
router.get("/fluxos/:id", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const completo = await lerFluxo(db, empresaId, req.params.id);
  if (!completo) throw new FluxoNaoEncontrado();
  res.json(completo);
});

router.post("/fluxos", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const fluxo = await criarFluxo(db, empresaId, req.body, autorDaRequisicao(req));
  res.status(201).json(fluxo);
});

/**
 * Criar um fluxo inteiro a partir de um modelo do catálogo.
 *
 * É o "começar de um modelo" da tela — e o mesmo caminho da semeadura. Não
 * existe rota de seed separada: semear é isto, pedido por alguém.
 */
router.post("/fluxos/de-modelo", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const slug = typeof req.body?.modelo === "string" ? req.body.modelo : "";
  const modelo = modeloPorSlug(slug);
  if (!modelo) {
    throw new RecusaDeFluxo("MODELO_DESCONHECIDO", `Não existe modelo "${slug}".`);
  }
  const [fluxo] = await semearModelos(db, empresaId, autorDaRequisicao(req), [modelo]);
  res.status(201).json(fluxo);
});

/**
 * Semear os processos que a empresa **já tem mapeados** aqui dentro.
 *
 * É o que a tela chama quando a lista da empresa está vazia. Não oferece
 * escolha porque não há escolha a fazer: o que entra por aqui é o levantamento
 * da própria empresa (`jaMapeado` em `@workspace/fluxos`), e não um exemplo.
 * Modelo de demonstração continua só pelo `POST /fluxos/de-modelo`, com alguém
 * clicando.
 *
 * Idempotente pelo slug, como toda semeadura: chamar de novo devolve os mesmos
 * fluxos e não desfaz edição nenhuma.
 */
router.post("/fluxos/semear", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const fluxos = await semearModelos(db, empresaId, autorDaRequisicao(req), modelosJaMapeados());
  res.status(201).json({ empresaId, fluxos });
});

/**
 * Importar um fluxo declarado por inteiro — cabeçalho, etapas e conexões numa
 * transação. É por onde um mapa levantado fora do produto entra sem virar
 * dezenas de cliques.
 */
router.post("/fluxos/importar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(corpo.etapas)) {
    throw new RecusaDeFluxo("IMPORTACAO_SEM_ETAPAS", "A declaração precisa trazer `etapas`.");
  }
  /*
    Os campos são copiados um a um, e não por espalhamento do corpo. Espalhar
    deixaria passar para o motor qualquer chave que alguém mandasse — `id`,
    `empresaId`, `versao` — e a defesa contra isso passaria a ser "o motor
    ignora o que não conhece", que é uma garantia que ninguém escreveu. O que
    cada campo vale continua sendo decidido lá dentro, pela mesma validação do
    `POST /fluxos`.
  */
  const fluxo = await importarFluxo(
    db,
    empresaId,
    {
      nome: String(corpo.nome ?? ""),
      slug: typeof corpo.slug === "string" ? corpo.slug : "",
      categoria: String(corpo.categoria ?? ""),
      descricao: typeof corpo.descricao === "string" ? corpo.descricao : null,
      objetivo: typeof corpo.objetivo === "string" ? corpo.objetivo : null,
      dono: typeof corpo.dono === "string" ? corpo.dono : null,
      ...(ehStatusDoFluxo(corpo.status) ? { status: corpo.status } : {}),
      etapas: corpo.etapas as FluxoDeclarado["etapas"],
      conexoes: Array.isArray(corpo.conexoes)
        ? (corpo.conexoes as FluxoDeclarado["conexoes"])
        : [],
    },
    autorDaRequisicao(req),
  );
  res.status(201).json(fluxo);
});

/**
 * Um fluxo inteiro a partir de um **roteiro em texto** — uma etapa por linha.
 *
 * É a mesma criação de sempre: o texto vira `EtapaDeclarada`/`ConexaoDeclarada`
 * por `interpretarRoteiro` (função pura do motor) e entra por `importarFluxo`,
 * na mesma transação e com as mesmas validações do `POST /fluxos`. A rota não
 * interpreta nada: se a gramática mudar, muda no motor, e o CLI que um dia
 * existir herda a mudança sem copiá-la.
 *
 * Por que uma rota e não duas chamadas da tela (criar, depois acrescentar):
 * porque duas chamadas deixam um fluxo vazio gravado quando a segunda falha, e
 * um cadastro que nasce quebrado é o que ninguém volta para limpar.
 */
router.post("/fluxos/roteiro", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const { etapas, conexoes } = interpretarRoteiro(corpo.roteiro);
  const fluxo = await importarFluxo(
    db,
    empresaId,
    {
      nome: String(corpo.nome ?? ""),
      slug: typeof corpo.slug === "string" ? corpo.slug : "",
      categoria: String(corpo.categoria ?? ""),
      descricao: typeof corpo.descricao === "string" ? corpo.descricao : null,
      objetivo: typeof corpo.objetivo === "string" ? corpo.objetivo : null,
      dono: typeof corpo.dono === "string" ? corpo.dono : null,
      ...(ehStatusDoFluxo(corpo.status) ? { status: corpo.status } : {}),
      etapas,
      conexoes,
    },
    autorDaRequisicao(req),
  );
  res.status(201).json(fluxo);
});

router.put("/fluxos/:id", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const fluxo = await atualizarFluxo(db, empresaId, req.params.id, req.body, autorDaRequisicao(req));
  res.json(fluxo);
});

router.post("/fluxos/:id/arquivar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.json(await arquivarFluxo(db, empresaId, req.params.id, autorDaRequisicao(req)));
});

/**
 * Desarquivar tem rota própria em vez de um `PATCH` com `{status}`.
 *
 * Duas rotas nomeadas dizem o que fazem e não abrem caminho para "mande
 * qualquer status": pôr um fluxo em ATIVO — a afirmação "é assim que funciona
 * hoje" — continua sendo uma edição consciente pelo `PUT`.
 */
router.post("/fluxos/:id/desarquivar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.json(await trocarStatus(db, empresaId, req.params.id, "RASCUNHO", autorDaRequisicao(req)));
});

router.post("/fluxos/:id/duplicar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const nome = typeof req.body?.nome === "string" ? req.body.nome : "";
  const copia = await duplicarFluxo(db, empresaId, req.params.id, nome, autorDaRequisicao(req));
  res.status(201).json(copia);
});

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

router.post("/fluxos/:id/etapas", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.status(201).json(await criarEtapa(db, empresaId, req.params.id, req.body));
});

router.put("/fluxos/:id/etapas/:etapaId", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.json(await atualizarEtapa(db, empresaId, req.params.id, req.params.etapaId, req.body));
});

router.delete("/fluxos/:id/etapas/:etapaId", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  await excluirEtapa(db, empresaId, req.params.id, req.params.etapaId);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Subfluxo — a etapa que é um processo inteiro por dentro
// ---------------------------------------------------------------------------

/**
 * Detalhar a etapa: cria o fluxo do detalhe e já o liga.
 *
 * Dois caminhos separados, e não um `PUT` que aceita "cria se não existir": um
 * diz "crie o detalhe desta etapa", o outro diz "aponte esta etapa para aquele
 * fluxo". Fundi-los faria o corpo decidir o que a rota faz — que é a rota
 * genérica que este arquivo recusa ter.
 */
router.post("/fluxos/:id/etapas/:etapaId/detalhar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const nome = typeof req.body?.nome === "string" ? req.body.nome : null;
  const fluxo = await detalharEtapa(
    db,
    empresaId,
    req.params.id,
    req.params.etapaId,
    autorDaRequisicao(req),
    nome,
  );
  res.status(201).json(fluxo);
});

/** Apontar a etapa para um fluxo que já existe. */
router.put("/fluxos/:id/etapas/:etapaId/subfluxo", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const subfluxoId = typeof req.body?.subfluxoId === "string" ? req.body.subfluxoId : "";
  if (subfluxoId === "") {
    throw new RecusaDeFluxo("SUBFLUXO_AUSENTE", "Informe `subfluxoId` — o fluxo que detalha esta etapa.");
  }
  res.json(await ligarSubfluxo(db, empresaId, req.params.id, req.params.etapaId, subfluxoId));
});

/** Desfazer a ligação. O fluxo do detalhe continua existindo. */
router.delete("/fluxos/:id/etapas/:etapaId/subfluxo", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.json(await desligarSubfluxo(db, empresaId, req.params.id, req.params.etapaId));
});

/**
 * Acrescentar um roteiro a um fluxo que já existe.
 *
 * O caminho do fluxo criado e ainda vazio — e o de quem levantou mais dez
 * etapas depois da reunião. As etapas novas entram no fim, ligadas em
 * sequência, e `origem` permite pendurá-las numa etapa que já está no desenho
 * em vez de começar uma ilha solta.
 */
router.post("/fluxos/:id/roteiro", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const { etapas, conexoes } = interpretarRoteiro(corpo.roteiro);
  /*
    A etapa de onde o trecho novo pende, quando quem pediu escolheu uma. Vai
    para o motor como mais uma conexão declarada — a ponta `de` é um `id`, que
    `acrescentarRoteiro` aceita ao lado das chaves locais e confere contra as
    etapas deste fluxo. Uma origem inventada é recusada lá, com nome.
  */
  const origem = typeof corpo.origem === "string" && corpo.origem !== "" ? corpo.origem : null;
  const ligacoes = origem
    ? [{ de: origem, para: etapas[0].chave, ordem: -1 }, ...conexoes]
    : conexoes;

  const resumo = await acrescentarRoteiro(
    db,
    empresaId,
    req.params.id,
    { etapas, conexoes: ligacoes },
    autorDaRequisicao(req),
  );
  res.status(201).json(resumo);
});

/**
 * "Organizar" — o layout automático aplicado ao que já está gravado.
 *
 * Sem `refazerTudo`, arruma só quem nunca foi arrastado; com ele, refaz o
 * desenho inteiro. Ter a decisão no corpo, e não duas rotas, é o único caso
 * deste arquivo em que o corpo muda o comportamento: os dois são o mesmo ato
 * ("organize"), com um alcance diferente.
 */
router.post("/fluxos/:id/organizar", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const refazerTudo = req.body?.refazerTudo === true;
  res.json(await organizarFluxo(db, empresaId, req.params.id, { refazerTudo }));
});

/** O salvamento do arrastar: todas as posições de uma vez, ou nenhuma. */
router.put("/fluxos/:id/posicoes", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const posicoes = validarPosicoes(req.body?.posicoes);
  const gravadas = await reposicionarEtapas(db, empresaId, req.params.id, posicoes);
  res.json({ gravadas });
});

// ---------------------------------------------------------------------------
// Conexões
// ---------------------------------------------------------------------------

router.post("/fluxos/:id/conexoes", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.status(201).json(await criarConexao(db, empresaId, req.params.id, req.body));
});

router.put("/fluxos/:id/conexoes/:conexaoId", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  res.json(await atualizarConexao(db, empresaId, req.params.id, req.params.conexaoId, req.body));
});

router.delete("/fluxos/:id/conexoes/:conexaoId", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  await excluirConexao(db, empresaId, req.params.id, req.params.conexaoId);
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// O material da etapa
// ---------------------------------------------------------------------------

/**
 * A lista de uma espécie, substituída inteira.
 *
 * A espécie está **no caminho**, e não no corpo: é ela que define o recorte do
 * que será apagado e regravado, e um recorte que viesse no corpo poderia
 * discordar do que a tela pensa que está editando. Ver `substituirItens` em
 * `lib/fluxos/src/repositorio.ts` para o porquê da substituição.
 */
router.put("/fluxos/:id/etapas/:etapaId/itens/:especie", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  const especie = req.params.especie.toUpperCase();
  if (!ehEspecieDeItem(especie)) {
    throw new RecusaDeFluxo("ITEM_ESPECIE_INVALIDA", `Espécie desconhecida: ${especie}.`);
  }
  await substituirItens(
    db,
    empresaId,
    req.params.id,
    req.params.etapaId,
    especie,
    req.body?.itens,
  );
  const completo = await lerFluxo(db, empresaId, req.params.id);
  res.json(completo?.etapas.find((e) => e.id === req.params.etapaId) ?? null);
});

router.put("/fluxos/:id/etapas/:etapaId/indicadores", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  await substituirIndicadores(
    db,
    empresaId,
    req.params.id,
    req.params.etapaId,
    req.body?.indicadores,
  );
  const completo = await lerFluxo(db, empresaId, req.params.id);
  res.json(completo?.etapas.find((e) => e.id === req.params.etapaId) ?? null);
});

router.put("/fluxos/:id/etapas/:etapaId/acoes", async (req, res): Promise<void> => {
  const empresaId = await resolverEmpresa(req);
  await substituirAcoes(db, empresaId, req.params.id, req.params.etapaId, req.body?.acoes);
  const completo = await lerFluxo(db, empresaId, req.params.id);
  res.json(completo?.etapas.find((e) => e.id === req.params.etapaId) ?? null);
});

export default router;
