import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  BaixaRecusada,
  CelulaNaoEncontrada,
  DecisaoRecusada,
  contratoDaDRE,
  descobertas,
  detalheDaCelula,
  detalheDaLacuna,
  historicoDoAtributo,
  provenienciaDoFato,
  refazerAgregado,
  registrarBaixa,
  registrarDecisao,
  semearContrato,
  vigenciasSemAgregado,
  visaoDaCobertura,
  type Criticidade,
} from "@workspace/coverage";

/**
 * Cobertura de dados.
 *
 * **Nenhuma rota deste arquivo calcula cobertura.** Todas chamam
 * `@workspace/coverage`, que é a autoridade única, e devolvem o que ele
 * responde. É a regra que impede o defeito que este módulo veio corrigir: a
 * cobertura antiga era calculada dentro de um componente React, e por isso não
 * existia um segundo lugar que pudesse concordar com ela.
 *
 * A separação de responsabilidades também vale aqui. Estas rotas respondem "o
 * que já temos versus o que deveríamos ter". Elas não respondem o que entrou
 * (`/imports`), o que chegou com problema (qualidade), o que precisa de decisão
 * (`/curation`) nem de onde o dado se origina — embora `/coverage/provenance`
 * atravesse a cadeia, porque a pergunta "de qual arquivo veio a lacuna que
 * fechou" é da cobertura, e não do catálogo de fontes.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const texto = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

const numero = (v: unknown, padrao: number, maximo: number): number => {
  const n = typeof v === "string" ? Number.parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, maximo) : padrao;
};

const criticidade = (v: unknown): Criticidade | undefined =>
  v === "CRITICO" || v === "RELEVANTE" || v === "INFORMATIVO" ? v : undefined;

/**
 * A tela inteira numa chamada.
 *
 * Resumo, matriz, lacunas e descobertas saem juntos de propósito: os quatro são
 * a mesma medição vista de quatro alturas, e devolvê-los por rotas separadas
 * abriria a porta para a tela mostrar um resumo de uma medição e uma matriz de
 * outra — que é exatamente o defeito que a versão anterior tinha, ao consultar
 * um contexto por vez e somar no navegador.
 *
 * O drill-down é que fica de fora, e por outro motivo: ele só é pedido quando
 * alguém clica, e carregá-lo junto pagaria por informação que quase ninguém
 * abre.
 */
router.get("/coverage", async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  res.json(
    await visaoDaCobertura(db, {
      datasetFamily: texto(q.familia),
      scopeHash: texto(q.escopo),
      canal: q.canal === undefined ? undefined : (texto(q.canal) ?? null),
      entityType: texto(q.equipamento),
      vigencias: numero(q.vigencias, 6, 36),
      criticidadeMinima: criticidade(q.criticidade),
      limiteDeLacunas: numero(q.limiteLacunas, 50, 500),
    }),
  );
});

/** Uma célula da matriz, aberta: lacunas, contribuintes e inesperados. */
router.get("/coverage/cell/:snapshotId/:entityType", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.snapshotId)) {
    res.status(400).json({ error: "Identificador de vigência inválido." });
    return;
  }
  res.json(
    await detalheDaCelula(
      db,
      req.params.snapshotId,
      req.params.entityType.toUpperCase(),
    ),
  );
});

/** As entidades atingidas por uma lacuna, com o motivo de cada uma. */
router.get("/coverage/gap/:snapshotId/:attributeCode", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.snapshotId)) {
    res.status(400).json({ error: "Identificador de vigência inválido." });
    return;
  }
  const detalhe = await detalheDaLacuna(
    db,
    req.params.snapshotId,
    req.params.attributeCode,
    numero(req.query.limite, 200, 2000),
  );
  if (!detalhe) {
    res.status(404).json({ error: "Vigência ou atributo não encontrado." });
    return;
  }
  res.json(detalhe);
});

/** A série de um atributo ao longo das vigências — a quebra de padrão. */
router.get("/coverage/history/:attributeCode", async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  res.json(
    await historicoDoAtributo(db, req.params.attributeCode, {
      scopeHash: texto(q.escopo),
      canal: q.canal === undefined ? undefined : (texto(q.canal) ?? null),
      limite: numero(q.limite, 24, 120),
    }),
  );
});

/** O que apareceu de novo, com o provável equivalente e o status de curadoria. */
router.get("/coverage/discoveries", async (req, res): Promise<void> => {
  const q = req.query as Record<string, unknown>;
  res.json(
    await descobertas(db, {
      datasetFamily: texto(q.familia),
      scopeHash: texto(q.escopo),
      canal: q.canal === undefined ? undefined : (texto(q.canal) ?? null),
      desdeVigencia: texto(q.desde),
      limite: numero(q.limite, 100, 500),
    }),
  );
});

/** De onde veio um valor: a cadeia até a célula do arquivo original. */
router.get("/coverage/provenance/:factId", async (req, res): Promise<void> => {
  const factId = Number.parseInt(req.params.factId, 10);
  if (!Number.isFinite(factId) || factId <= 0) {
    res.status(400).json({ error: "Identificador de fato inválido." });
    return;
  }
  const p = await provenienciaDoFato(db, factId);
  if (!p) {
    res.status(404).json({ error: "Fato não encontrado." });
    return;
  }
  res.json(p);
});

/**
 * O contrato, como ele está declarado. Só leitura.
 *
 * Existe para que a resposta a "por que isto é esperado?" possa ser conferida
 * inteira, e não um item por vez: quem discorda de uma criticidade precisa ver
 * a lista e a evidência de cada linha para argumentar.
 */
