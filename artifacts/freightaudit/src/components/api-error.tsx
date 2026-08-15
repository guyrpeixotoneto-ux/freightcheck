import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
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
}: {
  error: unknown;
  what: string;
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
      {vista.mostrarLinkHealthz && (
        <p className="text-xs">
          <a href="/api/healthz" className="underline">
            /api/healthz
          </a>{" "}
          diz o que o servidor enxerga do banco.
        </p>
      )}
    </div>
  );
}
