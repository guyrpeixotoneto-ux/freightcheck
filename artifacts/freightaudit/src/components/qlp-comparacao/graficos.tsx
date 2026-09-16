import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber } from "@/lib/format";
import { ROTULO_DO_ESTADO, type ComparacaoDeQlp, type EstadoDaLinha } from "@/lib/qlp-comparacao";

/**
 * Os dois painéis da comparação do quadro — e a regra que vale para os dois:
 * **nenhum deles soma o que o núcleo não somou.**
 *
 * Cada um recebe a série já agregada pelo servidor e desenha. Agregar dentro de
 * um componente de gráfico é como o cartão e o gráfico da mesma tela passam a
 * mostrar números diferentes — um soma a página, o outro soma o recorte.
 *
 * São os mesmos dois painéis das seis auditorias de rubrica, com o ativo
 * trocado pelo cargo. Um terceiro painel, de total em reais, é o que **não**
 * existe aqui: as colunas do QLP chegam sem semântica confirmada, e um gráfico
 * de custo da estrutura seria a primeira soma de dinheiro do quadro no produto.
 */

const COR_DO_ESTADO: Record<EstadoDaLinha, string> = {
  SEM_ALTERACAO: "hsl(var(--success))",
  ALTERADO: "hsl(var(--warning))",
  NOVO_NA_VIGENCIA: "hsl(var(--brand))",
  AUSENTE_NA_COMPARADA: "hsl(var(--destructive))",
  DADO_INCOMPLETO: "hsl(var(--muted-foreground))",
  CONFLITO: "hsl(var(--brand-red))",
};

function Painel({
  titulo,
  fonte,
  children,
}: {
  titulo: string;
  fonte?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="superficie flex min-w-0 flex-col gap-3 p-4">
      <h3 className="text-sm font-bold">{titulo}</h3>
      {children}
      {fonte && <p className="text-[0.7rem] text-muted-foreground">{fonte}</p>}
    </section>
  );
}

/**
 * As variáveis que se moveram — e as que não se moveram, no fim da lista.
 *
 * O catálogo inteiro entra de propósito: uma barra vazia ao lado de "Salário
 * unitário" diz que ninguém mexeu em salário nesta quinzena, e isso é uma
 * resposta. Uma lista que só mostrasse o que mudou deixaria quem procura a
 * variável sem saber se ela não mudou ou se a tela não a lê.
 */
export function AlteracoesPorVariavel({
  dados,
}: {
  dados: ComparacaoDeQlp["alteracoesPorVariavel"];
}) {
  const comAlteracao = dados.filter((d) => d.alteracoes > 0);
  const total = comAlteracao.reduce((acc, d) => acc + d.alteracoes, 0);

  return (
    <Painel
      titulo="Alterações por variável"
      fonte={
        comAlteracao.length === 0
          ? undefined
          : `${formatNumber(total, 0)} alterações no recorte, em ${formatNumber(comAlteracao.length, 0)} de ${formatNumber(dados.length, 0)} variáveis do quadro.`
      }
    >
      {comAlteracao.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhuma variável do quadro se moveu entre as duas vigências.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(160, comAlteracao.length * 30)}>
          <BarChart
            data={comAlteracao}
            layout="vertical"
            margin={{ top: 4, right: 32, left: 8, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="rotulo"
              width={148}
              tick={{ fontSize: 11 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              formatter={(v: number) => [`${formatNumber(v, 0)}`, "cargos"]}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="alteracoes" fill="hsl(var(--brand))" radius={[0, 4, 4, 0]}>
              <LabelList dataKey="alteracoes" position="right" style={{ fontSize: 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Painel>
  );
}

/**
 * Os cargos por status — um cargo numa fatia só, pela gravidade.
 *
 * As fatias somam exatamente os cargos comparados: quem tem conflito conta como
 * conflito ainda que também tenha uma variável alterada, e os sem alteração
 * saem da contagem da vigência, não da lista (o `change_set` não guarda o que
 * não mudou). Uma rosca cujas partes somam mais do que o total é um gráfico em
 * que ninguém acredita.
 */
export function DistribuicaoPorEstado({
  dados,
}: {
  dados: ComparacaoDeQlp["distribuicaoPorEstado"];
}) {
  const total = dados.reduce((acc, d) => acc + d.cargos, 0);
  const fatias = dados.map((d) => ({
    ...d,
    rotulo: ROTULO_DO_ESTADO[d.estado],
    fracao: total === 0 ? 0 : d.cargos / total,
  }));

  return (
    <Painel
      titulo="Cargos por status"
      fonte={`${formatNumber(total, 0)} cargos no recorte.`}
    >
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum cargo neste recorte.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <ResponsiveContainer width="100%" height={188} className="!w-[188px] flex-none">
            <PieChart>
              <Pie
                data={fatias}
                dataKey="cargos"
                nameKey="rotulo"
                innerRadius={52}
                outerRadius={82}
                paddingAngle={1}
                stroke="none"
              >
                {fatias.map((d) => (
                  <Cell key={d.estado} fill={COR_DO_ESTADO[d.estado]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number, nome: string) => [`${formatNumber(v, 0)} cargos`, nome]}
                contentStyle={{ fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          {/* Piso de largura na legenda: sem ele, "Sem alteração" sai como "S…"
              ao lado da rosca, e um estado abreviado a uma letra é um enigma. */}
          <ul className="flex min-w-[13rem] flex-1 flex-col gap-1.5 text-xs">
            {fatias.map((d) => (
              <li key={d.estado} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 flex-none rounded-sm"
                  style={{ background: COR_DO_ESTADO[d.estado] }}
                />
                <span className="leading-tight">{d.rotulo}</span>
                <span className="ml-auto font-mono font-semibold tabular-nums">
                  {formatNumber(d.cargos, 0)}
                </span>
                <span className="w-12 text-right text-muted-foreground">
                  {formatNumber(d.fracao * 100, 1)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Painel>
  );
}
