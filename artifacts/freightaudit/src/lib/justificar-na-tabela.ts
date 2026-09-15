import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { JustificativaEstruturada } from "@workspace/comparison/justificativa-estruturada";

import type { AlvoDaJustificativa } from "@/components/justificativas/justificar-dialog";
import type { AbrirJustificativa } from "@/components/justificativas/coluna";
import { fetchJson } from "@/lib/api";
import { useJustificadaPor, type Justificativa } from "@/lib/justificativas";

/**
 * Justificar sem sair da tabela da rubrica — a metade que é da página.
 *
 * A explicação de uma queda nasce olhando a linha que caiu, e era exatamente
 * ali que não dava para escrevê-la: quem via o IPVA zerar tinha de abrir
 * Chamados, reencontrar a vigência no seletor, reencontrar a placa na fila e só
 * então escrever. Duas telas para uma frase.
 *
 * O que muda é **de onde se abre**, e nada do que justificar significa: o
 * diálogo é o mesmo de Chamados e o POST é o mesmo `/justificativas` — mesma
 * rota, mesmo `changeSetId`, uma linha de `justificativa` por alteração.
 * Gravar de novo não edita a anterior: é histórico, e a tela lê sempre a mais
 * recente. Por isso também não há gravação otimista aqui; o que volta para a
 * tabela é o que o banco confirmou.
 *
 * Isto nasceu escrito por extenso dentro da página do FINAME. Ao valer para as
 * seis rubricas, a escolha era copiar trinta linhas de estado e mutação seis
 * vezes — e seis cópias de uma regra de gravação discordam no dia em que uma
 * delas for corrigida. `propsDoDialogo` existe para que a página não precise
 * nem saber o nome das propriedades: ela espalha e acabou.
 */
export function useJustificarNaTabela(
  changeSetId: string | undefined,
  /** Onde isto vai ser gravado, escrito no diálogo — "comparação X → Y". */
  contexto?: string,
) {
  const queryClient = useQueryClient();
  const { justificadaPor, consulta } = useJustificadaPor(changeSetId);

  const [alvo, setAlvo] = useState<AlvoDaJustificativa[] | null>(null);
  const [justificativaAtual, setJustificativaAtual] = useState<Justificativa | null>(null);

  const gravar = useMutation({
    mutationFn: (input: { changeIds: number[]; justificativa: JustificativaEstruturada }) =>
      fetchJson<{ justificativas: Justificativa[] }>("/justificativas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId,
          changeIds: input.changeIds,
          ...input.justificativa,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["justificativas", changeSetId] });
      setAlvo(null);
      setJustificativaAtual(null);
    },
  });

  const abrir = useCallback<AbrirJustificativa>((alvos, atual) => {
    setAlvo(alvos);
    setJustificativaAtual(atual ?? null);
  }, []);

  const fechar = useCallback(() => {
    setAlvo(null);
    setJustificativaAtual(null);
    gravar.reset();
  }, [gravar]);

  return {
    /** A justificativa mais recente de cada alteração, por `change.id`. */
    justificadaPor,
    /** A leitura, para a página decidir o que fazer com erro e carregamento. */
    consulta,
    /** O que a tabela recebe como `onJustificar`. */
    abrir,
    /** O que o `<JustificarDialog />` recebe — espalhe e acabou. */
    propsDoDialogo: {
      alvo,
      contexto,
      justificativaAtual,
      pendente: gravar.isPending,
      erro: gravar.error,
      onClose: fechar,
      onConfirmar: (justificativa: JustificativaEstruturada) =>
        gravar.mutate({ changeIds: (alvo ?? []).map((a) => a.id), justificativa }),
    },
  };
}
