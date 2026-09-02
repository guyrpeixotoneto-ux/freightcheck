import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrlShort, periodicitySuffix } from "@/lib/format";
import { escreverImpacto, type ImpactoDeFamilia, type Lado } from "@/lib/visao-geral";

/**
 * Maiores impactos desta vigência — antiga "Onde a Ambev alterou".
 *
 * O pódio nasceu dentro do Dashboard e ficou lá enquanto era de lá. Agora o
 * Panorama publica o mesmo par de cartões debaixo do mesmo gráfico, e um bloco
 * escrito duas vezes é onde as duas leituras começam a divergir sem que
 * ninguém decida isso — a mesma razão que já tinha juntado gráfico e pódio num
 * componente só dentro do Dashboard. Aqui ele sai da página e vira peça, para
 * que a próxima tela que precise dele também não o reescreva.
 *
 * A aritmética continua fora daqui: `impactoPorFamilia` (`lib/visao-geral.ts`)
 * é quem abre `summary.sides` por família, e é a **mesma** lista que as duas
 * colunas recortam. Cada página calcula uma vez e passa aos dois cartões — é
 * calcular duas vezes que deixaria um lado numa periodicidade e o outro noutra.
 */

const CARTAO = "bg-card border rounded-xl shadow-sm";

/**
 * Uma linha do pódio — o mínimo que ele lê, e por isso o que Unidade e Visão
 * Geral conseguem entregar com a mesma forma.
 *
 * `FamilyView` (unidade) tem tudo isto e mais; `OverviewFamilyTotal` (a soma
 * entre unidades) tem só isto, de propósito — "4 de 10 parâmetros" é uma
 * fração de uma unidade e não sobrevive à soma. Tipar pelo mínimo é o que
 * deixa o mesmo pódio servir às duas sem um `as` no meio.
 */
export interface FamiliaNoPodio {
  code: string;
  name: string;
  changes: number;
  impact: { byPeriodicity: Record<string, number> };
}

/**
 * Um lado do pódio: as famílias que mais somaram, ou as que mais tiraram,
 * na periodicidade dominante da vigência.
 *
 * Duas instâncias deste cartão dividem a faixa debaixo do gráfico. Elas leem
 * a **mesma** lista de famílias — cada uma filtrando e ordenando pelo seu
 * lado — porque o que se pergunta olhando para cá são duas perguntas
 * distintas ("onde eu ganhei" e "onde eu perdi") e uma fila única, ordenada
 * por movimento, obrigava a lê-las misturadas.
 *
 * A escala da barra é a do próprio cartão: a maior linha dele enche a barra,
 * e as outras se medem contra ela. Uma escala compartilhada entre os dois
 * cartões deixaria o lado menor com cinco fiapos ilegíveis, e a comparação
 * entre os dois lados já está feita, com rigor, no gráfico logo acima.
 *
 * O número grande é o do lado; o líquido da família vai embaixo, menor —
 * a família que aparece nos dois cartões é a mesma, e é o líquido que diz o
 * que sobrou dela no fim.
 */
