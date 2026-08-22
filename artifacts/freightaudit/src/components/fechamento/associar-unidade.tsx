import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { apresentar } from "@/lib/apresentar-erro";
import {
  associarUnidadeDaCompetencia,
  formatarCnpj,
  type UnidadeSugerida,
} from "@/lib/fechamento";

/**
 * ASSOCIAR A COMPETÊNCIA À UNIDADE — o gesto, onde quer que ele seja preciso.
 *
 * **Por que ele saiu de dentro de `PorQueNaoTemDevido`.** Morava lá, e aquele
 * componente só aparece quando **não há painel comparado**. Com a 1ª quinzena
 * respondida e a 2ª não — o caso real de julho/2026 —, o painel existia: a
 * caixa de pendências dizia "associe a competência a esta unidade" e não havia
 * onde clicar em tela nenhuma. A frase e o gesto passaram a poder viajar
 * juntos.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível associar a unidade.";
}

/**
 * A SUGESTÃO QUE VIRA ATO — associar a competência à unidade cadastrada.
 *
 * **O que ela grava, e por que um botão pode gravá-lo.** Uma coluna:
 * `unidade_id` da competência desta quinzena. Nada do que foi importado é lido
 * ou tocado — nem documentos, nem itens do 03.08.20, nem os bytes originais —, e
 * `unidade_codigo` fica onde está. Errar a unidade custa associar de novo, e não
 * reimportar a quinzena; é essa reversibilidade que faz o clique ser honesto.
 *
 * **Por que o efeito é imediato.** O contrato não é gravado em lugar nenhum: o
 * resumo resolve o cadastro **a cada leitura**. Invalidar a consulta do resumo é
 * tudo o que falta para o devido aparecer — não há reimportação, e nem sequer
 * uma nova apuração, a rodar depois.
 *
 * **Quem confirma é gente, e é o ponto inteiro.** O nome trouxe a candidata até
 * aqui; ele não a escolhe. Havendo mais de uma, cada uma tem o seu botão com o
 * CNPJ ao lado — dois CDDs de nome igual são duas unidades, e a diferença entre
 * elas é o documento, não o rótulo.
 */
export function AssociarUnidade({
  sugestoes,
  quinzena,
  competenciaId,
}: {
  sugestoes: UnidadeSugerida[];
  /**
   * A quinzena que o botão associa — dita, porque a associação é por
   * competência e cada quinzena é uma.
   *
   * As duas metades do mês são duas competências, e associar uma não associa a
   * outra. O texto diz qual está sendo associada, e a outra reaparece com o seu
   * próprio botão na releitura seguinte — em vez de a pessoa clicar uma vez e
   * ficar sem entender por que metade do mês continua sem devido.
   */
  quinzena: 1 | 2;
  /** `null` quando a quinzena do diagnóstico não é uma competência aberta. */
  competenciaId: string | null;
}) {
  const cliente = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);
  const associar = useMutation({
    mutationFn: (unidadeId: string) =>
      associarUnidadeDaCompetencia(competenciaId!, unidadeId),
    onMutate: () => setErro(null),
    /*
      A recusa é do servidor — a competência encerrada é o caso real —, e a tela
      mostra a frase que voltar em vez de reescrevê-la. Duplicar a regra aqui
      daria duas versões dela, e a que a pessoa lê seria a que ninguém testa.
    */
    onError: (e) => setErro(textoDoErro(e)),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
    },
  });

  if (competenciaId === null) return null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {sugestoes.map((s) => (
          <Button
            key={s.id}
            size="sm"
            variant="outline"
            disabled={associar.isPending}
            onClick={() => associar.mutate(s.id)}
          >
            Associar a {s.nome} · {formatarCnpj(s.cnpj)}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground">
        Associa a <strong>{quinzena}ª quinzena</strong> — grava só a identidade
        da unidade nessa competência. Nada do que foi importado é lido ou
        alterado, e o devido aparece na próxima leitura desta tela, sem
        reimportar e sem apurar de novo. A outra quinzena do mesmo texto é
        associada junto, porque a decisão é sobre a unidade e não sobre a linha
        — ver `identidade-da-competencia.ts`.
      </p>
      {erro && <p className="text-destructive">{erro}</p>}
    </div>
  );
}
