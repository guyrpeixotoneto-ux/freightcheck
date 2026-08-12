import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Calculator,
  Check,
  FileSearch,
  GitCompareArrows,
  Lock,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getApiUrl } from "@/lib/api";

/**
 * Simulação — a tela que ainda não responde, dizendo por quê.
 *
 * O que existia aqui era scaffold do schema anterior: chamava `/simulations`,
 * `/shipments` e um `formatBRL` único somando tudo. As rotas saíram junto com
 * aquele schema (`artifacts/api-server/src/routes/index.ts`), então cada visita
 * disparava 404 no console e a única forma de descobrir isso era clicar em
 * "Executar Simulação" e receber um alert. Uma tela que promete um número e
 * devolve 404 é pior que uma tela que não promete nada.
 *
 * Enquanto o motor de F4 não existe, esta rota carrega o que o produto sabe
 * sobre a própria lacuna — e nenhuma chamada a endpoint que não existe. A única
 * leitura é `/curation/summary`, a mesma do menu, porque o tamanho do backlog é
 * a parte da resposta que muda sozinha conforme alguém confirma semântica.
 *
 * O desenho completo está em `docs/PROPOSTA-SIMULACAO.md`.
 */

/** Atributos monetários que ainda não podem virar número. Falha em silêncio. */
function useCurationBacklog() {
  return useQuery({
    queryKey: ["curation", "summary", "simulacao"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/curation/summary"));
      if (!response.ok) return null;
      const data = (await response.json()) as {
        byStatus: { status: string; count: number; monetary: number }[];
      };
      const pending = data.byStatus
        .filter((s) => s.status !== "CONFIRMED")
        .reduce((sum, s) => sum + s.monetary, 0);
      const confirmed = data.byStatus
        .filter((s) => s.status === "CONFIRMED")
        .reduce((sum, s) => sum + s.monetary, 0);
      return { pending, confirmed };
    },
    staleTime: 60_000,
    retry: false,
  });
}

export default function Simulacao() {
  const { data: backlog } = useCurationBacklog();

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Calculator className="w-6 h-6 text-muted-foreground" />
            Simulação
          </h1>
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-900">
            <Lock className="w-3 h-3" />
            ainda não disponível
          </span>
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Esta é a única tela do produto que <strong>produz</strong> um número em
          vez de reportar um — e por isso é a que mais pode mentir. Ela fica
          fechada até que a conta que ela faria seja defensável célula a célula.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-4xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Por que ainda não há simulação aqui
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              Perguntar "quanto custa esta frota em 2026" exige pôr tudo na mesma
              unidade. Alterações e Comparar escapam disso{" "}
              <strong>não somando</strong>: o impacto é acumulado por
              periodicidade, e a tela mostra mensal e anual lado a lado. A
              Simulação não tem essa saída — ela precisa de um total, e é no
              caminho até esse total que uma premissa não dita vira um número
              errado.
            </p>
            <ul className="space-y-2 text-muted-foreground">
              <li>
                <strong className="text-foreground">
                  Mensal → anual é ×12, e mesmo isso é premissa.
                </strong>{" "}
                Doze é quantas vezes um custo mensal incide num ano{" "}
                <em>se incidir o ano inteiro</em>. O FINAME tem prazo: no ano em
                que ele termina, não incide doze vezes.
              </li>
              <li>
                <strong className="text-foreground">
                  Pontual não converte, em nenhuma direção.
                </strong>{" "}
                Dividir o valor de compra por doze não produz custo mensal —
                produz uma depreciação com vida útil que ninguém informou.
              </li>
              <li>
                <strong className="text-foreground">
                  Sem periodicidade confirmada, o atributo fica fora do total.
                </strong>{" "}
                Fora, mas nomeado na tela — nunca somado como se fosse zero.
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">O que falta, em ordem</CardTitle>
            <p className="text-xs text-muted-foreground">
              As duas primeiras linhas já existem e têm teste.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <Step
              done
              title="Conversão de periodicidade"
              detail="A tabela 3×3 completa, com três recusas explícitas. Toda conversão sai com o fator à vista e rotulada como exata ou projeção linear."
            />
            <Step
              done
              title="Horizonte declarado"
              detail="O período é de quem opera — 'Jan a Dez/2026'. Horizonte que não fecha em meses inteiros é recusado em vez de rateado por dia."
            />
            <Step
              title="Motor sobre o modelo canônico"
              detail="Ler os fatos da vigência, aplicar a conversão atributo a atributo e acumular o que sobrevive às recusas — com a lista do que ficou de fora, e por quê."
            />
            <Step
              title="Rota de API e esta tela, reescritas"
              detail="A tela mostra o total, as premissas que o produziram e as linhas excluídas. As rotas /simulations do schema antigo saem do openapi.yaml."
            />
            <Step
              title="Curadoria dos atributos monetários"
              detail={
                backlog
                  ? `${backlog.pending} atributos monetários ainda sem semântica confirmada, contra ${backlog.confirmed} confirmados. Cada pendente é uma linha que a simulação teria de deixar fora do total.`
                  : "Cada atributo monetário sem semântica confirmada é uma linha que a simulação teria de deixar fora do total."
              }
              link={{ href: "/curadoria", label: "Ir para a Curadoria" }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              O que já responde, hoje, sem projeção
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Tudo que foi medido está disponível — o que falta é projetar o
              futuro, não enxergar o que mudou.
            </p>
            <div className="flex flex-col gap-2">
              <Shortcut
                href="/alteracoes"
                icon={Activity}
                label="Alterações"
                detail="A última vigência contra a anterior, automaticamente."
              />
              <Shortcut
                href="/comparar"
                icon={GitCompareArrows}
                label="Comparar Vigências"
                detail="Duas vigências quaisquer, escolhidas por você."
              />
              <Shortcut
                href="/curadoria"
                icon={FileSearch}
                label="Curadoria"
                detail="Confirmar a semântica que destrava o impacto em R$."
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Step({
  done,
  title,
  detail,
  link,
}: {
  done?: boolean;
  title: string;
  detail: string;
  link?: { href: string; label: string };
}) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={
          done
            ? "mt-0.5 w-5 h-5 shrink-0 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center"
            : "mt-0.5 w-5 h-5 shrink-0 rounded-full border border-dashed border-muted-foreground/40"
        }
      >
        {done && <Check className="w-3 h-3" />}
      </div>
      <div className="text-sm">
        <div className={done ? "font-medium" : "font-medium text-foreground"}>
          {title}
        </div>
        <p className="text-muted-foreground">{detail}</p>
        {link && (
          <Link
            href={link.href}
            className="text-primary hover:underline inline-flex items-center gap-1 mt-1"
          >
            {link.label}
            <ArrowRight className="w-3 h-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

function Shortcut({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: typeof Activity;
  label: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-md border px-4 py-3 hover:bg-muted/50 transition-colors"
    >
      <Icon className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{detail}</div>
      </div>
      <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
