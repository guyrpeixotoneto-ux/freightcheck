import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetalhesTecnicos } from "@/components/detalhes-tecnicos";
import { apresentar } from "@/lib/apresentar-erro";
import { consultarProntidao, PRONTIDAO_QUERY_KEY } from "@/lib/prontidao";

/**
 * Uma chamada de API que falhou, dita de um jeito que aponta para a causa.
 *
 * Um 500 em `/api/overview` não é um defeito do Painel, e tratá-lo como tal
 * manda quem está olhando procurar no lugar errado. Quase sempre a resposta
 * está no estado do ambiente, que o servidor classifica num lugar só e publica
 * tanto no corpo do erro quanto em `/api/readyz`.
 *
 * **Uma recomendação, nunca duas.** Este componente imprimia dois textos
 * sempre: o do `/healthz` e a mensagem crua da rota, um embaixo do outro. Ver
 * `lib/apresentar-erro.ts`, que é onde essa decisão passou a morar e onde ela é
 * testada. Aqui só se desenha o que aquela função devolveu.
 *
 * **E a tela pergunta sozinha.** A versão anterior deste aviso terminava com um
 * link para `/api/healthz` — o produto entregando um endpoint técnico a quem só
 * queria a lista, e transferindo o diagnóstico para quem menos tem como
 * fazê-lo. A pergunta sempre foi possível de fazer daqui; agora ela é feita.
 * Ver `lib/prontidao.ts`.
 */

export function ApiErrorNotice({
  error,
  what,
  onTentarDeNovo,
  tentando = false,
}: {
  error: unknown;
  what: string;
  /**
   * A tentativa manual, quando quem chama tem uma para oferecer.
   *
   * Opcional porque nem todo uso deste componente tem o que repetir, e
   * obrigatório de oferecer em todo uso que tenha: este painel aparece
   * exatamente no caso em que **não há nada em tela** — as tentativas
   * automáticas se esgotaram e nunca houve resposta —, que é o caso em que a
   * pessoa mais precisa de um botão e o único em que ela não tinha nenhum.
   *
   * A tira âmbar de "o que está em tela é de HH:MM" já oferecia o seu desde o
   * começo, e ela é a situação **confortável**: ali existe uma lista correta
   * embaixo do aviso. O painel, que substitui a tela inteira, obrigava a
   * recarregar a página na mão — e recarregar a página é justamente o gesto que
   * faz ninguém nunca ver a recuperação acontecer.
   */
  onTentarDeNovo?: () => void;
  /** Há tentativa em voo agora: o botão vira rótulo e para de aceitar clique. */
  tentando?: boolean;
}) {
  /*
    `retry: false` de propósito: isto roda quando algo já falhou, e insistir só
    atrasa a mensagem que a pessoa está esperando. `consultarProntidao` não
    lança — nem quando o servidor está fora do ar —, então o desfecho de não
    conseguir perguntar também chega como resposta, e não como erro de query.
  */
  const { data: prontidao } = useQuery({
    queryKey: PRONTIDAO_QUERY_KEY,
    queryFn: ({ signal }) => consultarProntidao(signal),
    retry: false,
    staleTime: 15_000,
  });

  const vista = apresentar(error, prontidao);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 space-y-2 text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {what}
      </div>

      {vista.contexto && <p className="text-sm">{vista.contexto}</p>}

      {/*
        A mensagem principal, e ela é uma frase em português sobre o que houve.
        O nome da migration, o comando e o SQLSTATE continuam existindo — logo
        abaixo, atrás de "Detalhes técnicos".
      */}
      {vista.principal && <p className="text-sm">{vista.principal}</p>}

      {/*
        Sem orientação nenhuma — ninguém soube explicar. Aí a mensagem crua e o
        identificador da requisição são o que se tem, e é honesto dizer o que
        eles servem para fazer em vez de deixar a caixa terminar no vazio.
      */}
      {vista.principal === null && (
        <p className="text-sm">
          Não foi possível determinar a causa desta falha, e o ambiente não
          reportou nenhum problema. Nada do que você enviou foi gravado — os
          detalhes abaixo identificam esta chamada para quem for investigar.
        </p>
      )}

      <DetalhesTecnicos detalhes={vista.detalhes} className="pt-1" />

      {/*
        O botão vem por último, depois da orientação, e não antes dela: a
        orientação é o que diz se repetir tem chance de mudar alguma coisa. Numa
        migration que falta, repetir dá o mesmo 503 — e é para isso que o texto
        acima existe. Quem oferece o botão é a tela, que sabe se tem o que
        repetir.
      */}
      {onTentarDeNovo && (
        <Button
          variant="outline"
          size="sm"
          className="mt-1"
          disabled={tentando}
          onClick={onTentarDeNovo}
        >
          {tentando ? "Tentando…" : "Tentar de novo"}
        </Button>
      )}
    </div>
  );
}
