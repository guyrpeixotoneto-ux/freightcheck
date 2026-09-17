import { ArrowUpRight, CircleAlert, Clock, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent } from "@/lib/format";
import {
  COR_DO_MATCH,
  ROTULO_DA_CONFIANCA_DE_MERCADO,
  ROTULO_DO_FRESCOR,
  ROTULO_DO_MATCH,
  temFaixa,
  type OfertaAnalisada,
  type PesquisaDeMercado,
} from "./tipos";

/**
 * A pesquisa de mercado, ao lado do texto — e com a fonte de cada preço.
 *
 * O cartão responde, em ordem, às perguntas de quem está negociando: quanto o
 * mercado cobra, qual o melhor custo **comparável**, qual a faixa-alvo, quanto
 * se economiza e quanto sobra da remuneração. Abaixo disso, as cotações uma a
 * uma, cada uma com o domínio de onde saiu e a hora em que foi capturada.
 *
 * **Nenhum preço aparece aqui sem link e sem hora.** É a regra que atravessa a
 * pilha inteira: o preço só chegou até esta tela porque apareceu verbatim no
 * texto da página que a busca baixou (`mercado/verificacao.ts`), e o carimbo de
 * captura veio de quem baixou. O link é o que permite conferir em dez segundos.
 *
 * **A oferta recusada continua visível, marcada.** A mais barata costuma ser
 * justamente a que não serve — medida errada, embalagem desconhecida, captura
 * velha. Escondê-la faria a mesma pessoa reencontrá-la sozinha, meia hora
 * depois, sem saber por que ela havia sido descartada.
 */

function reais(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : formatBrl(v);
}

function Numero({
  rotulo,
  valor,
  nota,
  forte = false,
  cor,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  forte?: boolean;
  cor?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground font-semibold">
        {rotulo}
      </div>
      <div
        className={cn(
          "tabular-nums",
          forte ? "text-xl font-bold" : "text-base font-semibold",
          cor,
        )}
      >
        {valor}
      </div>
      {nota && (
        <div className="text-xs text-muted-foreground mt-0.5">{nota}</div>
      )}
    </div>
  );
}

