import { ArrowRight, Hammer } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ETAPAS_FECHAMENTO } from "./etapas";

/**
 * A porta de entrada do ambiente Fechamento.
 *
 * Quando houver uma competência aberta, esta tela será o cockpit dela: em que
 * etapa o período está, quanto já foi apurado, o que ainda bloqueia o
 * encerramento. Hoje não há competência — o registro nem existe no banco — e a
 * tela diz exatamente isso, sem um número inventado.
 *
 * O que ela já faz, e faz de verdade, é apresentar o processo: as etapas do
 * fechamento na ordem em que acontecem, cada uma com a pergunta que responde.
 * É o mapa do ambiente — o mesmo papel que o menu cumpre, com espaço para
 * dizer o porquê de cada passo — e nenhum item leva a lugar nenhum: toda etapa
 * abre a sua tela, que por sua vez diz o que falta para ela ter número.
 */
export default function VisaoDoFechamento() {
  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Visão do fechamento</h1>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Hammer className="w-3 h-3" />
            Em preparo
          </span>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Quanto devemos receber nesta competência, o que está pendente, o que
          precisa ser conferido — e se podemos fechar o período.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-3xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Nenhuma competência aberta</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              O Fechamento apura a remuneração de um período — a competência —
              sobre a mesma base de frota e as mesmas vigências que a Auditoria
              confere. A competência ainda não existe como registro no banco:
              quando existir, esta tela mostrará o período em andamento, a etapa
              em que ele está e o que falta para encerrá-lo.
            </p>
            <p>
              Enquanto isso, nada aqui mostra valor de exemplo. As etapas abaixo
              já abrem, e cada uma diz o que precisa existir antes de ela
              responder.
            </p>
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
