import path from "node:path";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  abrirCompetencia,
  apurarCompetencia,
  buscarCompetencia,
  descartarDadosDaCompetencia,
  excluirCompetencia,
  lerApuracaoVigente,
  lerDeParaDaCompetencia,
  lerDiaDaCompetencia,
  lerDiarioDaCompetencia,
  lerResumoDoMes,
  listarApuracoes,
  listarCompetencias,
  listarDocumentos,
  listarPartes,
  receberDocumento,
  reabrirCompetencia,
  encerrarCompetencia,
  RecusaDeFechamento,
} from "@workspace/fechamento/persistencia";
import {
  DESCRICAO_DA_FONTE,
  GRUPOS_DA_PLANILHA,
  LINHAS_DA_PLANILHA,
  QUINZENAS_DA_FONTE,
  TIPOS_DE_FONTE,
  type Canal,
  type ColunaDoPagamento,
  type TipoDeFonte,
} from "@workspace/fechamento";

/**
 * Fechamento de Remuneração — a superfície HTTP do outro ambiente do produto.
 *
 * A ordem das rotas é a do trabalho: abre-se a competência, enviam-se
 * os documentos que a Ambev exportou, roda-se a apuração, lê-se a conta com as
 * divergências — e, quando o número não convence, desce-se ao dia e à viagem
 * que o produziram. Nada aqui calcula: a aritmética inteira mora em
 * `@workspace/fechamento`, testada sem banco e sem HTTP, e este arquivo só a
 * liga à tela.
 *
 * **Por que o upload é JSON com base64, e não multipart.** É a mesma escolha da
 * importação da Auditoria (`routes/imports.ts`), pela mesma razão: o corpo
 * inteiro é conferido antes de qualquer byte virar arquivo, e a recusa volta
 * com o motivo em português em vez de um erro de parser de formulário.
 *
 * **A diferença em relação à importação da Auditoria** é que lá o tipo do
 * arquivo é deduzível do conteúdo, e aqui não: os relatórios do Promax
 * não se identificam. Um 03.08.15 e um 03.08.18 são os dois `.xlsx` com
 * cabeçalho na primeira linha, e trocá-los daria uma conta plausível e errada.
 * Por isso `tipo` é obrigatório, sempre — a aba da tela é a declaração.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** As extensões que cada fonte admite. O TXT do Promax não vem em planilha. */
const EXTENSOES: Record<TipoDeFonte, string[]> = {
  OPERACAO: [".xlsx", ".xls"],
  CTE: [".xlsx", ".xls"],
  PAGAMENTO: [".txt"],
  DISPONIBILIDADE: [".xlsx", ".xls"],
  REQUISICOES: [".csv"],
  CONCILIACAO: [".txt"],
};

/**
 * O catálogo das fontes, para a tela saber o que pedir e por quê.
 *
 * Devolve as seis sempre, com `quinzenas` dizendo em qual delas cada uma é
 * esperada — a primeira quinzena tem quatro relatórios, a segunda tem os seis
 * (ver `FONTES_DA_QUINZENA`). O recorte é da tela e não da rota de propósito:
 * a lista de Apurações mostra quinzenas das duas metades na mesma tabela, e
 * filtrar aqui a obrigaria a buscar o catálogo duas vezes para desenhar uma
 * página.
 */
router.get("/fechamento/fontes", (_req, res): void => {
  res.json(
    TIPOS_DE_FONTE.map((tipo) => ({
      tipo,
      ...DESCRICAO_DA_FONTE[tipo],
      extensoes: EXTENSOES[tipo],
      quinzenas: QUINZENAS_DA_FONTE[tipo],
    })),
  );
});

router.get("/fechamento/competencias", async (_req, res): Promise<void> => {
  res.json(await listarCompetencias(db));
});

/**
 * Todas as competências já somadas — a tela de Apurações.
 *
 * Devolve, por competência, quais relatórios estão vigentes, os
 * totais que a apuração gravou e o quanto continua em discussão. É a mesma
 * informação que `/competencias/:id` traz, sem a memória de cálculo: o que
 * cabe numa linha de lista. Ver `listarApuracoes` para por que a soma acontece
 * aqui e não no navegador.
 */
router.get("/fechamento/apuracoes", async (_req, res): Promise<void> => {
  res.json(await listarApuracoes(db));
});

/**
 * As unidades e transportadoras já usadas, para o campo que se pesquisa.
 *
 * Derivadas das competências e não de um cadastro próprio — ver `listarPartes`
 * para o porquê. A tela oferece o que existe e deixa digitar o que não existe;
 * o que não existe passa a existir quando a competência é aberta.
 */