router.get("/coverage/contract", (_req, res): void => {
  res.json(contratoDaDRE());
});

/**
 * Uma decisão humana sobre uma lacuna.
 *
 * `POST` porque escreve, e escreve duas coisas: a expectativa que muda o número
 * e o evento de curadoria que registra quem mudou e por quê. O responsável é
 * quem está logado, e não o que o corpo do pedido diz — a mesma regra de
 * `/curation/attributes/:code/confirm`, e pelo mesmo motivo: um campo de texto
 * sustenta "alguém digitou este nome", nunca "esta pessoa decidiu".
 */
router.post("/coverage/decisions", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = b.status === "DISPENSADO" ? "DISPENSADO" : "CONFIRMADO";

  const datasetFamily = texto(b.datasetFamily);
  const entityType = texto(b.entityType);
  const attributeCode = texto(b.attributeCode);
  const efetivoDe = texto(b.efetivoDe);
  if (!datasetFamily || !entityType || !attributeCode || !efetivoDe) {
    res.status(400).json({
      error:
        "Uma decisão precisa dizer sobre o que ela é: família, equipamento, atributo e a partir de quando vale.",
    });
    return;
  }

  await registrarDecisao(db, {
    datasetFamily,
    canal: b.canal === undefined ? undefined : (texto(b.canal) ?? null),
    scopeKey: b.scopeKey === undefined ? undefined : (texto(b.scopeKey) ?? null),
    entityType: entityType.toUpperCase(),
    attributeCode,
    status,
    criticidade: criticidade(b.criticidade),
    efetivoDe,
    efetivoAte: texto(b.efetivoAte) ?? null,
    sucessor: texto(b.sucessor) ?? null,
    motivo: typeof b.motivo === "string" ? b.motivo : "",
    evidencia: (b.evidencia as Record<string, unknown>) ?? {},
    ator: req.user!.email,
  });

  res.status(201).json({ ok: true });
});

/**
 * Uma decisão humana sobre a frota.
 *
 * A saída do mecanismo de continuidade, e a única que existe. A cobertura passa
 * a cobrar todo equipamento que apareceu numa vigência anterior e não apareceu
 * nesta; essa cobrança **não expira sozinha**, de propósito — se expirasse, um
 * caminhão que sumiu por erro de exportação viraria silêncio no mês seguinte.
 * O que a encerra é alguém dizer "saiu da frota, e foi por isto".
 *
 * `ator` sai de quem está logado, e não do corpo do pedido, pela mesma regra de
 * `/coverage/decisions`: um campo de texto sustenta "alguém digitou este nome",
 * nunca "esta pessoa decidiu".
 */
router.post("/coverage/fleet-decisions", async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = b.status === "ESPERADA" ? "ESPERADA" : "BAIXA";

  const datasetFamily = texto(b.datasetFamily);
  const entityType = texto(b.entityType);
  const entityId = texto(b.entityId);
  const efetivoDe = texto(b.efetivoDe);
  if (!datasetFamily || !entityType || !entityId || !efetivoDe) {
    res.status(400).json({
      error:
        "Uma decisão de frota precisa dizer sobre o que ela é: família, equipamento, qual entidade e a partir de quando vale.",
    });
    return;
  }
  if (!UUID.test(entityId)) {
    res.status(400).json({ error: "Identificador de entidade inválido." });
    return;
  }

  await registrarBaixa(db, {
    datasetFamily,
    canal: b.canal === undefined ? undefined : (texto(b.canal) ?? null),
    scopeKey: b.scopeKey === undefined ? undefined : (texto(b.scopeKey) ?? null),
    entityType: entityType.toUpperCase(),
    entityId,
    status,
    efetivoDe,
    efetivoAte: texto(b.efetivoAte) ?? null,
    motivo: typeof b.motivo === "string" ? b.motivo : "",
    evidencia: (b.evidencia as Record<string, unknown>) ?? {},
    ator: req.user!.email,
  });

  res.status(201).json({ ok: true });
});

/**
 * Refaz o agregado por equipamento das vigências que o perderam.
 *
 * `POST` pelo mesmo motivo de `/coverage/contract/seed`: escreve. E é a única
 * saída de um estado em que a tela ficava presa — vigências inteiras no banco,
 * matriz vazia, e nenhum caminho no produto capaz de recontar o que já está em
 * `fact`. Ver `lib/coverage/src/agregado.ts` para como a tabela se esvazia sem
 * que nenhum dado se perca.
 *
 * Idempotente e nunca destrutiva: escreve só onde não há linha nenhuma. Chamar
 * duas vezes devolve `vigencias: 0` na segunda, que é a resposta certa para
 * "não havia mais nada a refazer".
 */
router.post("/coverage/aggregate/rebuild", async (req, res): Promise<void> => {
  res.json(await refazerAgregado(db));
});

/** Quais vigências estão sem agregado — a leitura que o `POST` acima repara. */
router.get("/coverage/aggregate/missing", async (req, res): Promise<void> => {
  res.json(await vigenciasSemAgregado(db));
});

/**
 * Semeia o contrato em `coverage_expectation`.
 *
 * Idempotente — `ON CONFLICT DO NOTHING` — e não sobrescreve curadoria. Fica
 * numa rota própria, e não escondido numa leitura, porque escrever durante um
 * `GET` é como uma tela de consulta acaba alterando o banco sem que ninguém
 * peça. Chamada pela promoção, que é quando o dicionário pode ter crescido.
 */
router.post("/coverage/contract/seed", async (req, res): Promise<void> => {
  res.json(await semearContrato(db));
});

export default router;
