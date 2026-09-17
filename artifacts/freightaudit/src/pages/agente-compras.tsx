import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";
import {
  Bot,
  Loader2,
  SendHorizontal,
  ShoppingCart,
  Sparkles,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/assistente/markdown";
import { fetchJson } from "@/lib/api";
import { formatBrl, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Catalogo, ProdutoDeCompra } from "@/components/compras/tipos";
import { Indicadores } from "@/components/agente-compras/indicadores";
import { NovaCotacao } from "@/components/agente-compras/nova-cotacao";
import {
  Atalhos,
  CartaoDaAnalise,
  CartaoDaAvaliacao,
} from "@/components/agente-compras/cartao-da-analise";
import { CartaoDoMercado } from "@/components/agente-compras/cartao-do-mercado";
import {
  COR_DO_VEREDITO,
  ROTULO_DA_SITUACAO,
  ROTULO_DO_VEREDITO,
  type Capacidades,
  type LinhaDaCarteira,
  type PanoramaDeCompras,
  type RespostaDoAgente,
  type Turno,
} from "@/components/agente-compras/tipos";

/**
 * AGENTE DE COMPRAS — transforme remuneração em poder de negociação.
 *
 * Em **Inteligência**, ao lado do Assistente IA, e deliberadamente **não** como
 * um módulo operacional à parte: o que este agente faz é interpretar o acervo
 * que o resto do produto apura. Ele não tem dado próprio além da cotação que
 * quem compra registra aqui.
 *
 * ---------------------------------------------------------------------------
 * O que esta tela é, e por que não é o Assistente com outro nome
 * ---------------------------------------------------------------------------
 *
 * O Assistente responde sobre o modelo de remuneração: o que mudou, quanto
 * custou, o que a regra diz. Este responde **uma** pergunta, e ela tem uma
 * conta atrás: *quanto eu deveria pagar por isso para preservar a rentabilidade
 * da operação?*
 *
 * Por isso a entrada é outra. O Assistente abre num campo de conversa; este
 * abre no **placar da carteira** — economia potencial, compras acima do teto,
 * maior oportunidade — porque quem chega aqui já tem um pedido na mesa e
 * precisa saber por onde começar antes de formular a pergunta. O campo vem logo
 * abaixo, com seis entradas prontas.
 *
 * ---------------------------------------------------------------------------
 * O sistema calcula; a IA interpreta
 * ---------------------------------------------------------------------------
 *
 * Nenhum preço desta tela sai de raciocínio de modelo. Preço-alvo e teto são
 * calculados por um motor determinístico sobre a remuneração que o acervo
 * devolveu (`lib/compras/src/motor.ts`); o modelo entra depois, só para
 * redigir, e o texto dele é descartado inteiro se citar um real que a análise
 * não sustente. O cartão ao lado de cada resposta é a mesma conta em forma de
 * tabela: é ele que responde "de onde saiu esse número?" sem exigir uma segunda
 * pergunta.
 *
 * O selo do rodapé de cada resposta diz qual dos dois escreveu o que está sendo
 * lido — quem leva um preço-alvo para a mesa merece saber se um modelo
 * participou da redação.
 */

const CHAMADA = "O que você quer analisar ou comprar?";

export default function AgenteDeCompras() {
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const cliente = useQueryClient();

  /* O contexto viaja na URL, como no resto do produto — ver `remunerado.tsx`. */
  const contexto = useMemo(() => {
    const q = new URLSearchParams();
    for (const chave of ["period", "scopeHash", "canal", "operacao"]) {
      const valor = params.get(chave);
      if (valor) q.set(chave, valor);
    }
    const texto = q.toString();
    return texto === "" ? "" : `?${texto}`;
  }, [params]);

  const capacidades = useQuery<Capacidades>({
    queryKey: ["agente-compras", "capacidades"],
    queryFn: () => fetchJson<Capacidades>("/agente-compras/capacidades"),
  });

  const panorama = useQuery<PanoramaDeCompras>({
    queryKey: ["agente-compras", "panorama", contexto],
    queryFn: () =>
      fetchJson<PanoramaDeCompras>(`/agente-compras/panorama${contexto}`),
  });

  const catalogo = useQuery<Catalogo>({
    queryKey: ["compras", "catalogo"],
    queryFn: () => fetchJson<Catalogo>("/compras/catalogo"),
  });

  const [pergunta, setPergunta] = useState("");
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const comprasQueRespondem: ProdutoDeCompra[] = useMemo(
    () =>
      (catalogo.data?.produtos ?? []).filter(
        (p) => p.balcao !== "QLP_OPERACIONAL",
      ),
    [catalogo.data],
  );

  async function perguntar(texto: string) {
    const limpa = texto.trim();
    if (limpa === "" || pensando) return;

    setErro(null);
    setPergunta("");
    setTurnos((atuais) => [...atuais, { papel: "PERGUNTA", texto: limpa }]);
    setPensando(true);

    try {
      const resposta = await fetchJson<RespostaDoAgente>(
        `/agente-compras/perguntar${contexto}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pergunta: limpa,
            /*
              O histórico vem da tela, e não do banco: esta superfície não guarda
              conversa. A unidade de trabalho aqui é a decisão de compra, e ela
              é gravada onde importa — na cotação. Ver `routes/agente-compras.ts`.
            */
            historico: turnos
              .slice(-8)
              .map((t) => ({ papel: t.papel, texto: t.texto })),
          }),
        },
      );
      setTurnos((atuais) => [
        ...atuais,
        { papel: "RESPOSTA", texto: resposta.texto, resposta },
      ]);
    } catch (err) {
      setErro(
        err instanceof Error
          ? err.message
          : "O Agente de Compras não respondeu.",
      );
    } finally {
      setPensando(false);
    }
  }

  const abriu = turnos.length === 0;

  return (
    <Layout>
      <CabecalhoDePagina
        titulo="Agente de Compras"
        icone={ShoppingCart}
        descricao="Transforme remuneração em poder de negociação."
        largura="1400px"
        contexto={
          capacidades.data
            ? capacidades.data.ia
              ? `${capacidades.data.mercado ? "Pesquisa de mercado e redação por modelo" : "Redação por modelo"} · meta ${formatPercent(capacidades.data.politica.margemAlvo * 100)} · teto ${formatPercent(capacidades.data.politica.margemMinima * 100)}`
              : "Redação em código, sem pesquisa de mercado — nenhuma chave de modelo configurada"
            : undefined
        }
      />

      <div className="max-w-[1400px] mx-auto px-8 pt-4 pb-16 space-y-6">
        {panorama.error && (
          <ApiErrorNotice error={panorama.error} what="o panorama de compras" />
        )}

        {/* ---- a visão executiva ------------------------------------------ */}
        {panorama.data && (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Visão executiva
              </h2>
              <p className="text-xs text-muted-foreground">
                {panorama.data.vigencia
                  ? `Vigência ${panorama.data.vigencia} · ${panorama.data.cotacoes} cotação(ões) registrada(s)`
                  : `${panorama.data.cotacoes} cotação(ões) registrada(s)`}
              </p>
            </div>
            <Indicadores indicadores={panorama.data.indicadores} />
          </section>
        )}

        {/* ---- a conversa -------------------------------------------------- */}
        <section className="space-y-4">
          {abriu ? (
            <div className="superficie p-6 space-y-4">
              <div className="flex items-center gap-2 text-brand">
                <Sparkles className="w-4 h-4" />
                <h2 className="font-bold">{CHAMADA}</h2>
              </div>
              <p className="text-sm text-muted-foreground max-w-2xl">
                Pergunte em português. Diga o item, e — se já tiver — o preço da
                proposta e a quantidade:{" "}
                <em>
                  “quanto posso pagar nesse pneu? a proposta é R$ 3.080 para 80
                  unidades”
                </em>
                . O preço-alvo sai calculado sobre a remuneração da vigência,
                com a conta aberta ao lado.
              </p>
              <Composer
                valor={pergunta}
                aoMudar={setPergunta}
                aoEnviar={() => perguntar(pergunta)}
                pensando={pensando}
                campo={campo}
              />
              <div className="flex flex-wrap gap-2">
                {(capacidades.data?.sugestoes ?? []).map((s) => (
                  <button
                    key={s.rotulo}
                    type="button"
                    onClick={() => perguntar(s.exemplo)}
                    className="text-xs font-medium px-3 py-1.5 rounded-full border bg-card hover:bg-muted transition-colors"
                    title={s.exemplo}
                  >
                    {s.rotulo}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {turnos.map((turno, i) =>
                turno.papel === "PERGUNTA" ? (
                  <div key={i} className="flex justify-end">
                    <p className="bg-brand text-brand-foreground rounded-2xl rounded-br-sm px-4 py-2.5 text-sm max-w-[42rem]">
                      {turno.texto}
                    </p>
                  </div>
                ) : (
                  <Resposta key={i} turno={turno} />
                ),
              )}

              {pensando && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Consultando a remuneração da vigência e calculando o
                  preço-alvo…
                </p>
              )}

              <Composer
                valor={pergunta}
                aoMudar={setPergunta}
                aoEnviar={() => perguntar(pergunta)}
                pensando={pensando}
                campo={campo}
              />
            </div>
          )}

          {erro && <p className="text-sm text-rose-600">{erro}</p>}
        </section>

        {/* ---- a carteira e o registro de propostas ------------------------ */}
        <section className="grid gap-4 lg:grid-cols-[1fr_22rem] items-start">
          <Carteira linhas={panorama.data?.linhas ?? []} />
          {comprasQueRespondem.length > 0 && (
            <NovaCotacao
              produtos={comprasQueRespondem}
              itemInicial={params.get("item")}
              contexto={contexto}
              aoRegistrar={() => {
                /*
                  Invalidar em vez de inserir na lista: o painel é derivado da
                  carteira inteira pelo motor econômico, e recalcular no
                  navegador seria a segunda conta que esta tela existe para não
                  ter. Ver `panorama.ts`.
                */
                void cliente.invalidateQueries({
                  queryKey: ["agente-compras", "panorama", contexto],
                });
              }}
            />
          )}
        </section>
      </div>
    </Layout>
  );
}

/**
 * O campo, e a tecla que envia.
 *
 * Enter envia e Shift+Enter quebra linha — a convenção do Assistente, e mudá-la
 * aqui faria duas telas de conversa do mesmo produto responderem à mesma tecla
 * de jeitos diferentes.
 */
function Composer({
  valor,
  aoMudar,
  aoEnviar,
  pensando,
  campo,
}: {
  valor: string;
  aoMudar: (v: string) => void;
  aoEnviar: () => void;
  pensando: boolean;
  campo: React.RefObject<HTMLTextAreaElement | null>;
}) {
  return (
    <div className="flex items-end gap-2">
      <textarea
        ref={campo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            aoEnviar();
          }
        }}
        rows={2}
        placeholder={CHAMADA}
        className="flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand/30"
      />
      <Button
        onClick={aoEnviar}
        disabled={pensando || valor.trim() === ""}
        size="icon"
      >
        {pensando ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <SendHorizontal className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

/**
 * Uma resposta: o texto, a conta ao lado, os caminhos até a origem, e o selo.
 *
 * O selo não é enfeite de rodapé. Ele diz se o que acabou de ser lido foi
 * escrito por um modelo ou montado em código — e, quando a redação do modelo foi
 * descartada, por quê. Numa tela que produz preço para negociação, essa é a
 * primeira coisa que alguém pergunta ao discordar do texto.
 */
function Resposta({ turno }: { turno: Turno }) {
  const resposta = turno.resposta;

  return (
    <article className="space-y-3">
      <div className="flex gap-3">
        <span className="w-8 h-8 rounded-full bg-brand/10 text-brand flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <Markdown texto={turno.texto} />

          {resposta?.pesquisa && (
            <CartaoDoMercado pesquisa={resposta.pesquisa} />
          )}

          {resposta?.analise && <CartaoDaAnalise analise={resposta.analise} />}

          {resposta && !resposta.analise && resposta.carteira.length > 0 && (
            <div className="space-y-3">
              {resposta.carteira
                .filter((l) => l.melhor !== null)
                .slice(0, 4)
                .map((linha) => (
                  <CartaoDaAvaliacao
                    key={linha.produto.chave}
                    avaliacao={linha.melhor!.avaliacao}
                    titulo={`${linha.produto.rotulo} — ${linha.melhor!.cotacao.fornecedor}`}
                  />
                ))}
              <Atalhos atalhos={resposta.atalhos} />
            </div>
          )}

          {resposta && (
            <p className="text-[0.6875rem] text-muted-foreground">
              {resposta.rotuloDaIntencao} ·{" "}
              {resposta.redacao === "IA"
                ? "redigido por modelo sobre a análise fechada"
                : "redigido em código, sobre o mesmo material"}
              {resposta.porqueDeterministica
                ? ` — ${resposta.porqueDeterministica}`
                : ""}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

/** A carteira: um item por linha, ordenada pelo que mais pesa. */
function Carteira({ linhas }: { linhas: LinhaDaCarteira[] }) {
  if (linhas.length === 0) {
    return (
      <div className="superficie p-6 text-sm text-muted-foreground">
        <h3 className="font-bold text-foreground text-sm mb-2">
          Carteira de compras
        </h3>
        Nenhuma cotação viva registrada. O FreightCheck importa o modelo de
        remuneração da Ambev, não as notas de compra: registre uma proposta ao
        lado e o painel passa a responder sobre ela.
      </div>
    );
  }

  return (
    <div className="superficie overflow-hidden">
      <h3 className="font-bold text-sm px-4 pt-4 pb-2">Carteira de compras</h3>
      <table className="w-full text-sm">
        <thead className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="text-left font-semibold px-4 py-2">Item</th>
            <th className="text-left font-semibold px-4 py-2">Fornecedor</th>
            <th className="text-right font-semibold px-4 py-2">Proposta</th>
            <th className="text-right font-semibold px-4 py-2">Alvo</th>
            <th className="text-right font-semibold px-4 py-2">Teto</th>
            <th className="text-right font-semibold px-4 py-2">No pedido</th>
            <th className="text-left font-semibold px-4 py-2">Situação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => {
            const melhor = linha.melhor;
            const a = melhor?.avaliacao;
            return (
              <tr key={linha.produto.chave} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">
                  {linha.produto.rotulo}
                </td>
                <td className="px-4 py-2">
                  {melhor?.cotacao.fornecedor ?? "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {melhor ? formatBrl(melhor.cotacao.precoUnitario) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {a?.precoAlvo != null ? formatBrl(a.precoAlvo) : "—"}
                </td>
                <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">
                  {a?.precoTeto != null ? formatBrl(a.precoTeto) : "—"}
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right tabular-nums whitespace-nowrap",
                    a?.impactoPelaQuantidade != null &&
                      a.impactoPelaQuantidade > 0
                      ? "text-rose-600"
                      : undefined,
                  )}
                >
                  {a?.impactoPelaQuantidade != null
                    ? formatBrl(a.impactoPelaQuantidade)
                    : "—"}
                </td>
                <td className="px-4 py-2 whitespace-nowrap">
                  <span className="text-xs">
                    {melhor ? ROTULO_DA_SITUACAO[melhor.cotacao.situacao] : "—"}
                  </span>
                  {a?.veredito && (
                    <span
                      className={cn(
                        "ml-2 text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full border",
                        COR_DO_VEREDITO[a.veredito],
                      )}
                    >
                      {ROTULO_DO_VEREDITO[a.veredito]}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
