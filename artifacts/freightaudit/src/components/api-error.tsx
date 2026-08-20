import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";
import { apresentar } from "@/lib/apresentar-erro";
import type { Diagnostico, Orientacao } from "@/lib/diagnostico";

/**
 * Uma chamada de API que falhou, dita de um jeito que aponta para a causa.
 *
 * Um 500 em `/api/overview` não é um defeito do Painel, e tratá-lo como tal
 * manda quem está olhando procurar no lugar errado. Quase sempre a resposta
 * está no diagnóstico do banco, que o servidor classifica num lugar só e
 * publica tanto no corpo do erro quanto no `/api/healthz`.
 *
 * **Uma recomendação, nunca duas.** Este componente imprimia dois textos
 * sempre: o do `/healthz` e a mensagem crua da rota, um embaixo do outro. Ver
 * `lib/apresentar-erro.ts`, que é onde essa decisão passou a morar e onde ela é
 * testada. Aqui só se desenha o que aquela função devolveu.
 */

interface DatabaseHealth {
  configured: boolean;
  reachable: boolean;
  migrated: boolean;
  upToDate?: boolean;
  diagnostico?: Diagnostico;
  detail: string;
}

/** O único lugar do repositório que desenha uma orientação. */
function BlocoDeOrientacao({ orientacao }: { orientacao: Orientacao }) {
  const { acao } = orientacao;
  return (
    <div className="space-y-2 text-sm">
      <p>{orientacao.resumo}</p>
      <p>{orientacao.risco.texto}</p>
      {acao === null ? (
        <p className="font-medium">Nenhuma ação é necessária.</p>
      ) : (
        <div className="space-y-1">
          <p className="font-medium">
            {acao.texto}
            {acao.quem === "plataforma" && (
              <span className="font-normal">
                {" "}
                (não é algo que se resolva por esta tela)
              </span>
            )}
          </p>
          {acao.comando && (
            <pre className="text-xs font-mono bg-amber-100/70 rounded px-2 py-1 overflow-x-auto">
              {acao.comando}
            </pre>
          )}
        </div>
      )}
      {orientacao.evidencia && (
        <p className="text-xs opacity-80">{orientacao.evidencia}</p>
      )}
    </div>
  );
}

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
  // `retry: false` de propósito: isto roda quando algo já falhou, e insistir só
  // atrasa a mensagem que a pessoa está esperando.
  const { data: health } = useQuery({
    queryKey: ["healthz"],
    queryFn: () => fetchJson<{ database: DatabaseHealth }>("/healthz"),
    retry: false,
    staleTime: 30_000,
  });

  const vista = apresentar(error, health?.database);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 space-y-2 text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {what}
      </div>

      {vista.contexto && <p className="text-sm">{vista.contexto}</p>}
      {vista.orientacao && <BlocoDeOrientacao orientacao={vista.orientacao} />}
      {vista.mensagemCrua && (
        <p className="text-xs font-mono break-words opacity-80">
          {vista.mensagemCrua}
        </p>
      )}
      {/*
        O identificador da requisição — a única coisa acionável quando não há
        orientação nenhuma. Era o buraco desta tela: `Internal server error` com
        o `/healthz` respondendo `SAUDAVEL`, e nada que ligasse o que se via ao
        que o servidor registrou. Com este número, quem está na tela consegue
        dizer *qual* chamada falhou a quem consegue ler o log.
      */}
      {vista.requestId && (
        <p className="text-xs">
          Requisição{" "}
          <code className="font-mono select-all">{vista.requestId}</code> — é
          por este número que o log descreve a falha.
        </p>
      )}
      {vista.mostrarLinkHealthz && (
        <p className="text-xs">
          <a href="/api/healthz" className="underline">
            /api/healthz
          </a>{" "}
          diz o que o servidor enxerga do banco.
        </p>
      )}

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
