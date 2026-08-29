import { useMemo } from "react";
import { useCargos, useDepartamentos } from "@/lib/cadastro";
import { useContas } from "@/components/configuracoes/contas";
import type { OpcoesDeResponsavel } from "@/lib/fluxos-analise";

/**
 * O QUE SE PODE ESCOLHER COMO RESPONSÁVEL — departamento, cargo e pessoa.
 *
 * ---------------------------------------------------------------------------
 * Por que isto existe
 * ---------------------------------------------------------------------------
 *
 * Até a `0079` o responsável de uma etapa era texto digitado, e o resultado era
 * o mesmo defeito que a tela de Cargos existia para denunciar, agora no mapa
 * dos processos: `Faturamento`, `FATURAMENTO` e `Fat.` viravam três raias no
 * fluxograma, três valores no filtro da Lista, e nenhuma resposta para "quantas
 * etapas o Faturamento executa". Escolher de uma lista acaba com isso na
 * origem — não há duas grafias para escolher.
 *
 * ---------------------------------------------------------------------------
 * As três consultas são as que já existiam
 * ---------------------------------------------------------------------------
 *
 * `useDepartamentos`, `useCargos` e `useContas` são as mesmas funções que
 * Configurações usa, com as mesmas chaves de React Query. Isso não é economia
 * de digitação: é a regra que `lib/contextos.ts` documenta — há **uma** `Query`
 * por chave, com **uma** `queryFn`, e declarar `["cadastro","cargos"]` aqui com
 * uma função própria não criaria uma segunda consulta, criaria um empate em que
 * quem dispara primeiro dita o comportamento das duas telas.
 *
 * ---------------------------------------------------------------------------
 * Quem entra na lista de pessoas
 * ---------------------------------------------------------------------------
 *
 * As contas arquivadas ficam de fora, e é a única filtragem: arquivar é o gesto
 * que diz "esta pessoa não está mais na lista de quem trabalha aqui" (ver a
 * `0078`), e oferecer um desligado como responsável de um processo vivo seria
 * desfazer esse gesto na tela seguinte. Uma etapa que **já aponta** para uma
 * conta arquivada continua mostrando o nome dela — o nome vem projetado do
 * servidor, não desta lista —, porque apagar da tela quem assinou o processo
 * seria perder história, não arrumar cadastro.
 *
 * Enquanto as consultas não voltam, ou quando a casa não cadastrou nada, o
 * resultado é `undefined` e a lista de responsáveis do painel volta a ser o que
 * sempre foi: nome e descrição, digitados. Nenhuma tela fica esperando cadastro
 * para funcionar.
 */
export function useOpcoesDeResponsavel(): OpcoesDeResponsavel | undefined {
  const departamentos = useDepartamentos();
  const cargos = useCargos();
  const contas = useContas();

  return useMemo(() => {
    const temAlgum =
      (departamentos.data?.length ?? 0) > 0 ||
      (cargos.data?.length ?? 0) > 0 ||
      (contas.data?.length ?? 0) > 0;
    if (!temAlgum) return undefined;

    const porNome = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, "pt-BR");

    return {
      departamentos: (departamentos.data ?? []).map((d) => ({ id: d.id, nome: d.nome })).sort(porNome),
      cargos: (cargos.data ?? []).map((c) => ({ id: c.id, nome: c.nome })).sort(porNome),
      pessoas: (contas.data ?? [])
        .filter((c) => c.archivedAt === null)
        .map((c) => ({ id: c.id, nome: c.name }))
        .sort(porNome),
    };
  }, [departamentos.data, cargos.data, contas.data]);
}
