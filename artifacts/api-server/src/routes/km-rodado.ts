import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  aplicarFiltros,
  lerTrechosDaVigencia,
  montarPanorama,
  opcoesDeFiltro,
  resolverVigenciaDeTrecho,
  type FiltrosDeKm,
} from "@workspace/comparison";
import { parseContext } from "../lib/contexto";

/**
 * Km Rodado — a quilometragem contratada de uma vigência de trecho.
 *
 * Rota própria, e não uma aba de `/trechos`, pela mesma razão que o Radar é
 * rota própria: o grão é outro. O Radar responde "o que mudou neste trecho
 * entre duas vigências" e precisa de change-set; esta responde "quanto a tabela
 * contrata de km nesta vigência" e não precisa de comparação nenhuma — a
 * primeira vigência importada é resposta legítima aqui, e é 409 lá.
 *
 * **Uma leitura, uma resposta.** Cartões, segmentações, divergências e a tabela
 * analítica saem todos de `montarPanorama`, sobre o mesmo conjunto de trechos.
 * Não é economia de requisição: é a garantia de que o total dos cartões é a
 * soma da tabela que está logo abaixo deles. Duas chamadas com dois filtros
 * ligeiramente diferentes produziriam uma tela que não fecha consigo mesma — e
 * quem confere ia gastar a tarde procurando o erro na conta certa.
 *
 * **O filtro é do servidor.** O que chega em `?unidade=` é um pedido de
 * recorte, nunca uma autorização: `aplicarFiltros` recorta o que a consulta já
 * trouxe, e a consulta já nasce recortada pelo contexto — `operacao`,
 * `scopeHash` e canal, resolvidos em `resolverVigenciaDeTrecho`. Um cliente que
 * mande `?unidade=` de uma unidade fora do contexto dele não vê nada, porque a
 * unidade dele nem entrou na leitura.
 *
 * **A cobertura é medida antes do filtro.** `trechosNoExport` conta o que a
 * vigência tem no recorte pedido; os descartes são contados dentro dele. Sem
 * isso, filtrar por uma unidade faria a cobertura parecer 100% só porque o
 * denominador encolheu junto com o numerador.
 */
const router: IRouter = Router();

/** Só os quatro recortes que o domínio sabe aplicar — o resto é ignorado. */
function parseFiltros(query: Record<string, unknown>): FiltrosDeKm {
  const str = (chave: string) =>
    typeof query[chave] === "string" && query[chave] !== ""
      ? (query[chave] as string)
      : undefined;
  return {
    unidade: str("unidade"),
    operador: str("operador"),
    capacidade: str("capacidade"),
    regional: str("regional"),
  };
}

router.get("/km-rodado", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;

  const vigencia = await resolverVigenciaDeTrecho(db, parseContext(query));
  if (vigencia === null) {
    /*
      404, e a frase diz qual das duas ausências é: não há trecho importado
      neste recorte. "Nenhum resultado" e "nenhum dado" mandam quem lê para
      lugares diferentes — um para o filtro, outro para Importações.
    */
    res.status(404).json({
      error: "Nenhuma vigência de trecho importada neste recorte.",
    });
    return;
  }

  const todos = await lerTrechosDaVigencia(db, vigencia.snapshotId);
  const filtros = parseFiltros(query);
  const panorama = montarPanorama(aplicarFiltros(todos, filtros));

  res.json({
    vigencia,
    filtros,
    /* As opções saem do acervo inteiro da vigência, e não do recorte já
       filtrado: um seletor que só oferece o que já está selecionado é um
       seletor que não deixa trocar de seleção. */
    opcoes: opcoesDeFiltro(todos),
    resumo: panorama.resumo,
    porUnidade: panorama.porUnidade,
    porOperador: panorama.porOperador,
    porCapacidade: panorama.porCapacidade,
    porRegional: panorama.porRegional,
    assimetria: panorama.assimetria,
    divergencias: panorama.divergencias,
    conflitos: panorama.conflitos.map((grupo) =>
      grupo.map((a) => ({
        entityId: a.trecho.entityId,
        chaveTrecho: a.trecho.chaveTrecho,
        km: a.km,
      })),
    ),
    /*
      A tabela analítica vem inteira, e a paginação é da tela.

      Uma vigência tem milhares de trechos, não milhões — o arquivo real tem
      2.497 —, e o que a tela precisa poder fazer é ordenar e paginar **sobre o
      mesmo conjunto que produziu os cartões**. Paginar no servidor obrigaria a
      uma segunda consulta por página, e a primeira página de uma ordenação
      diferente já não seria o mesmo recorte que somou no cartão.
    */
    linhas: panorama.linhas.map((a) => ({
      entityId: a.trecho.entityId,
      chaveTrecho: a.trecho.chaveTrecho,
      unidade: a.trecho.unidade,
      operador: a.trecho.operador,
      regional: a.trecho.regional,
      origem: a.trecho.origem,
      destino: a.trecho.destino,
      capacidade: a.trecho.capacidade,
      kmIda: a.trecho.kmIda,
      kmVolta: a.trecho.kmVolta,
      km: a.km,
      kmMes: a.trecho.kmRodadoMesPorEquipe,
      assimetria: a.assimetria,
      exclusao: a.exclusao,
    })),
  });
});

export default router;
