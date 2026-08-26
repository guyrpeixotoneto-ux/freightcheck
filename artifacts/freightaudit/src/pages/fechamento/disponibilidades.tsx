import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, GaugeCircle } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import {
  useBaseDoFechamento,
  useOperacaoDoFechamento,
} from "@/lib/base-do-fechamento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apresentar } from "@/lib/apresentar-erro";
import { listarCompetencias, NOME_DO_ESTADO } from "@/lib/fechamento";
import { nomeDaParte } from "@/lib/fechamento-gerencial";
import { rotuloDaCompetencia } from "./frotas";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível carregar as competências.";
}

/**
 * DISPONIBILIDADE — a porta de entrada do 03.08.18, uma competência por linha.
 *
 * Mesma forma de `frotas.tsx`, e pela mesma razão: a leitura é sempre a
 * disponibilidade *de um período* (`/competencias/:id/disponibilidade`), e a
 * lateral precisa de um endereço que não pergunte "de qual competência" antes.
 *
 * O rótulo da linha vem de `frotas.tsx` em vez de ser reescrito aqui: o `- 1`
 * do mês 1-indexado já foi esquecido uma vez neste módulo, e uma segunda cópia
 * é a segunda chance de esquecê-lo.
 */
export default function Disponibilidades() {
  const base = useBaseDoFechamento();
  const operacao = useOperacaoDoFechamento();
  const competencias = useQuery({
    queryKey: ["fechamento", operacao, "competencias-para-disponibilidade"],
    queryFn: () => listarCompetencias(operacao),
  });

  return (
    <Layout>
      <div className="p-8 space-y-6 max-w-4xl">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <GaugeCircle className="h-5 w-5" /> Disponibilidade
          </h1>
          <p className="text-sm text-muted-foreground">
            O 03.08.18 dia a dia — frota contratada, o que rodou, o gap de cada lado e o
            desconto que ele produz, competência a competência.
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
                        href={`${base}/competencias/${c.id}/disponibilidade`}
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
