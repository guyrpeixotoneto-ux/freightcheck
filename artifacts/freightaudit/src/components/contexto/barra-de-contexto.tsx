import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { fetchJson } from "@/lib/api";
import type { SeriesContext } from "@/components/inicio/types";
import {
  ContextBar,
  type ContextSelection,
} from "@/components/contexto/context-bar";
import { enderecoComContexto } from "@/lib/contexto";

/**
 * A barra de contexto pronta para montar — uma linha por tela.
 *
 * `ContextBar` é a apresentação; esta é a ligação. Ela existe porque as nove
 * telas que recortam por contexto precisam das **mesmas** três coisas e as
 * obtêm de lugares diferentes:
 *
 * - o contexto atual e os outros vêm de `/contexts`, que é a lista canônica de
 *   unidades e canais com vigência entregue. Sai daqui, e não da resposta de
 *   cada tela, porque a resposta de cada tela tem um formato diferente — foi
 *   exatamente isso que deixou a barra sem consumidor por tanto tempo e fez
 *   Início e Parâmetros escreverem cada um o seu seletor;
 * - as vigências vêm da própria tela, porque cada uma já as tem e nem sempre
 *   com o mesmo nome (`periods`, `vigencias.todas`, `periodos`);
 * - a escrita na URL vem de `enderecoComContexto`, que é onde mora a única
 *   regra da troca: mudar de unidade apaga a vigência.
 *
 * **Enquanto `/contexts` não responde, a barra não aparece.** É deliberado: uma
 * barra que abre com a unidade em branco e se preenche depois pisca a
 * informação mais importante da tela. Melhor ela chegar meio segundo depois,
 * inteira.
 */
export function BarraDeContexto({
  rota,
  scopeHash,
  canal,
  periodos,
  periodoAtual,
  vigenciaDetalhe,
  compararCom,
  rodape,
}: {
  /** A rota da tela, para montar o endereço da troca. */
  rota: string;
  /** O contexto que produziu o que está na tela, como a resposta o informa. */
  scopeHash: string;
  canal: string | null;
  periodos: { date: string; label: string }[];
  periodoAtual: string;
  vigenciaDetalhe?: string | null;
  compararCom?: string[];
  rodape?: React.ReactNode;
}) {
  const search = useSearch();
  const [, navigate] = useLocation();

  const { data: contextos } = useQuery({
    queryKey: ["contexts"],
    queryFn: () => fetchJson<SeriesContext[]>("/contexts"),
    staleTime: 5 * 60 * 1000,
  });

  if (!contextos || contextos.length === 0) return null;

  /*
    Casar por (escopo, canal) e não só por escopo.

    A mesma unidade pode entregar em dois canais, e os dois são contextos
    distintos com calendários distintos. Casar só pelo escopo devolveria o
    primeiro e a barra mostraria o canal errado — que é a divergência D2 da
    auditoria reaparecendo na tela, depois de ter sido corrigida no banco.
  */
  const atual =
    contextos.find((c) => c.scopeHash === scopeHash && c.channel === canal) ??
    contextos.find((c) => c.scopeHash === scopeHash);
  if (!atual) return null;

  const outros = contextos.filter(
    (c) => !(c.scopeHash === atual.scopeHash && c.channel === atual.channel),
  );

  const trocar = (selecao: ContextSelection) =>
    navigate(enderecoComContexto(rota, search, selecao));

  return (
    <ContextBar
      contexto={atual}
      outros={outros}
      periodos={periodos}
      periodoAtual={periodoAtual}
      vigenciaDetalhe={vigenciaDetalhe}
      compararCom={compararCom}
      rodape={rodape}
      onChange={trocar}
    />
  );
}