export function CartaoDoMercado({ pesquisa }: { pesquisa: PesquisaDeMercado }) {
  const naConta = pesquisa.ofertas.filter((o) => o.entrouNaConta);
  const faixa = temFaixa(pesquisa.alvo) ? pesquisa.alvo : null;

  return (
    <div className="superficie p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="font-bold text-sm">
            Mercado — {pesquisa.especificacao.titulo}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {pesquisa.especificacao.consulta}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border bg-muted">
            Confiança{" "}
            {ROTULO_DA_CONFIANCA_DE_MERCADO[pesquisa.confianca.confianca]} ·{" "}
            {pesquisa.confianca.pontos}/100
          </span>
          <span className="text-[0.6875rem] text-muted-foreground">
            {naConta.length} de {pesquisa.ofertas.length} válidas
          </span>
        </div>
      </div>

      {pesquisa.indisponivel !== null && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3">
          <CircleAlert className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {pesquisa.indisponivel}
        </p>
      )}

      {pesquisa.leitura && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
          <Numero
            rotulo="Faixa do mercado"
            valor={`${reais(pesquisa.leitura.menor)}–${reais(pesquisa.leitura.maior)}`}
            nota="custo total comparável"
          />
          <Numero rotulo="Mediana" valor={reais(pesquisa.leitura.mediana)} />
          <Numero
            rotulo="Melhor comparável"
            valor={reais(pesquisa.melhor?.custo.custoTotal)}
            nota={pesquisa.melhor?.oferta.proveniencia.fonte}
          />
          <Numero
            rotulo="Preço-alvo"
            valor={faixa ? `${reais(faixa.piso)}–${reais(faixa.teto)}` : "—"}
            forte
            nota={faixa ? "faixa de negociação" : "sem evidência suficiente"}
          />
        </div>
      )}

      {(pesquisa.economia || pesquisa.margem) && (
        <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 pt-1 border-t">
          {pesquisa.economia && (
            <>
              <Numero
                rotulo="Economia por unidade"
                valor={reais(pesquisa.economia.economiaUnitaria)}
                cor={
                  pesquisa.economia.economiaUnitaria > 0
                    ? "text-emerald-600"
                    : undefined
                }
                nota={`contra ${reais(pesquisa.economia.precoAtual)} que se paga hoje`}
              />
              <Numero
                rotulo="Economia no pedido"
                valor={reais(pesquisa.economia.economiaTotal)}
                cor={
                  (pesquisa.economia.economiaTotal ?? 0) > 0
                    ? "text-emerald-600"
                    : undefined
                }
              />
            </>
          )}
          {pesquisa.margem && (
            <>
              <Numero
                rotulo="Margem por unidade"
                valor={reais(pesquisa.margem.margemUnitaria)}
                cor={
                  pesquisa.margem.margemUnitaria < 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }
                nota="remuneração menos o melhor custo"
              />
              <Numero
                rotulo="Margem no pedido"
                valor={reais(pesquisa.margem.margemTotal)}
                cor={
                  (pesquisa.margem.margemTotal ?? 0) < 0
                    ? "text-rose-600"
                    : "text-emerald-600"
                }
              />
            </>
          )}
        </div>
      )}

      {faixa && (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          <span className="font-semibold text-foreground">
            Como o alvo foi derivado:
          </span>{" "}
          {faixa.derivacao}
        </p>
      )}
      {!faixa && (
        <p className="text-xs text-muted-foreground pt-1 border-t">
          <span className="font-semibold text-foreground">Sem preço-alvo:</span>{" "}
          {(pesquisa.alvo as { porque: string }).porque}
        </p>
      )}

      {pesquisa.ofertas.length > 0 && (
        <div className="space-y-2 pt-1 border-t">
          <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Cotações e fontes
          </h4>
          {[...pesquisa.ofertas]
            .sort(
              (a, b) =>
                Number(b.entrouNaConta) - Number(a.entrouNaConta) ||
                (a.custo.custoTotal ?? Infinity) -
                  (b.custo.custoTotal ?? Infinity),
            )
            .map((o, i) => (
              <Oferta key={`${o.oferta.proveniencia.url}-${i}`} oferta={o} />
            ))}
        </div>
      )}

      {pesquisa.descartadas.length > 0 && (
        <div className="text-xs text-muted-foreground pt-1 border-t">
          <div className="font-semibold text-foreground mb-1">
            Descartadas na conferência de fonte
          </div>
          <ul className="space-y-1 list-disc pl-4">
            {pesquisa.descartadas.map((d, i) => (
              <li key={i}>
                <span className="break-all">{d.url}</span> —{" "}
                {d.motivo.toLowerCase().replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pesquisa.confianca.fatores.some((f) => f.penalidade > 0) && (
        <div className="text-xs text-muted-foreground pt-1 border-t">
          <div className="font-semibold text-foreground mb-1">
            O que segura a confiança
          </div>
          <ul className="space-y-1 list-disc pl-4">
            {pesquisa.confianca.fatores
              .filter((f) => f.penalidade > 0)
              .map((f) => (
                <li key={f.fator}>
                  {f.fator}: {f.observado} (−{f.penalidade})
                </li>
              ))}
          </ul>
        </div>
      )}

      {pesquisa.especificacao.lacunas.length > 0 && (
        <div className="text-xs text-muted-foreground pt-1 border-t">
          <div className="font-semibold text-foreground mb-1">
            Para a pesquisa ficar mais precisa
          </div>
          <ul className="space-y-1 list-disc pl-4">
            {pesquisa.especificacao.lacunas.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Oferta({ oferta: o }: { oferta: OfertaAnalisada }) {
  const p = o.oferta.proveniencia;
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-1.5",
        !o.entrouNaConta && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span className="font-semibold text-sm min-w-0">
          {o.oferta.fornecedor ?? p.fonte}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={cn(
              "text-[0.625rem] font-semibold px-1.5 py-0.5 rounded-full border",
              COR_DO_MATCH[o.match.classe],
            )}
          >
            {ROTULO_DO_MATCH[o.match.classe]}
          </span>
          <span className="text-[0.625rem] text-muted-foreground inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {ROTULO_DO_FRESCOR[o.frescor]}
          </span>
        </div>
      </div>

      <div className="text-sm tabular-nums">
        <span className="font-bold">
          {o.custo.custoTotal !== null ? formatBrl(o.custo.custoTotal) : "—"}
        </span>
        <span className="text-muted-foreground text-xs">
          {" "}
          /un comparável · anunciado {formatBrl(o.oferta.preco)}{" "}
          {o.oferta.unidadeDoPreco.toLowerCase()}
        </span>
      </div>

      <div className="text-xs text-muted-foreground">{o.custo.conta}</div>
      {o.oferta.produto && <div className="text-xs">{o.oferta.produto}</div>}
      {o.oferta.disponibilidade && (
        <div className="text-xs text-muted-foreground">
          {o.oferta.disponibilidade}
        </div>
      )}

      {!o.entrouNaConta && o.foraPorque && (
        <div className="text-xs text-rose-700">{o.foraPorque}</div>
      )}

      {o.fonteDuvidosa && (
        <div className="text-xs text-amber-800 inline-flex items-center gap-1">
          <ShieldAlert className="w-3.5 h-3.5" />
          Esta página tentou dar instruções ao agente — tratada como fonte
          duvidosa.
        </div>
      )}

      <a
        href={p.url}
        target="_blank"
        rel="noreferrer noopener"
        className="text-xs text-brand hover:underline inline-flex items-center gap-1 break-all"
      >
        {p.fonte}
        <ArrowUpRight className="w-3 h-3 shrink-0" />
      </a>
      <div className="text-[0.625rem] text-muted-foreground">
        Capturado em {new Date(p.capturadoEm).toLocaleString("pt-BR")}
        {p.idadeDaPagina ? ` · página declara ${p.idadeDaPagina}` : ""}
      </div>
    </div>
  );
}

/** A dispersão em palavras, para o cartão compacto. Exportada para reuso. */
export function dispersaoEmTexto(dispersao: number): string {
  return `dispersão de ${formatPercent(dispersao * 100)}`;
}
