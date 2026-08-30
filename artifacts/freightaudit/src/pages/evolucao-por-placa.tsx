import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { History, LayoutDashboard, Layers } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { AbaBotao } from "@/components/changes/cartoes";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";
import { cn } from "@/lib/utils";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { DASHBOARD, EVOLUCAO_POR_PLACA, LINHA_DO_TEMPO } from "@/lib/ambiente";
import { useContextosDaCasca } from "@/lib/contextos";
import { contracaoDoTipo, equipamentosDoAmbiente, palavrasDoTipo, rotuloDoTipo } from "@/lib/frota";
import { ehTipoDaLinhaDoTempo, type TipoDaLinhaDoTempo } from "@workspace/comparison/tipos";
import { periodicityAdjective } from "@/lib/format";
import {
  ehFiltroDaEvolucao,
  ehOrdemDaEvolucao,
  opcoesDaEvolucao,
  type FiltroDaEvolucao,
  type InsightDaEvolucao,
  type OrdemDaEvolucao,
} from "@/lib/evolucao-por-placa";
import { AtencaoDaEvolucao, CartoesDaEvolucao } from "@/components/evolucao-por-placa/cartoes";
import { MatrizDaEvolucao } from "@/components/evolucao-por-placa/matriz";
import { PainelDaPlaca } from "@/components/evolucao-por-placa/painel-da-placa";
import {
  DistribuicaoDoImpacto,
  RankingDeAtencao,
  RubricasAlteradas,
} from "@/components/evolucao-por-placa/ranking";

/**
 * Evolução por Placa — o histórico lido pelo ativo.
 *
 * O Dashboard responde "o que aconteceu nesta vigência?" e a Linha do Tempo
 * responde "como o impacto se moveu vigência a vigência?". Nenhuma das duas
 * responde a pergunta que traz alguém aqui: **quais placas estão sendo
 * afetadas ao longo do tempo, e quais eu preciso investigar hoje?** A unidade
 * de análise passa a ser o ativo, e o eixo do tempo vira o fundo.
 *
 * A tela é a mesma leitura de intervalo das outras duas — `?from`/`?to`,
 * unidade e canal no endereço, e o servidor recortando —, e é por isso que os
 * números batem quando o escopo é o mesmo. Trocar de tela troca o eixo, nunca a
 * apuração.
 *
 * **A ordem da página é a ordem das perguntas**, e ela vale igual no celular:
 * quanto disto é meu problema (os cinco cartões), o que merece atenção (o bloco
 * de insights), quais placas (o ranking, que no celular vem antes da matriz), a
 * história de cada uma (a matriz e o painel), e o que explica tudo isso (as
 * rubricas). No desktop a matriz sobe para o lugar de honra; no telefone ela
 * desce para depois do ranking, porque ninguém descobre uma placa rolando uma
 * grade de oito colunas com o polegar.
 */