router.get("/fechamento/partes", async (_req, res): Promise<void> => {
  res.json(await listarPartes(db));
});

/**
 * O mês inteiro — as duas quinzenas lado a lado, com o total.
 *
 * É a leitura que a tela de Resumo faz, e a que responde no formato em que a
 * transportadora discute o número com a Ambev. Os quatro parâmetros são
 * obrigatórios porque a trinca que identifica um fechamento é (unidade,
 * transportadora, período): dois CDDs no mesmo mês são dois resumos, e somá-los
 * por omissão de um filtro seria inventar um terceiro.
 */
router.get("/fechamento/resumo", async (req, res): Promise<void> => {
  const unidade = String(req.query.unidade ?? "").trim();
  const transportadora = String(req.query.transportadora ?? "").trim();
  const ano = Number(req.query.ano);
  const mes = Number(req.query.mes);

  if (unidade === "" || transportadora === "") {
    res.status(400).json({
      error: "unidade e transportadora são obrigatórias — o resumo é de um fechamento, não de um mês do calendário.",
    });
    return;
  }
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    res.status(400).json({ error: "ano precisa ser um ano entre 2000 e 2100." });
    return;
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "mes precisa ser um número de 1 a 12." });
    return;
  }

  res.json(await lerResumoDoMes(db, { unidade, transportadora, ano, mes }));
});

/**
 * Abre uma competência — ou devolve a que já existe.
 *
 * Idempotente de propósito: (unidade, transportadora, quinzena) é um
 * fechamento só. Ver `abrirCompetencia`.
 */
router.post("/fechamento/competencias", async (req, res): Promise<void> => {
  const corpo = req.body as Record<string, unknown>;
  const ano = Number(corpo?.ano);
  const mes = Number(corpo?.mes);
  const quinzena = Number(corpo?.quinzena);
  const unidade = corpo?.unidade as { codigo?: unknown; nome?: unknown } | undefined;
  const transportadora = corpo?.transportadora as { codigo?: unknown; nome?: unknown } | undefined;

  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    res.status(400).json({ error: "ano precisa ser um ano entre 2000 e 2100." });
    return;
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "mes precisa ser um número de 1 a 12." });
    return;
  }
  if (quinzena !== 1 && quinzena !== 2) {
    res.status(400).json({ error: "quinzena precisa ser 1 (dias 1 a 15) ou 2 (dia 16 ao fim do mês)." });
    return;
  }
  if (typeof unidade?.codigo !== "string" || unidade.codigo.trim() === "") {
    res.status(400).json({ error: "unidade.codigo é obrigatório — é o CDD que está fechando." });
    return;
  }
  if (typeof transportadora?.codigo !== "string" || transportadora.codigo.trim() === "") {
    res.status(400).json({ error: "transportadora.codigo é obrigatório." });
    return;
  }

  const competencia = await abrirCompetencia(db, {
    ano,
    mes,
    quinzena,
    unidade: {
      codigo: unidade.codigo.trim(),
      nome: typeof unidade.nome === "string" ? unidade.nome.trim() : null,
    },
    transportadora: {
      codigo: transportadora.codigo.trim(),
      nome: typeof transportadora.nome === "string" ? transportadora.nome.trim() : null,
    },
  });
  res.status(201).json(competencia);
});

/** A competência, seus documentos e a apuração vigente — o que a tela precisa. */
router.get("/fechamento/competencias/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const competencia = await buscarCompetencia(db, id);
  if (!competencia) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }
  const [documentos, apuracao] = await Promise.all([
    listarDocumentos(db, id),
    lerApuracaoVigente(db, id),
  ]);
  res.json({ competencia, documentos, apuracao });
});

/**
 * O de-para: o painel da planilha preenchido com o 03.08.20 desta competência.
 *
 * Responde à pergunta que o produto ainda não respondia — "a classificação do
 * sistema conversa com a da planilha?" —, e responde nos rótulos da planilha,
 * não nos nossos: `CUSTO FIXO PADRONIZADO`, `DESCONTO DE DEVOLUÇÃO`, `TOTAL
 * OUTROS CUSTOS`. Cada linha vem com o valor ou com o motivo de não ter, e cada
 * quadro vem com o resíduo, que é o que as linhas sem origem somam.
 *
 * **404 quando o 03.08.20 não foi importado**, e não um painel de zeros. É a
 * mesma regra do diário: a fonte ausente é uma resposta, e ela não pode ter a
 * cara de "a quinzena valeu zero".
 *
 * `coluna` escolhe contra o que conferir — `semImposto` (o padrão, e a moeda em
 * que os descontos do relatório vêm), `ctrcIcms` (o que vira CT-e) ou
 * `valorFaturado`. `canal` existe pelo mesmo motivo que existe no módulo: o
 * painel transcrito é o da Rota, e o do AS entra quando os rótulos dele forem
 * capturados.
 */
