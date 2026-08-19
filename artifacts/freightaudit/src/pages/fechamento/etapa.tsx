import { ArrowRight, Hammer } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EtapaFechamento } from "./etapas";

/**
 * A tela de uma etapa do Fechamento que ainda não mostra número.
 *
 * É o mesmo desenho de `pages/em-preparo.tsx`, e a semelhança é o argumento:
 * o produto já tem uma forma de dizer "esta tela existe, e eis o que falta
 * para ela responder", e o Fechamento nasce falando essa língua. O que muda é
 * o conteúdo — as dependências aqui são as do processo de fechamento — e um
 * detalhe que lá não existe: os atalhos de "onde olhar hoje" quase sempre
 * levam à Auditoria, e a tarja ao lado do nome diz isso antes do clique, para
 * que ninguém troque de ambiente sem saber.
 *
 * Não é o mesmo componente de propósito. Os dois catálogos vão divergir — o
 * da Auditoria caminha para telas de auditoria, este para um fluxo com etapas
 * e estados — e uma abstração comum agora acoplaria os dois domínios pelo
 * detalhe mais transitório que eles têm: a aparência do estado vazio.
 */
export function EtapaDoFechamento({ etapa }: { etapa: EtapaFechamento }) {
  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-2">
          <etapa.icon className="w-6 h-6 text-nav-fechamento" />
          <h1 className="text-2xl font-bold tracking-tight">{etapa.label}</h1>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Hammer className="w-3 h-3" />
            Em preparo
          </span>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">{etapa.pergunta}</p>
      </header>

      <div className="p-8 space-y-6 max-w-3xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              O que falta para esta etapa mostrar um número
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm">
              {etapa.depende.map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span
                    aria-hidden
                    className="mt-[0.4375rem] w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0"
                  />
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-muted-foreground border-t pt-3">
              Enquanto faltar, esta tela não mostra nada — nem exemplo, nem valor
              de demonstração. Um número sem lastro é pior do que nenhum: ele é
              usado.
            </p>
          </CardContent>
        </Card>

        {etapa.hoje.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Onde olhar hoje</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {etapa.hoje.map((atalho) => (
                <Link
                  key={atalho.href}
                  href={atalho.href}
                  className="flex items-start gap-3 px-6 py-3 border-t first:border-t-0 hover:bg-muted/40 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {atalho.label}
                      {/*
                        A tarja avisa que o clique troca de espaço de trabalho.
                        É a integração entre os dois ambientes do jeito que ela
                        deve aparecer na interface: um link dito por extenso,
                        nunca uma tela do outro domínio embutida nesta.
                      */}
                      {atalho.ambiente === "auditoria" && (
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wide text-muted-foreground">
                          Auditoria
                        </span>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {atalho.porque}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground mt-0.5" />
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