export function MaioresImpactos({
  lado,
  familias,
  periodicidade,
  familiaAberta,
  onAbrirFamilia,
}: {
  lado: Lado;
  /** O pódio inteiro, já na periodicidade escolhida — o cartão recorta o seu lado. */
  familias: ImpactoDeFamilia[];
  periodicidade: string;
  /** A família cuja gaveta está aberta, para a linha ficar marcada atrás dela. */
  familiaAberta: string | null;
  /**
   * `null` quando não há gaveta a abrir — a mesma ressalva da ponte do Impacto
   * Apurado: a Visão Geral soma unidades e não tem a quem perguntar de onde
   * vem o número. Sem destino, a linha deixa de ser botão em vez de virar um
   * botão que não leva a lugar nenhum.
   */
  onAbrirFamilia: ((code: string) => void) | null;
}) {
  const ganho = lado === "ganhos";

  // Ordenado pelo módulo do próprio lado, e não pelo líquido: este cartão
  // responde "quanto entrou/saiu aqui", que é uma parcela, não a subtração.
  const doLado = familias
    .filter((f) => (ganho ? f.ganhos > 0 : f.perdas < 0))
    .sort((a, b) => Math.abs(ganho ? b.ganhos : b.perdas) - Math.abs(ganho ? a.ganhos : a.perdas))
    .slice(0, 5);

  const teto = doLado.reduce((maior, f) => Math.max(maior, Math.abs(ganho ? f.ganhos : f.perdas)), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5 flex flex-col h-full")}>
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-bold">
          Maiores impactos {ganho ? "positivos" : "negativos"} desta vigência
        </h2>
        {doLado.length > 0 && (
          <span className="text-xs font-semibold text-muted-foreground">
            em R${periodicitySuffix(periodicidade)}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {ganho
          ? "Por família da remuneração — o que somou em cada uma, com o líquido dela embaixo. Até cinco, pelas que mais somaram."
          : "Por família da remuneração — o que tirou em cada uma, com o líquido dela embaixo. Até cinco, pelas que mais tiraram."}
        {onAbrirFamilia && " Clique para ver de onde vem."}
      </p>

      {doLado.length > 0 ? (
        <ol className="space-y-3 flex-1">
          {doLado.map((familia, indice) => {
            const valor = ganho ? familia.ganhos : familia.perdas;
            /*
              As alterações **deste lado**, e não as da família inteira.

              `ImpactoDeFamilia.alteracoes` conta os dois lados juntos, que era
              o número certo quando o pódio era uma lista só. Partido em dois
              cartões ele vira uma afirmação falsa: a mesma família aparece nos
              dois, e repetir "59 alterações" em cada um diria que 118
              alterações somaram e tiraram nesta vigência. Somadas as duas
              contagens de agora, dá exatamente `familia.alteracoes`.
            */
            const doLadoContagem = familia.parametros[lado].reduce((n, l) => n + l.changes, 0);
            return (
              <li key={familia.code}>
                <Linha
                  onAbrir={onAbrirFamilia ? () => onAbrirFamilia(familia.code) : null}
                  nome={familia.name}
                  aberta={familiaAberta === familia.code}
                >
                  <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                    {indice + 1}
                  </span>
                  <span className="w-32 shrink-0 min-w-0">
                    <span
                      className="block text-sm font-semibold truncate group-hover:underline"
                      title={familia.name}
                    >
                      {familia.name}
                    </span>
                    <span className="block text-[0.6875rem] text-muted-foreground truncate">
                      {doLadoContagem.toLocaleString("pt-BR")}{" "}
                      {doLadoContagem === 1 ? "alteração" : "alterações"}{" "}
                      {ganho ? "somaram" : "tiraram"}
                    </span>
                  </span>
                  <BarraDoLado valor={valor} teto={teto} ganho={ganho} />
                  <span className="w-28 shrink-0 text-right">
                    <span
                      className={cn(
                        "block text-xs font-bold tabular-nums",
                        ganho ? "text-emerald-700" : "text-red-700",
                      )}
                    >
                      {escreverImpacto({ periodicity: periodicidade, amount: valor })}
                    </span>
                    {/*
                      O líquido embaixo, e não no lugar do lado.

                      A mesma família costuma aparecer nos dois cartões, e o
                      número grande de cada um é só a sua parcela: sem o líquido
                      aqui, a família que somou R$ 40 mil e tirou R$ 39 mil se
                      leria como dois acontecimentos enormes e independentes.
                    */}
                    <span className="block text-[0.6875rem] tabular-nums leading-tight text-muted-foreground">
                      líquido {formatBrlShort(familia.liquido)}
                    </span>
                  </span>
                  {onAbrirFamilia && (
                    <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-40 group-hover:opacity-100 transition-opacity" />
                  )}
                </Linha>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground flex-1">
          {ganho
            ? "Nenhuma família somou dinheiro nesta vigência."
            : "Nenhuma família tirou dinheiro nesta vigência."}
        </p>
      )}
    </section>
  );
}

/**
 * O invólucro de uma linha do pódio — botão quando há gaveta, linha quando não.
 *
 * A linha inteira é o alvo, e não uma seta no fim dela — a mesma régua do pódio
 * do Resumo executivo: o que se quer clicar aqui é o número, e um alvo de 16
 * pixels na borda direita obrigaria a mirar para fazer a pergunta mais óbvia da
 * tela.
 *
 * Sem destino ela deixa de ser `<button>` de propósito. Um botão desabilitado
 * ainda é um botão para quem navega por teclado ou leitor de tela — pararia o
 * foco cinco vezes por cartão em algo que nunca vai responder —, e um botão
 * habilitado sem `onClick` promete uma navegação que não existe.
 */
function Linha({
  onAbrir,
  nome,
  aberta,
  children,
}: {
  onAbrir: (() => void) | null;
  nome: string;
  aberta: boolean;
  children: ReactNode;
}) {
  const forma = "w-full flex items-center gap-3 text-left rounded-lg px-2 -mx-2 py-1.5 -my-1.5";
  if (!onAbrir) return <div className={forma}>{children}</div>;
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={`De onde vem o impacto de ${nome}`}
      aria-expanded={aberta}
      className={cn(
        forma,
        "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand transition-colors group",
        aberta && "bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}

/**
 * O pódio quando nada tem preço apurado — a faixa inteira, por quantidade.
 *
 * Sem impacto em lugar nenhum não há dois lados a separar, e dois cartões
 * vazios lado a lado diriam duas vezes o mesmo nada. A família sem preço
 * ainda tem o que dizer: quantas alterações ela concentrou.
 */
export function MaioresImpactosPorQuantidade({ familias }: { familias: FamiliaNoPodio[] }) {
  const porQuantidade = [...familias]
    .filter((f) => f.changes > 0)
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 5);
  const teto = porQuantidade.reduce((maior, f) => Math.max(maior, f.changes), 0);

  return (
    <section className={cn(CARTAO, "px-6 py-5")}>
      <h2 className="text-base font-bold mb-1">Maiores impactos desta vigência</h2>
      <p className="text-xs text-muted-foreground mb-4">
        Nenhuma alteração desta vigência tem preço apurado — o pódio vai por quantidade de
        alterações, pela família que mais concentrou.
      </p>
      {porQuantidade.length > 0 ? (
        <ol className="space-y-3.5">
          {porQuantidade.map((familia, indice) => (
            <li key={familia.code} className="flex items-center gap-3">
              <span className="w-5 shrink-0 text-xs font-bold text-muted-foreground tabular-nums">
                {indice + 1}
              </span>
              <span className="w-32 shrink-0 min-w-0 text-sm font-semibold truncate" title={familia.name}>
                {familia.name}
              </span>
              <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
                <span
                  className="block h-full bg-brand"
                  style={{
                    width: `${teto === 0 ? 0 : Math.max(2, (familia.changes / teto) * 100)}%`,
                  }}
                />
              </span>
              <span className="text-xs font-bold tabular-nums w-24 text-right">
                {familia.changes} {familia.changes === 1 ? "alteração" : "alterações"}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma família registrou alteração nesta vigência.
        </p>
      )}
    </section>
  );
}

/**
 * A barra de uma linha do pódio — um lado só, na escala do seu cartão.
 *
 * O comprimento mede o valor daquele lado contra a maior linha do mesmo
 * cartão, e a cor é a do lado: verde no cartão do que somou, vermelha no do
 * que tirou. Cada cartão faz uma pergunta só, e a barra bicolor de antes —
 * que dividia movimento entre ganho e perda — respondia às duas de uma vez,
 * o que era exatamente o que empurrava as duas leituras para a mesma fila.
 *
 * A linha de topo enche a barra; a comparação rigorosa entre os dois lados
 * continua no gráfico logo acima, que os desenha na mesma escala.
 */
function BarraDoLado({ valor, teto, ganho }: { valor: number; teto: number; ganho: boolean }) {
  const largura = teto === 0 ? 0 : Math.max(2, (Math.abs(valor) / teto) * 100);
  return (
    <span className="flex-1 h-3 bg-muted overflow-hidden min-w-8 rounded-sm">
      <span
        className={cn("block h-full", ganho ? "bg-emerald-600" : "bg-red-600")}
        style={{ width: `${largura}%` }}
      />
    </span>
  );
}
