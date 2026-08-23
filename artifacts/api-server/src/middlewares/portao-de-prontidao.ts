import type { RequestHandler } from "express";
import { textoDoDiagnostico } from "@workspace/db/diagnostico";
import { estadoDoPortao } from "../lib/prontidao";

/**
 * O portão que impede uma requisição de produto de atravessar a janela em que
 * o código deste build e o schema deste banco discordam.
 *
 * ---------------------------------------------------------------------------
 * Por que um middleware, e não "montar as rotas depois"
 * ---------------------------------------------------------------------------
 * As duas fecham a mesma janela. A diferença está no que quem chama recebe
 * enquanto ela dura: rota não montada responde 404 — "não existe" —, que é
 * mentira e manda procurar erro de caminho. Aqui a resposta diz o que houve,
 * com o mesmo diagnóstico do `/healthz` e o mesmo `Retry-After` que qualquer
 * cliente sabe respeitar.
 *
 * ---------------------------------------------------------------------------
 * Antes da sessão, e a ordem é a correção
 * ---------------------------------------------------------------------------
 * Este portão é montado **antes** de `requireSession` (ver `app.ts`). Não é
 * detalhe de arrumação: a própria sessão é lida do banco, e num banco cujo
 * schema é de outra época a leitura da sessão é mais uma que atravessa a
 * janela. Autenticar primeiro faria a primeira consulta do pedido acontecer
 * exatamente onde o portão existe para não deixar nada acontecer.
 *
 * ---------------------------------------------------------------------------
 * O que atravessa o portão fechado
 * ---------------------------------------------------------------------------
 * Só o que serve para descobrir que ele está fechado, e por quê. Nenhuma delas
 * lê dado de produto:
 *
 * - `/healthz` — é para onde o `[services.production.health.startup]` aponta.
 *   Fechá-lo faria o deployment nunca subir, e o roteador voltaria a responder
 *   502 sem corpo: o estado exato que a rota de saúde existe para tornar
 *   legível.
 * - `/readyz` — a prontidão em si. Um portão que bloqueasse a pergunta sobre
 *   ele seria inútil.
 * - `/build` e `/` — o deployer do Replit sonda as duas antes de promover o
 *   build, e as duas respondem sem tocar no banco.
 */

/** O `code` que a interface lê quando o serviço subiu e ainda não converge. */
export const CODIGO_NAO_PRONTO = "SERVICO_NAO_PRONTO";

/** Ver o cabeçalho: as quatro que existem para diagnosticar o próprio portão. */
const SEMPRE_ABERTAS = new Set(["/healthz", "/readyz", "/build", "/"]);

/**
 * O caminho como a lista o escreve — a barra final não muda quem é a rota.
 *
 * A tolerância existe por um motivo só, e ele é caro: um probe apontado para
 * `/api/healthz/` cairia fora da lista, receberia 503 e o deployment nunca
 * subiria. Um caractere de configuração não pode ser a diferença entre publicar
 * e não publicar.
 */
function normalizar(caminho: string): string {
  return caminho.length > 1 && caminho.endsWith("/")
    ? caminho.slice(0, -1)
    : caminho;
}

/**
 * A frase que a rota contribui — e, como em todo o contrato de erro deste
 * servidor, recomendação nenhuma: quem recomenda é `diagnosticar`.
 */
function contexto(metodo: string, caminho: string): string {
  return (
    `${metodo} ${caminho} não foi executado. Este processo subiu com um build ` +
    `cujo schema ainda não está aplicado neste banco, e recusa tráfego de ` +
    `produto até que esteja — gravar ou ler dentro dessa janela é o que produz ` +
    `meia competência e erro sobre arquivo perfeito. Nada foi gravado.`
  );
}

export const portaoDeProntidao: RequestHandler = (req, res, next) => {
  if (SEMPRE_ABERTAS.has(normalizar(req.path))) {
    next();
    return;
  }

  void estadoDoPortao().then(
    (estado) => {
      if (!estado.bloqueia) {
        next();
        return;
      }
      req.log?.warn(
        { estado: estado.diagnostico.estado, path: req.path },
        "Pedido recusado pelo portão de prontidão — a fila deste build não está aplicada.",
      );
      /*
        `Retry-After` em segundos, e curto: a fila da partida costuma levar
        segundos, e o cliente que respeita o cabeçalho volta sozinho quando ela
        terminar. Um valor longo transformaria uma partida normal em minutos de
        indisponibilidade percebida.
      */
      res.setHeader("Retry-After", "5");
      res.status(503).json({
        error: `${contexto(req.method, req.path)} ${textoDoDiagnostico(estado.diagnostico)}`,
        code: CODIGO_NAO_PRONTO,
        contexto: contexto(req.method, req.path),
        diagnostico: estado.diagnostico,
        requestId: req.id,
      });
    },
    /*
      Medir a prontidão falhou — e isso não é o portão dizendo "não pronto". É
      uma falha nossa, e ela segue para o contrato de erro, que sabe respondê-la
      em JSON com `requestId`. Tratá-la como "não pronto" faria um defeito de
      código parecer banco atrasado, e mandaria alguém rodar migrations.
    */
    (erro) => next(erro),
  );
};