router.get("/fechamento/competencias/:id/de-para", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }

  const colunas: ColunaDoPagamento[] = ["semImposto", "ctrcIcms", "valorFaturado"];
  const pedida = String(req.query.coluna ?? "semImposto");
  if (!colunas.includes(pedida as ColunaDoPagamento)) {
    res.status(400).json({ error: `coluna precisa ser uma de: ${colunas.join(", ")}.` });
    return;
  }
  const canais: Canal[] = ["ROTA", "AS"];
  const canal = String(req.query.canal ?? "ROTA");
  if (!canais.includes(canal as Canal)) {
    res.status(400).json({ error: `canal precisa ser um de: ${canais.join(", ")}.` });
    return;
  }

  const competencia = await buscarCompetencia(db, id);
  if (!competencia) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }

  const painel = await lerDeParaDaCompetencia(db, id, {
    canal: canal as Canal,
    coluna: pedida as ColunaDoPagamento,
  });
  if (!painel) {
    res.status(404).json({
      error:
        "O 03.08.20 (demonstrativo de pagamento) não foi importado nesta competência — e é " +
        "ele que abre a parcela fixa verba a verba. Sem ele o painel da planilha não tem de " +
        "onde sair.",
    });
    return;
  }

  res.json({ competencia, painel });
});

/**
 * O catálogo do de-para, sem competência nenhuma.
 *
 * A tela precisa saber quais são os dezoito rótulos e o que cada um significa
 * antes de ter números — para desenhar o painel vazio, e para explicar uma
 * ausência sem precisar de um 03.08.20 importado.
 */
router.get("/fechamento/de-para", (_req, res): void => {
  res.json({ linhas: LINHAS_DA_PLANILHA, grupos: GRUPOS_DA_PLANILHA });
});

/**
 * O diário da competência: um item por dia do período, com ou sem operação.
 *
 * É a grade que a tela abre antes de escolher um dia — a mesma que as abas
 * `01`…`31` da planilha `Fechamento_Remuneracao.xlsb` formam, só que sem
 * planilha. O dia sem viagem nenhuma vem na lista com zero, e não some: "não
 * rodou" e "não importamos o 2Art" são coisas diferentes, e a resposta traz
 * `fonte: null` quando é o segundo caso.
 */
router.get("/fechamento/competencias/:id/dias", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const diario = await lerDiarioDaCompetencia(db, id);
  if (!diario) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }
  res.json(diario);
});

/**
 * Um dia aberto: as viagens daquele dia, inteiras, com os totais por frota.
 *
 * O dia vem no caminho em `AAAA-MM-DD` porque é assim que o módulo inteiro
 * escreve data — a tela é que traduz para `dd/mm`. Dia fora da competência
 * responde 404, e não uma lista vazia: lista vazia diria "não rodou nada em
 * 20/08" para uma pergunta sobre uma quinzena que termina em 15/08.
 */
router.get("/fechamento/competencias/:id/dias/:dia", async (req, res): Promise<void> => {
  const { id, dia } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    res.status(400).json({ error: "O dia precisa vir em AAAA-MM-DD." });
    return;
  }
  const aberto = await lerDiaDaCompetencia(db, id, dia);
  if (!aberto) {
    res.status(404).json({
      error: "Não há esse dia nesta competência — confira se a data está dentro da quinzena.",
    });
    return;
  }
  res.json(aberto);
});

/**
 * Recebe um dos cinco relatórios.
 *
 * O corpo é `{ tipo, filename, contentBase64 }`. As três recusas de formato
 * acontecem antes de o arquivo virar bytes, e cada uma existe porque a
 * alternativa é pior: sem o filtro de base64, `Buffer.from` descarta em
 * silêncio o que não reconhece e entrega um arquivo truncado; sem a conferência
 * de extensão contra o tipo, um 03.08.18 enviado na aba do 03.08.15 só falharia
 * lá dentro do leitor, com uma mensagem sobre cabeçalho que não ajuda ninguém a
 * entender que trocou os arquivos.
 */
