import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertCircle,
  Building2,
  CloudDownload,
  FileSearch,
  GitCompareArrows,
  LayoutGrid,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { getApiUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { GroupedView } from "@/components/inicio/types";

/**
 * A página inicial, no desenho do Freightech.
 *
 * Lá ela é uma saudação, uma régua e seis cartões de entrada — e é assim aqui.
 * O usuário abre e reconhece o lugar antes de ler qualquer palavra.
 *
 * Uma diferença deliberada, e é a razão do produto existir: **os cartões sabem
 * o estado do sistema.** No Freightech "Exportação de dados" diz sempre a mesma
 * frase; aqui o cartão de vigência diz qual vigência está aberta e quantas
 * alterações ela trouxe. Cartão que repete a mesma frase todo dia vira parte da
 * moldura e para de ser lido.
 *
 * Quando o banco ainda não respondeu — ou não tem vigência nenhuma — o cartão
 * mostra a descrição fixa e nada mais. Nunca um número inventado para preencher.
 */
export default function Inicio() {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["grouped", "inicio"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/changes/grouped"));
      if (!response.ok) return null;
      return (await response.json()) as GroupedView;
    },
    retry: false,
    staleTime: 60_000,
  });

  const primeiroNome = (user?.name ?? "").trim().split(/\s+/)[0] || "bem-vindo";

  return (
    <Layout>
      <div className="px-10 py-8 max-w-[1400px]">
        <h1 className="text-4xl font-bold tracking-tight">Olá, {primeiroNome}!</h1>
        <div className="border-t mt-6 mb-8" />

        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          <CartaoEntrada
            href="/parametros"
            icone={Building2}
            titulo="Seleção de unidades"
            descricao="Escolha unidade, canal e vigência, e veja os parâmetros da seleção"
            estado={data ? `${data.context.label}` : null}
          />
          <CartaoEntrada
            href="/vigencia"
            icone={Activity}
            titulo="Acompanhamento de vigência"
            descricao="A visão geral do que mudou na vigência aberta"
            estado={
              data
                ? `${data.periodLabel} · ${data.totals.changes} ${
                    data.totals.changes === 1 ? "alteração" : "alterações"
                  }`
                : null
            }
          />
          <CartaoEntrada
            href="/parametros"
            icone={LayoutGrid}
            titulo="Parâmetros"
            descricao="Os parâmetros por família, no vocabulário que você já conhece"
            estado={
              data
                ? `${data.totals.groups} ${
                    data.totals.groups === 1 ? "ponto tocado" : "pontos tocados"
                  }`
                : null
            }
          />
          <CartaoEntrada
            href="/comparar"
            icone={GitCompareArrows}
            titulo="Comparar vigências"
            descricao="Escolha duas vigências quaisquer e veja a diferença entre elas"
            estado={data ? `${data.periods.length} no histórico` : null}
          />
          <CartaoEntrada
            href="/curadoria"
            icone={FileSearch}
            titulo="Curadoria"
            descricao="Confirme o significado dos atributos que ainda travam o impacto"
            estado={
              data && data.totals.inconclusive > 0
                ? `${data.totals.inconclusive} sem conclusão`
                : null
            }
          />
          <CartaoEntrada
            href="/importacoes"
            icone={CloudDownload}
            titulo="Importações"
            descricao="Envie a planilha do Freightech e acompanhe o processamento"
            estado={null}
          />
        </div>

        <aside className="mt-8 bg-card border border-l-[6px] border-l-brand-red shadow-sm">
          <div className="flex flex-wrap items-center gap-6 px-8 py-6">
            <AlertCircle className="w-11 h-11 text-brand-red shrink-0" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">Um número aqui nunca é estimativa.</h2>
              <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                Todo valor desta tela sai de uma célula de planilha importada e volta até
                ela. Quando o impacto não pode ser calculado, a tela diz o motivo em vez de
                arredondar. Divergência de fórmula, procure a Curadoria antes de abrir
                chamado.
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <Link
                href="/curadoria"
                className="text-[13px] font-bold uppercase tracking-wide text-brand hover:underline"
              >
                Ver curadoria
              </Link>
              <Link
                href="/versoes"
                className="text-[13px] font-bold uppercase tracking-wide text-brand border border-brand px-5 py-3 hover:bg-accent transition-colors"
              >
                Reportar divergência
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  );
}

/**
 * O cartão de entrada do Freightech: régua laranja no topo, ícone, título forte,
 * descrição cinza. O `estado` é a linha que o Freightech não tem — some quando
 * não há nada verdadeiro para escrever nela.
 */
function CartaoEntrada({
  href,
  icone: Icone,
  titulo,
  descricao,
  estado,
}: {
  href: string;
  icone: typeof Activity;
  titulo: string;
  descricao: string;
  estado: string | null;
}) {
  return (
    <Link
      href={href}
      className="group bg-card border border-t-[3px] border-t-brand shadow-sm hover:shadow-md transition-shadow flex flex-col p-6 min-h-44"
    >
      <Icone className="w-8 h-8 text-brand shrink-0" strokeWidth={2} />
      <h2 className="text-xl font-bold mt-4 group-hover:text-brand transition-colors">
        {titulo}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 leading-snug flex-1">{descricao}</p>
      {estado && (
        <p className="text-[13px] font-semibold mt-3 pt-3 border-t truncate">{estado}</p>
      )}
    </Link>
  );
}
