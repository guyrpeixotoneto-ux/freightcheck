import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Building2,
  CloudDownload,
  FileSearch,
  GitCompareArrows,
  LayoutGrid,
  Scale,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import type { GroupedView } from "@/components/inicio/types";
import type { BalancoResumo } from "@/components/balanco/tipos";

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

  /*
    O balanço vem numa consulta própria, e não junto do resto.

    É a única linha desta tela que pode dizer "há um defeito", e por isso ela
    não pode depender de a visão agrupada ter respondido: um erro na comparação
    apagaria justamente o aviso de que uma célula sumiu. `retry: false` e o
    `null` no erro mantêm a regra da página — sem resposta, a linha some, e
    nunca aparece um número de enfeite no lugar dela.
  */
  const { data: balancos } = useQuery({
    queryKey: ["balance", "inicio"],
    queryFn: async () => {
      const response = await fetch(getApiUrl("/balance"));
      if (!response.ok) return null;
      return (await response.json()) as BalancoResumo[];
    },
    retry: false,
    staleTime: 60_000,
  });

  const massa = useMemo(() => resumirMassa(balancos), [balancos]);

  const primeiroNome = (user?.name ?? "").trim().split(/\s+/)[0] || "bem-vindo";

  return (
    <Layout>
      <div className="px-10 py-6 max-w-[1400px]">
        <h1 className="text-3xl font-bold tracking-tight">Olá, {primeiroNome}!</h1>
        <div className="border-t mt-4 mb-6" />

        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
          <CartaoEntrada
            href="/balanco-massa"
            icone={Scale}
            titulo="Balanço de massa"
            descricao="Se toda célula que o arquivo trouxe chegou a algum lugar — e o que não chegou"
            estado={massa?.texto ?? null}
            alerta={massa?.alerta ?? false}
          />
        </div>

        <aside className="mt-6 bg-card border border-l-[6px] border-l-brand-red shadow-sm">
          <div className="flex flex-wrap items-center gap-6 px-7 py-5">
            <AlertCircle className="w-10 h-10 text-brand-red shrink-0" strokeWidth={2} />
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
                className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand hover:underline"
              >
                Ver curadoria
              </Link>
              <Link
                href="/versoes"
                className="text-[0.8125rem] font-bold uppercase tracking-wide text-brand border border-brand px-5 py-3 hover:bg-accent transition-colors"
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
 *
 * `alerta` existe por causa de um cartão só, e por um motivo que vale para
 * qualquer outro que venha a precisar: "173.919 células conferidas" e "12
 * células sem destino" não podem sair com a mesma tipografia. A primeira é
 * rotina e some na moldura, como deve; a segunda é o defeito mais grave que
 * este produto sabe encontrar, e sair discreta seria o mesmo que não sair.
 */
function CartaoEntrada({
  href,
  icone: Icone,
  titulo,
  descricao,
  estado,
  alerta = false,
}: {
  href: string;
  icone: typeof Activity;
  titulo: string;
  descricao: string;
  estado: string | null;
  alerta?: boolean;
}) {
  return (
    <Link
      href={href}
      className="group bg-card border border-t-[3px] border-t-brand shadow-sm hover:shadow-md transition-shadow flex flex-col p-5 min-h-40"
    >
      <Icone className="w-7 h-7 text-brand shrink-0" strokeWidth={2} />
      <h2 className="text-xl font-bold mt-3 group-hover:text-brand transition-colors">
        {titulo}
      </h2>
      <p className="text-sm text-muted-foreground mt-2 leading-snug flex-1">{descricao}</p>
      {estado && (
        <p
          className={cn(
            "text-[0.8125rem] font-semibold mt-3 pt-3 border-t truncate",
            alerta && "text-red-700 flex items-center gap-1.5",
          )}
        >
          {alerta && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {estado}
        </p>
      )}
    </Link>
  );
}

/**
 * O balanço de todas as importações, em uma linha de cartão.
 *
 * Três desfechos, e eles não se confundem — é a mesma distinção que a tela do
 * Balanço faz, encurtada até caber aqui:
 *
 * - **Sobrou célula sem destino**, ou a captura não confere: defeito, e o
 *   cartão diz isso em vermelho.
 * - **Fecha com recusas**: a conta está fechada e mesmo assim o arquivo trouxe
 *   coisa que o sistema não aproveitou. Dizer só "conferidas" aqui seria
 *   verdade contando pela metade.
 * - **Fecha limpo**: o número de células, que é o que dá tamanho à conferência.
 *
 * Sem importação nenhuma devolve `null`, e a linha some: um "0 células" num
 * banco vazio parece resultado de uma conferência que não aconteceu.
 */
function resumirMassa(
  balancos: BalancoResumo[] | null | undefined,
): { texto: string; alerta: boolean } | null {
  if (!balancos || balancos.length === 0) return null;

  const celulas = balancos.reduce((total, b) => total + b.entrada, 0);
  const residuo = balancos.reduce((total, b) => total + b.residuo, 0);
  const perdas = balancos.reduce((total, b) => total + b.porNatureza.PERDA, 0);
  const naoFecham = balancos.filter((b) => !b.fecha).length;

  if (residuo > 0) {
    return {
      texto: `${n(residuo)} ${residuo === 1 ? "célula sem destino" : "células sem destino"}`,
      alerta: true,
    };
  }
  if (naoFecham > 0) {
    // Resíduo zero e ainda assim não fecha: o que está em RAW hoje não é o que
    // a importação registrou ter capturado. Ver `capturaConfere`.
    return {
      texto: `${n(naoFecham)} ${naoFecham === 1 ? "importação não fecha" : "importações não fecham"}`,
      alerta: true,
    };
  }

  const conferidas = `${n(celulas)} células conferidas`;
  return {
    texto: perdas > 0 ? `${conferidas} · ${n(perdas)} recusadas` : conferidas,
    alerta: false,
  };
}

function n(valor: number): string {
  return valor.toLocaleString("pt-BR");
}
