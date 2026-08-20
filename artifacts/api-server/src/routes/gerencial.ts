import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { listarVigenciasDaAuditoria } from "@workspace/comparison";

/**
 * A Visão Gerencial da Auditoria — o acervo inteiro, numa leitura só.
 *
 * Rota própria, e não mais um endpoint em `changes.ts`, porque o grão é outro.
 * Tudo o que vive lá responde sobre **uma** comparação ou **uma** vigência de
 * **um** contexto; aqui a resposta é o acervo — toda vigência viva, de toda
 * unidade, com a comparação que a explica. É a leitura que a home gerencial
 * faz, e é a única do ambiente que atravessa contextos.
 *
 * Sem parâmetro nenhum, de propósito: o recorte por ano é da tela, e recortá-lo
 * aqui obrigaria quem lê a pedir de novo a cada troca de ano no seletor. O
 * tamanho da resposta é o número de vigências importadas — a mesma ordem de
 * grandeza de `/snapshots`, que a tela Comparar já lê inteira.
 *
 * Nada é calculado por causa desta rota: ela lê `change_set` como ele foi
 * gravado, e a vigência que nunca foi comparada volta com `comparacao: null` em
 * vez de disparar o motor. O porquê está no cabeçalho de
 * `@workspace/comparison/gerencial`.
 */
const router: IRouter = Router();

router.get("/gerencial/vigencias", async (_req, res): Promise<void> => {
  res.json(await listarVigenciasDaAuditoria(db));
});

export default router;