export default function EvolucaoPorPlacaPage() {
  const ambiente = useAmbiente();
  const search = useSearch();
  const [, navegar] = useLocation();
  const parametros = new URLSearchParams(search);
  const contextos = useContextosDaCasca();

  const consulta = new URLSearchParams();
  for (const chave of ["scopeHash", "canal"]) {
    const valor = parametros.get(chave);
    if (valor !== null) consulta.set(chave, valor);
  }

  const equipamentos = equipamentosDoAmbiente(ambiente);
  const pedido = parametros.get("tipo");
  const tipo: TipoDaLinhaDoTempo | null =
    pedido !== null &&
    ehTipoDaLinhaDoTempo(pedido) &&
    (equipamentos as readonly string[]).includes(pedido)
      ? pedido
      : null;

  const de = parametros.get("from");
  const ate = parametros.get("to");
  const periodicidade = parametros.get("periodicidade");

  const filtro: FiltroDaEvolucao = ehFiltroDaEvolucao(parametros.get("filtro"))
    ? (parametros.get("filtro") as FiltroDaEvolucao)
    : "todos";
  const ordem: OrdemDaEvolucao = ehOrdemDaEvolucao(parametros.get("ordem"))
    ? (parametros.get("ordem") as OrdemDaEvolucao)
    : "prioridade";
  const busca = parametros.get("busca") ?? "";
  const placaAberta = parametros.get("placa");

  const consultaDaEvolucao = useQuery(
    opcoesDaEvolucao(consulta, de, ate, tipo, periodicidade),
  );
  const evolucao = consultaDaEvolucao.data ?? null;

  /*
    O insight escolhido vive na tela, e não no endereço: ele é um recorte de
    leitura ("me mostre estas doze placas"), e o conjunto que o define vem da
    resposta — guardá-lo na URL exigiria escrever doze identificadores num link
    que envelheceria na próxima importação.
  */
  const [insight, setInsight] = useState<InsightDaEvolucao | null>(null);
  const recorte = useMemo(
    () =>
      insight && evolucao?.insights.some((i) => i.chave === insight.chave)
        ? insight
        : null,
    [insight, evolucao],
  );

  const aberta = useMemo(
    () => evolucao?.ativos.find((a) => a.entityId === placaAberta) ?? null,
    [evolucao, placaAberta],
  );

  const trocarPara = (mudancas: Record<string, string | null>) => {
    const proxima = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") proxima.delete(chave);
      else proxima.set(chave, valor);
    }
    const texto = proxima.toString();
    navegar(texto ? `${EVOLUCAO_POR_PLACA}?${texto}` : EVOLUCAO_POR_PLACA);
  };

  const unidade = evolucao?.context.label.split(" · ")[0] ?? contextos.contextos[0]?.label ?? "";

  return (
    <Layout>
      <header className="px-8 pt-7 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-4 max-w-[1600px]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[2rem] font-extrabold tracking-tight leading-tight">
                Evolução por Placa
              </h1>
              <EmAtualizacao ativo={consultaDaEvolucao.isPlaceholderData} />
            </div>
            <p className="text-sm text-muted-foreground mt-1.5">
              Acompanhe como a remuneração de cada ativo evoluiu ao longo do tempo.
            </p>
            {evolucao && (
              <p className="text-sm text-muted-foreground mt-1">
                {[
                  unidade,
                  evolucao.context.channel,
                  tipo ? rotuloDoTipo(tipo) : null,
                  `${evolucao.colunas.length} ${evolucao.colunas.length === 1 ? "vigência comparada" : "vigências comparadas"}`,
                  `valores em ${periodicityAdjective(evolucao.periodicidade)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </div>

          {/* ---- as outras visões do mesmo histórico ------------------------ */}
          <nav className="flex items-center gap-2 shrink-0">
            <Link
              href={`${DASHBOARD}${consulta.toString() ? `?${consulta}` : ""}`}
              className={ATALHO}
            >
              <LayoutDashboard className="w-4 h-4" />
              Visão geral
            </Link>
            <Link
              href={`${LINHA_DO_TEMPO}${consulta.toString() ? `?${consulta}` : ""}`}
              className={ATALHO}
            >
              <History className="w-4 h-4" />
              Por vigência
            </Link>
          </nav>
        </div>
      </header>

      {/* ---- abas por tipo de ativo, como na Linha do Tempo ----------------- */}
      <div className="px-8 border-b">
        <nav className="flex flex-wrap items-center gap-1 max-w-[1600px]" role="tablist">
          <AbaBotao
            active={tipo === null}
            onClick={() => trocarPara({ tipo: null, placa: null })}
            icon={<Layers className="w-4 h-4" />}
            label="Geral"
            hint="a frota inteira, sem separar por tipo"
          />
          {equipamentos.map((codigo) => (
            <AbaBotao
              key={codigo}
              active={codigo === tipo}
              onClick={() => trocarPara({ tipo: codigo, placa: null })}
              label={rotuloDoTipo(codigo)}
              hint={`as mesmas placas, só ${contracaoDoTipo(codigo, "de")} ${palavrasDoTipo(codigo).plural}`}
            />
          ))}
        </nav>
      </div>

      <div className="px-8 py-6 space-y-5 max-w-[1600px]">
        {consultaDaEvolucao.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando as placas…</p>
        )}
        {consultaDaEvolucao.error && (
          <ApiErrorNotice
            error={consultaDaEvolucao.error}
            what="Não foi possível montar a evolução por placa."
          />
        )}
        {!consultaDaEvolucao.isLoading && !consultaDaEvolucao.error && evolucao === null && (
          <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
            Nenhuma vigência importada ainda para este recorte.
          </section>
        )}

        {evolucao && evolucao.colunas.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm p-8 text-center text-sm text-muted-foreground">
            Este recorte não tem nenhuma comparação calculada — a evolução por placa
            compara vigência com vigência, e ainda não há com o que comparar.
          </section>
        )}

        {evolucao && evolucao.colunas.length > 0 && (
          <div
            className={cn(
              "space-y-5",
              classeDeAtualizacao(consultaDaEvolucao.isPlaceholderData),
            )}
          >
            {/* ---- o período e a grandeza ------------------------------------ */}
            <div className="flex flex-wrap items-end gap-3">
              <Seletor
                rotulo="De"
                valor={evolucao.from}
                opcoes={evolucao.periods}
                onTrocar={(valor) => trocarPara({ from: valor, placa: null })}
              />
              <Seletor
                rotulo="Até"
                valor={evolucao.to}
                opcoes={evolucao.periods}
                onTrocar={(valor) => trocarPara({ to: valor, placa: null })}
              />
              {evolucao.periodicidades.length > 1 && (
                <div>
                  <label
                    className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground"
                    htmlFor="periodicidade-da-evolucao"
                  >
                    Grandeza
                  </label>
                  <select
                    id="periodicidade-da-evolucao"
                    value={evolucao.periodicidade}
                    onChange={(e) => trocarPara({ periodicidade: e.target.value })}
                    className="mt-1 h-9 rounded-lg border bg-background px-2 text-sm"
                    title="R$/mês e R$/ano nunca são somados. A matriz inteira é desenhada numa grandeza de cada vez."
                  >
                    {evolucao.periodicidades.map((p) => (
                      <option key={p.periodicity} value={p.periodicity}>
                        {periodicityAdjective(p.periodicity)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="text-xs text-muted-foreground pb-2">
                A ponta “De” é o ponto de partida da comparação: ela não é somada, e por
                isso não vira coluna.
              </p>
            </div>

            <CartoesDaEvolucao evolucao={evolucao} />

            <AtencaoDaEvolucao
              insights={evolucao.insights}
              ativo={recorte?.chave ?? null}
              onEscolher={setInsight}
            />

            {/* ---- no celular, o ranking vem antes da matriz ----------------- */}
            <div className="lg:hidden">
              <RankingDeAtencao
                evolucao={evolucao}
                selecionada={placaAberta}
                onEscolherPlaca={(entityId) => trocarPara({ placa: entityId })}
              />
            </div>

            {/*
              Sem placa escolhida, a matriz ocupa a largura inteira.

              A coluna de 22rem reservada para o painel custava duas vigências
              de largura na matriz — e reservá-la para um convite de três linhas
              é pagar o componente mais importante da tela pelo menos importante.
              Escolhida uma placa, a grade abre em duas colunas e a matriz aperta
              o necessário.
            */}
            <div
              className={cn(
                "grid gap-5",
                aberta && "lg:grid-cols-[minmax(0,1fr)_22rem]",
              )}
            >
              <MatrizDaEvolucao
                evolucao={evolucao}
                filtro={filtro}
                ordem={ordem}
                busca={busca}
                insight={recorte}
                selecionada={placaAberta}
                onFiltro={(valor) => trocarPara({ filtro: valor === "todos" ? null : valor })}
                onOrdem={(valor) =>
                  trocarPara({ ordem: valor === "prioridade" ? null : valor })
                }
                onBusca={(valor) => trocarPara({ busca: valor })}
                onLimparInsight={() => setInsight(null)}
                onEscolherPlaca={(entityId) =>
                  trocarPara({ placa: entityId === placaAberta ? null : entityId })
                }
              />

              {aberta && (
                <PainelDaPlaca
                  ativo={aberta}
                  evolucao={evolucao}
                  onFechar={() => trocarPara({ placa: null })}
                />
              )}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="hidden lg:block">
                <RankingDeAtencao
                  evolucao={evolucao}
                  selecionada={placaAberta}
                  onEscolherPlaca={(entityId) => trocarPara({ placa: entityId })}
                />
              </div>
              <div className="space-y-5">
                <DistribuicaoDoImpacto evolucao={evolucao} />
                <RubricasAlteradas
                  rubricas={aberta ? aberta.rubricas : evolucao.rubricas}
                  periodicidade={evolucao.periodicidade}
                  placa={aberta}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

const ATALHO =
  "inline-flex items-center gap-2 rounded-lg border border-brand bg-card px-3 py-2 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";

function Seletor({
  rotulo,
  valor,
  opcoes,
  onTrocar,
}: {
  rotulo: string;
  valor: string;
  opcoes: { date: string; label: string }[];
  onTrocar: (valor: string) => void;
}) {
  const id = `evolucao-${rotulo.toLowerCase()}`;
  return (
    <div>
      <label
        className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground"
        htmlFor={id}
      >
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => onTrocar(e.target.value)}
        className="mt-1 h-9 rounded-lg border bg-background px-2 text-sm"
      >
        {[...opcoes]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((opcao) => (
            <option key={opcao.date} value={opcao.date}>
              {opcao.label}
            </option>
          ))}
      </select>
    </div>
  );
}