router.post("/fechamento/competencias/:id/documentos", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }

  const corpo = req.body as Record<string, unknown>;
  const tipo = typeof corpo?.tipo === "string" ? (corpo.tipo.trim().toUpperCase() as TipoDeFonte) : null;
  if (!tipo || !TIPOS_DE_FONTE.includes(tipo)) {
    res.status(400).json({
      error: `tipo é obrigatório e precisa ser um de: ${TIPOS_DE_FONTE.join(", ")}.`,
    });
    return;
  }

  const filename = typeof corpo?.filename === "string" ? path.basename(corpo.filename.trim()) : "";
  if (filename === "") {
    res.status(400).json({ error: "filename é obrigatório." });
    return;
  }
  const extensao = path.extname(filename).toLowerCase();
  if (!EXTENSOES[tipo].includes(extensao)) {
    const fonte = DESCRICAO_DA_FONTE[tipo];
    res.status(400).json({
      error:
        `O relatório ${fonte.rotina} (${fonte.nome}) vem em ${EXTENSOES[tipo].join(" ou ")}, ` +
        `e "${filename}" é ${extensao || "sem extensão"}. Confira se não trocou a aba de envio.`,
    });
    return;
  }

  const encoded = typeof corpo?.contentBase64 === "string" ? corpo.contentBase64.trim() : "";
  if (encoded === "") {
    res.status(400).json({ error: "contentBase64 é obrigatório." });
    return;
  }
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    res.status(400).json({ error: "contentBase64 não está em base64 válido." });
    return;
  }

  try {
    const recebido = await receberDocumento(db, {
      competenciaId: id,
      tipo,
      nomeDoArquivo: filename,
      conteudo: Buffer.from(encoded, "base64"),
    });
    res.status(201).json(recebido);
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
        detalhe: erro.detalhe,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Descarta o que foi importado para a competência.
 *
 * `DELETE` e não um `POST /descarte` porque é exatamente o que o verbo diz, e
 * porque o que sobra depois dele — a competência vazia — não é um recurso novo
 * que mereça um endereço próprio.
 *
 * **O caminho é `/dados` e não `/documentos`** porque o que sai é mais do que
 * os arquivos: saem as linhas que eles produziram e as apurações que saíram
 * delas. Prometer "documentos" e apagar a conta junto seria a rota mentir sobre
 * o próprio alcance.
 *
 * A resposta devolve o que foi apagado, contado por fonte. Um `204` seria mais
 * curto e diria menos: quem acabou de descartar uma quinzena inteira precisa
 * ver o tamanho do que descartou, ainda mais quando descartou por engano.
 */
router.delete("/fechamento/competencias/:id/dados", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await descartarDadosDaCompetencia(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Roda a apuração.
 *
 * É um POST e não um GET porque grava: a apuração vigente anterior é
 * despromovida e uma nova entra no lugar. Ver `fechamento_apuracao` — o
 * histórico é o que responde "o que mudou desde que eu aprovei".
 */
router.post("/fechamento/competencias/:id/apuracao", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    await apurarCompetencia(db, id);
    res.json(await lerApuracaoVigente(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Encerra a competência: o ato de dizer "esta quinzena está fechada".
 *
 * É `POST` e não `PUT` porque não é a edição de um campo — é um ato com
 * consequência: a partir dele o gatilho do banco recusa qualquer escrita nas
 * tabelas da competência.
 */
router.post("/fechamento/competencias/:id/encerramento", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await encerrarCompetencia(db, id, req.user?.id ?? null));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Reabre uma competência encerrada — com motivo, sempre.
 *
 * O motivo é recusado vazio aqui e de novo no repositório. A dupla conferência
 * é deliberada: a rota é a porta que a tela usa, e o repositório é a regra —
 * um script que chame a função direto não deve conseguir reabrir sem dizer por
 * quê.
 */
router.post("/fechamento/competencias/:id/reabertura", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const motivo = typeof (req.body as Record<string, unknown>)?.motivo === "string"
    ? ((req.body as Record<string, unknown>).motivo as string).trim()
    : "";
  if (motivo === "") {
    res.status(400).json({
      error:
        "Escreva o motivo da reabertura: ele é o que distingue uma correção de " +
        "uma alteração silenciosa depois do fato.",
      codigo: "MOTIVO_OBRIGATORIO",
    });
    return;
  }
  try {
    res.json(await reabrirCompetencia(db, id, { motivo, por: req.user?.id ?? null }));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Exclui a competência inteira — a importação deixa de existir.
 *
 * É `DELETE` no recurso, e não `DELETE .../dados`: aquele esvazia a quinzena e
 * a mantém na lista; este apaga a linha. A distinção mora na URL porque os dois
 * atos se parecem no clique e não se parecem no resultado, e quem chama a API
 * de fora precisa poder dizer qual dos dois quis.
 *
 * A encerrada é recusada com 409 — a mesma regra do envio e do descarte, e a
 * mesma saída: reabrir, com motivo.
 */
router.delete("/fechamento/competencias/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await excluirCompetencia(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

export default router;
