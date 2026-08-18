import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { balancoDaImportacao, listarBalancos } from "@workspace/balance";

/**
 * Balanço de Massa — a conta de conservação de cada importação.
 *
 * Duas rotas, e a diferença entre elas é a pergunta: a lista responde *se* a
 * massa fecha, em todas as importações; o detalhe responde *onde* ela não
 * fecha, com o endereço da célula.
 *
 * Só leitura, e sem parâmetro de recorte. Este módulo não pergunta por unidade
 * nem por canal de propósito: o balanço é sobre o arquivo que chegou, e um
 * arquivo é de uma importação só. Filtrar por contexto aqui daria a impressão
 * de que existe massa "de outra unidade" que explicaria a que falta.
 */
const router: IRouter = Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/balance", async (req, res): Promise<void> => {
  res.json(await listarBalancos(db));
});

router.get("/balance/:importRunId", async (req, res): Promise<void> => {
  const { importRunId } = req.params;
  if (!UUID.test(importRunId)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  const balanco = await balancoDaImportacao(db, importRunId);
  if (!balanco) {
    res.status(404).json({ error: "Importação não encontrada." });
    return;
  }
  res.json(balanco);
});

export default router;
