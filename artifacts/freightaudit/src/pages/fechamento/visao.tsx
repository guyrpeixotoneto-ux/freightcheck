import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CalendarDays, Plus } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listarCompetencias, NOME_DO_ESTADO } from "@/lib/fechamento";
import { ETAPAS_FECHAMENTO } from "./etapas";

/**
 * A porta de entrada do ambiente Fechamento.
 *
 * A competência já existe como registro, e a tela mostra as que existem — com
 * o período, o estado e para onde ir. Enquanto não houver nenhuma, ela não
 * inventa um cockpit vazio: convida a abrir a primeira.
 *
 * O que ela ainda **não** mostra é o valor apurado de cada competência na
 * própria lista. Mostrá-lo aqui exigiria uma leitura por competência a cada
 * abertura da tela, e o número que importa — o que não fecha — só faz sentido
 * ao lado da memória de cálculo que o sustenta, que é a tela de dentro.
 *
 * O que ela já faz, e faz de verdade, é apresentar o processo: as etapas do
 * fechamento na ordem em que acontecem, cada uma com a pergunta que responde.
 * É o mapa do ambiente — o mesmo papel que o menu cumpre, com espaço para
 * dizer o porquê de cada passo — e nenhum item leva a lugar nenhum: toda etapa
 * abre a sua tela, que por sua vez diz o que falta para ela ter número.
 */
export default function VisaoDoFechamento() {
  const competencias = useQuery({
    queryKey: ["fechamento", "competencias"],
    queryFn: listarCompetencias,
  });
  const abertas = competencias.data ?? [];

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Visão do fechamento</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Quanto devemos receber nesta competência, o que está pendente, o que
          precisa ser conferido — e se podemos fechar o período.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-3xl">
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base">Competências</CardTitle>
            <Link href="/fechamento/competencias">
              <Button size="sm" variant="outline">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Abrir competência
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {competencias.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}
            {!competencias.isLoading && abertas.length === 0 && (
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  Nenhuma competência ainda. Uma competência é uma quinzena de um
                  CDD com uma transportadora — abra a primeira e envie os cinco
                  relatórios que a Ambev exporta no período.
                </p>
                <p>
                  A partir deles o FreightCheck reconstrói a conta verba a verba,
                  com a memória de cálculo de cada parcela, e aponta o que não
                  fecha. Nenhum número aparece sem a linha de arquivo que o
                  sustenta.
                </p>
              </div>
            )}
            <ul className="divide-y">
              {abertas.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/fechamento/competencias/${c.id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-muted/50 -mx-2 px-2 rounded"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium">
                        <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                        {c.inicio.split("-").reverse().join("/")} a{" "}
                        {c.fim.split("-").reverse().join("/")}
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                          {NOME_DO_ESTADO[c.estado]}
                        </span>
                      </span>
                      <span className="block text-sm text-muted-foreground truncate">
                        {c.unidade.nome ?? c.unidade.codigo} ·{" "}
                        {c.transportadora.nome ?? c.transportadora.codigo}
                      </span>
                    </span>
                    <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">O processo, na ordem em que acontece</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {ETAPAS_FECHAMENTO.map((etapa, indice) => (
              <Link
                key={etapa.href}
                href={etapa.href}
                className="flex items-start gap-4 px-6 py-4 border-t first:border-t-0 hover:bg-muted/40 transition-colors"
              >
                <span
                  aria-hidden
                  className="w-7 h-7 rounded-full border border-border bg-muted flex items-center justify-center shrink-0 text-[0.75rem] font-bold tabular-nums text-muted-foreground"
                >
                  {indice + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <etapa.icon className="w-4 h-4 text-nav-fechamento" />
                    {etapa.label}
                  </span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {etapa.pergunta}
                  </span>
                </span>
                <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground mt-1" />
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Como isto conversa com a Auditoria</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              Os dois ambientes leem a mesma base e se completam: o Fechamento
              apura quanto a competência vale; a Auditoria confere se aquilo
              está correto — o que mudou, qual o impacto, o que há para
              recuperar. O valor apurado aqui é o que a Auditoria audita lá; a
              divergência encontrada lá volta para cá como pendência ou ajuste.
            </p>
            <p>
              A troca de ambiente é sempre dita: o seletor no topo da tela, ao
              lado da marca, mostra onde você está e leva ao outro espaço de
              trabalho.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
