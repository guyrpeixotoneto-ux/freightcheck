import { ArrowRight, Hammer } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { TelaEmPreparo } from "./telas-em-preparo";

/**
 * As telas que o menu anuncia e o banco ainda não sustenta.
 *
 * O menu cresceu de dezessete itens para trinta e cinco, e dezoito deles nomeiam
 * trabalho que este produto ainda não faz. Havia três saídas, e duas eram
 * piores:
 *
 * 1. **Deixar os dezoito fora do menu até existirem.** É o que a regra antiga
 *    da lateral manda — item que não funciona não entra na lista. Mas a regra
 *    existe para proteger quem clica, e o desenho pedido aqui é justamente o
 *    mapa do produto inteiro: escondê-lo não protege ninguém, só troca a
 *    pergunta "o que isto faz?" por "isto vai existir?".
 * 2. **Abrir uma tela montada com números plausíveis.** É a única saída
 *    proibida. Um impacto financeiro inventado é indistinguível de um apurado
 *    até o dia em que alguém contesta uma fatura com ele.
 * 3. **Abrir uma tela que diz a verdade.** É esta. Cada rota nova responde com
 *    o que a tela vai perguntar, o que falta no banco para ela responder, e
 *    para onde ir hoje para chegar mais perto — que costuma ser uma tela que já
 *    funciona.
 *
 * O que faz esta escolha honesta é a ausência: **não há um número nesta tela.**
 * Nem exemplo, nem valor de demonstração, nem gráfico cinza com forma de
 * gráfico. Quem abre sai sabendo o que não tem, e é isso que um lugar vazio
 * deve ensinar.
 *
 * Quando `lib/` ganhar o que cada bloco `depende` descreve, a entrada some
 * daqui e a rota passa a apontar para a tela de verdade — sem que o menu mude.
 */

export function EmPreparo({ tela }: { tela: TelaEmPreparo }) {
  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-2">
          <tela.icon className={cn("w-6 h-6", tela.cor)} />
          <h1 className="text-2xl font-bold tracking-tight">{tela.label}</h1>
          <span className="ml-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            <Hammer className="w-3 h-3" />
            Em preparo
          </span>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">{tela.pergunta}</p>
      </header>

      <div className="p-8 space-y-6 max-w-3xl">
        {/*
          O que falta vem primeiro, e não o pedido de desculpas. Quem abriu quer
          saber por que a tela está vazia, e "falta o volume realizado por
          equipamento" responde isso; "estamos trabalhando nisso" não responde.
        */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              O que falta para esta tela mostrar um número
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2.5 text-sm">
              {tela.depende.map((item) => (
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

        {tela.hoje.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Onde olhar hoje</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {tela.hoje.map((atalho) => (
                <Link
                  key={atalho.href}
                  href={atalho.href}
                  className="flex items-start gap-3 px-6 py-3 border-t first:border-t-0 hover:bg-muted/40 transition-colors"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{atalho.label}</span>
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
