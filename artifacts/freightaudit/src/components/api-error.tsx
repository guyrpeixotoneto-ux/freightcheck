import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { fetchJson } from "@/lib/api";

/**
 * Uma chamada de API que falhou, dita de um jeito que aponta para a causa.
 *
 * Um 500 em `/api/overview` não é um defeito do Painel, e tratá-lo como tal
 * manda quem está olhando procurar no lugar errado. Quase sempre a resposta
 * está em `/api/healthz`, que é público, responde mesmo com o banco fora e diz
 * qual dos três elos quebrou: a variável não chegou ao processo, o banco não
 * respondeu no endereço dela, ou o schema não existe do outro lado.
 *
 * Então é isso que este aviso faz — pergunta ao `/healthz` e escreve a resposta
 * em português, sem expor host, porta nem credencial (o endpoint já se recusa a
 * devolvê-los).
 */

interface DatabaseHealth {
  configured: boolean;
  reachable: boolean;
  migrated: boolean;
  upToDate?: boolean;
  migrations?: {
    expected: number;
    applied: number;
    pending: string[];
    failure?: { tag: string; code?: string };
  };
  code?: string;
  detail: string;
}

function diagnose(database: DatabaseHealth | undefined): string | null {
  if (!database) return null;
  if (!database.configured) {
    return (
      "O servidor da API está no ar, mas não recebeu a DATABASE_URL. Toda rota " +
      "que lê o banco responde 500 enquanto isso. O banco pode estar saudável: " +
      "o que falta é a variável chegar ao processo publicado."
    );
  }
  if (!database.reachable) return database.detail;
  if (!database.migrated) {
    return (
      "O servidor conecta no banco, mas o schema não existe lá — faltam as " +
      "migrations. Nenhuma tabela consultada por esta tela foi criada ainda."
    );
  }
  /*
    O caso do meio, que faltava: o banco existe e está quase todo lá, e o que
    falta é a migration da tela que acabou de falhar. Enquanto este ramo não
    existia, "conectado e migrado" mandava procurar o defeito na tela — e o
    defeito era uma tabela que nunca chegou a ser criada.
  */
  const pendentes = database.migrations?.pending ?? [];
  if (pendentes.length > 0) return database.detail;
  return null;
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

  const cause = diagnose(health?.database);
  const message = error instanceof Error ? error.message : String(error);

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 space-y-2 text-amber-900">
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        {what}
      </div>
      {cause && <p className="text-sm">{cause}</p>}
      <p className="text-xs font-mono break-words opacity-80">{message}</p>
      {!cause && (
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
