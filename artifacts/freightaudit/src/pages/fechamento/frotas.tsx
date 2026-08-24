import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Truck } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import {
  useBaseDoFechamento,
  useOperacaoDoFechamento,
} from "@/lib/base-do-fechamento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apresentar } from "@/lib/apresentar-erro";
import { listarCompetencias, NOME_DO_ESTADO } from "@/lib/fechamento";
import { MES_LONGO, nomeDaParte } from "@/lib/fechamento-gerencial";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível carregar as competências.";
}

/**
 * FROTAS — a porta de entrada da conferência de frota, uma competência por
 * linha.
 *
 * A conferência em si mora dentro de cada competência
 * (`/competencias/:id/frota`), como o dia mora em `/dias/:dia`: ela é sempre a
 * frota *de um período*. Esta lista existe porque a lateral precisa de um
 * endereço que não pergunte "de qual competência" antes — é a mesma razão de
 * `Apurações` existir ao lado de `Importações`.
 */

/**
 * O rótulo de uma competência nesta lista.
 *
 * **Exportado para ser testável, e não porque outra tela o use.** O mês chega
 * 1-indexado do banco (1 = janeiro) e `MES_LONGO` é 0-indexado: o `- 1` é o
 * mesmo de `apuracoes.tsx`, `resumo.tsx`, `unidade.tsx` e `conciliacao.tsx`.
 * Escrito inline dentro do JSX, esse `- 1` já foi esquecido uma vez — a lista
 * mostrava julho como agosto, e dezembro como `undefined` —, e um erro que só
 * aparece lendo a tela é exatamente o que uma função pura com teste evita.
 */
export function rotuloDaCompetencia(c: {
  mes: number;
  ano: number;
  quinzena: number;
}): string {
  return `${MES_LONGO[c.mes - 1]}/${c.ano}, ${c.quinzena}ª quinzena`;
}

export default function Frotas() {
  const base = useBaseDoFechamento();
  const operacao = useOperacaoDoFechamento();
  const competencias = useQuery({
    queryKey: ["fechamento", operacao, "competencias-para-frota"],
    queryFn: () => listarCompetencias(operacao),
  });

  return (
    <Layout>
      <div className="p-8 space-y-6 max-w-4xl">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Truck className="h-5 w-5" /> Frota
          </h1>
          <p className="text-sm text-muted-foreground">
            O que o Promax diz sobre a frota (ativa/inativa) contra o cadastro do contrato —
            conferência operacional, competência a competência.
          </p>
        </div>

        {competencias.isLoading && (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        )}
        {competencias.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(competencias.error)}</AlertDescription>
          </Alert>
        )}

        {competencias.data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Competências</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {competencias.data.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">
                  Nenhuma competência aberta ainda.
                </p>
              ) : (
                <ul className="divide-y">
                  {competencias.data.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`${base}/competencias/${c.id}/frota`}
                        className="flex items-center justify-between gap-4 px-4 py-3 text-sm hover:bg-muted/50"
                      >
                        <span>
                          {nomeDaParte(c.unidade)} · {nomeDaParte(c.transportadora)} —{" "}
                          {rotuloDaCompetencia(c)}
                        </span>
                        <span className="flex items-center gap-2 text-muted-foreground">
                          {NOME_DO_ESTADO[c.estado]}
                          <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
