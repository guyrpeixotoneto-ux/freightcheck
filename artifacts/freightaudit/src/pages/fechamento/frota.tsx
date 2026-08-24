import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Truck, TriangleAlert } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { useBaseDoFechamento } from "@/lib/base-do-fechamento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";
import {
  lerFrotaDaCompetencia,
  type GrupoDeFrotaComparado,
  type MovimentoDaFrota,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível carregar a frota.";
}

const ROTULO_DO_MOVIMENTO: Record<MovimentoDaFrota, string> = {
  IGUAL: "Bate",
  SUBIU: "Promax acima",
  DESCEU: "Promax abaixo",
  GANHOU_LASTRO: "Só no Promax",
  PERDEU_LASTRO: "Só no contrato",
  SEM_COMPARACAO: "Sem referência",
};

/** A cor do selo — divergência chama atenção, o resto não. */
function corDoMovimento(m: MovimentoDaFrota): string {
  switch (m) {
    case "IGUAL":
      return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
    case "SUBIU":
    case "DESCEU":
    case "GANHOU_LASTRO":
    case "PERDEU_LASTRO":
      return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function SeloDoMovimento({ movimento }: { movimento: MovimentoDaFrota }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium",
        corDoMovimento(movimento),
      )}
    >
      {ROTULO_DO_MOVIMENTO[movimento]}
    </span>
  );
}

function LinhaDoGrupo({ grupo }: { grupo: GrupoDeFrotaComparado }) {
  const emConflito = grupo.quantidadePromax === null;
  return (
    <tr className={cn("border-b last:border-0", emConflito && "bg-destructive/5")}>
      <td className="py-2 pr-4">{grupo.unidade}</td>
      <td className="py-2 pr-4">{grupo.modelo}</td>
      <td className="py-2 pr-4">
        {grupo.situacao === "ATIVA" ? "Ativa" : "Inativa"}
      </td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">
        {emConflito ? (
          <span className="inline-flex items-center gap-1 text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" /> conflito
          </span>
        ) : (
          grupo.quantidadePromax
        )}
      </td>
      {grupo.referencias.length === 0 ? (
        <td className="py-2 text-muted-foreground" colSpan={3}>
          Sem referência de contrato para esta categoria.
        </td>
      ) : (
        <td className="py-2" colSpan={3}>
          <div className="space-y-1">
            {grupo.referencias.map((r) => (
              <div key={r.nome} className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">{r.nome}</span>
                <span className="font-mono tabular-nums">
                  {r.quantidade ?? "—"}
                </span>
                <span className="font-mono tabular-nums w-12 text-right">
                  {r.diferenca === null ? "—" : r.diferenca > 0 ? `+${r.diferenca}` : r.diferenca}
                </span>
                <SeloDoMovimento movimento={r.movimento} />
              </div>
            ))}
          </div>
        </td>
      )}
    </tr>
  );
}

/**
 * A FROTA — o que o Promax diz que está ativo/inativo contra o cadastro do
 * contrato.
 *
 * **É conferência operacional, não financeira.** Nenhum número desta tela
 * entra em cálculo de remuneração — ver `lado: "CONFERENCIA_OPERACIONAL"` no
 * domínio do fechamento. A pergunta que ela responde é rápida e direta: o que
 * o Promax importou como frota ativa e inativa bate com o que o contrato
 * declara?
 *
 * **O sistema não decide qual número está certo.** Cada linha mostra os dois
 * números — Promax e contrato — e a diferença; a decisão de qual está certo é
 * de quem confere, sempre.
 *
 * **Conflitos aparecem à parte.** Quando o mesmo veículo (placa) chega marcado
 * como ativo e inativo dentro da mesma leitura, a linha não escolhe um dos
 * dois — mostra o conflito e a evidência, para que a importação seja revista.
 */
export default function FrotaDaCompetencia({ id }: { id: string }) {
  const base = useBaseDoFechamento();
  const dados = useQuery({
    queryKey: ["fechamento", "competencia", id, "frota"],
    queryFn: () => lerFrotaDaCompetencia(id),
  });

  return (
    <Layout>
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link
              href={`${base}/competencias/${id}`}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Voltar à competência
            </Link>
            <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
              <Truck className="h-5 w-5" /> Frota
            </h1>
            <p className="text-sm text-muted-foreground">
              Promax (01.22.02.00 / 01.22.08.00) contra o cadastro do contrato — conferência
              operacional, fora do cálculo de remuneração.
            </p>
          </div>
        </div>

        {dados.isLoading && (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        )}

        {dados.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
          </Alert>
        )}

        {dados.data && (
          <>
            {dados.data.conflitos.length > 0 && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                  <p className="font-medium">
                    {dados.data.conflitos.length} conflito(s) de leitura — o mesmo veículo
                    aparece como ativo e como inativo.
                  </p>
                  <ul className="mt-2 space-y-1 text-xs">
                    {dados.data.conflitos.map((c, i) => (
                      <li key={i}>
                        {c.unidade} · {c.modelo}: placas{" "}
                        {[...new Set(c.evidencia.map((e) => e.placa))].join(", ")}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs">
                    Nenhum total foi escolhido para estes grupos — reveja os dois arquivos
                    (
                    <Link href={`${base}/competencias/${id}`} className="underline">
                      ver documentos enviados
                    </Link>
                    ) antes de confiar na contagem.
                  </p>
                </AlertDescription>
              </Alert>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Por unidade, modelo/categoria e situação
                </CardTitle>
              </CardHeader>
              <CardContent>
                {dados.data.grupos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma linha de frota Promax importada nesta competência ainda. Envie o
                    01.22.02.00 e/ou o 01.22.08.00 na lista de relatórios.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th className="py-2 pr-4 font-medium">Unidade</th>
                          <th className="py-2 pr-4 font-medium">Modelo/Categoria</th>
                          <th className="py-2 pr-4 font-medium">Situação</th>
                          <th className="py-2 pr-4 font-medium text-right">Promax</th>
                          <th className="py-2 font-medium" colSpan={3}>
                            Referência (contrato)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {dados.data.grupos.map((g, i) => (
                          <LinhaDoGrupo key={i} grupo={g} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </Layout>
  );
}
