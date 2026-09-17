import { Link } from "wouter";
import { ArrowUpRight, Check, CircleAlert, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent } from "@/lib/format";
import {
  COR_DO_VEREDITO,
  ROTULO_DA_CONFIABILIDADE,
  ROTULO_DO_VEREDITO,
  ROTULO_SEM_ALVO,
  type AnaliseDoItem,
  type Atalho,
  type AvaliacaoDeCompra,
} from "./tipos";

/**
 * A conta, ao lado do texto — e não dentro dele.
 *
 * A resposta do agente é um texto, e o texto é a resposta. Este cartão é a
 * mesma conta em forma de tabela, para quem vai conferir em vez de ler: os dois
 * preços, a diferença, a procedência de cada número e o que ficou faltando.
 *
 * **Ele existe porque a pergunta seguinte é sempre a mesma.** "De onde saiu esse
 * R$ 2.750?" — e a resposta tem de caber num olhar, não numa segunda pergunta.
 * Por isso o bloco de dados separa **confirmado** de **estimado** com ícones
 * diferentes: um preço-alvo que depende de uma vida útil chutada não pode se
 * parecer com um que saiu inteiro do export.
 */

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
      {nota && <div className="text-xs text-muted-foreground mt-0.5">{nota}</div>}
    </div>
  );
}

/** `null` vira travessão. Nunca zero — a diferença é a regra da casa. */
function reais(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

export function CartaoDaAvaliacao({
  avaliacao,
  titulo,
}: {
  avaliacao: AvaliacaoDeCompra;
  titulo: string;
}) {
  const a = avaliacao;
  const confirmados = a.dados.filter((d) => d.confirmado && d.valor !== null);
  const estimados = a.dados.filter((d) => !d.confirmado && d.valor !== null);

  return (
    <div className="superficie p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h3 className="font-bold text-sm">{titulo}</h3>
        <div className="flex items-center gap-2">
          {a.veredito && (
            <span
              className={cn(
                "text-[0.6875rem] font-semibold px-2 py-0.5 rounded-full border",
                COR_DO_VEREDITO[a.veredito],
              )}
            >
              {ROTULO_DO_VEREDITO[a.veredito]}
            </span>
          )}
          <span className="text-[0.6875rem] text-muted-foreground">
            {ROTULO_DA_CONFIABILIDADE[a.confiabilidade]}
          </span>
        </div>
      </div>

      {a.precoAlvo === null ? (
        <p className="text-sm text-muted-foreground">
          {a.semAlvo ? `${ROTULO_SEM_ALVO[a.semAlvo]}. ` : ""}
          {a.base.fonte}
        </p>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
            <Numero rotulo="Preço-alvo" valor={reais(a.precoAlvo)} forte nota="por unidade" />
            <Numero
              rotulo="Teto econômico"
              valor={reais(a.precoTeto)}
              forte
              nota="limite configurado"
            />
            <Numero
              rotulo="Proposta"
              valor={reais(a.precoCotado)}
              nota={a.premissas.fornecedor ?? undefined}
            />
            <Numero
              rotulo="Diferença para o teto"
              valor={reais(a.diferencaParaTeto)}
              cor={
                a.diferencaParaTeto !== null && a.diferencaParaTeto > 0
                  ? "text-rose-600"
                  : a.diferencaParaTeto !== null
                    ? "text-emerald-600"
                    : undefined
              }
            />
          </div>

          <div className="grid gap-4 grid-cols-2 sm:grid-cols-4 pt-1 border-t">
            <Numero
              rotulo="Valor econômico"
              valor={reais(a.valorEconomicoUnitario)}
              nota="por unidade"
            />
            <Numero
              rotulo="Margem"
              valor={
                a.margemAbsoluta === null
                  ? "—"
                  : `${formatBrl(a.margemAbsoluta)} · ${formatPercent((a.margemPercentual ?? 0) * 100)}`
              }
            />
            <Numero rotulo="Impacto no pedido" valor={reais(a.impactoPelaQuantidade)} />
            <Numero
              rotulo="Impacto mensal / anual"
              valor={
                a.impactoMensal === null
                  ? "—"
                  : `${formatBrl(a.impactoMensal)} · ${reais(a.impactoAnual)}`
              }
            />
          </div>
        </>
      )}

      <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t">
        <p>
          <span className="font-semibold text-foreground">Remuneração usada:</span>{" "}
          {reais(a.valorRemunerado)} — {a.base.escopo}, vigência {a.base.vigencia}.
        </p>
        <p>
          <span className="font-semibold text-foreground">Fonte:</span> {a.base.fonte}
        </p>
        <p>
          <span className="font-semibold text-foreground">Política configurada:</span> meta{" "}
          {formatPercent(a.politica.margemAlvo * 100)} e limite{" "}
          {formatPercent(a.politica.margemMinima * 100)} sobre o valor econômico.
        </p>
      </div>

      {(confirmados.length > 0 || estimados.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2 pt-1 border-t">
          <Procedencia titulo="Dados confirmados" itens={confirmados} confirmado />
          <Procedencia titulo="Dados estimados" itens={estimados} confirmado={false} />
        </div>
      )}

      {a.base.ressalva && (
        <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3">
          <CircleAlert className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          {a.base.ressalva}
        </p>
      )}

      {a.lacunas.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <div className="font-semibold text-foreground mb-1">O que falta</div>
          <ul className="space-y-1 list-disc pl-4">
            {a.lacunas.map((lacuna, i) => (
              <li key={i}>{lacuna}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Procedencia({
  titulo,
  itens,
  confirmado,
}: {
  titulo: string;
  itens: AvaliacaoDeCompra["dados"];
  confirmado: boolean;
}) {
  if (itens.length === 0) return null;
  const Icone = confirmado ? Check : CircleHelp;
  return (
    <div className="text-xs">
      <div className="font-semibold mb-1">{titulo}</div>
      <ul className="space-y-1.5">
        {itens.map((dado) => (
          <li key={dado.chave} className="flex gap-2">
            <Icone
              className={cn(
                "w-3.5 h-3.5 shrink-0 mt-0.5",
                confirmado ? "text-emerald-600" : "text-amber-600",
              )}
            />
            <span className="min-w-0">
              <span className="font-medium">{dado.rotulo}:</span>{" "}
              {dado.unidade === "BRL"
                ? formatBrl(dado.valor ?? 0)
                : `${dado.valor} ${dado.unidade}`}
              <span className="block text-muted-foreground">{dado.fonte}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A navegação contextual — da resposta para a tela que a sustenta.
 *
 * Os endereços vêm do servidor, e não são montados aqui: quem sabe o que a
 * resposta citou é quem a montou. Ver `lib/compras/src/agente/navegacao.ts`.
 */
export function Atalhos({ atalhos }: { atalhos: Atalho[] }) {
  if (atalhos.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {atalhos.map((atalho, i) => (
        <Link
          key={`${atalho.tipo}-${i}`}
          href={atalho.href}
          title={atalho.porque}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border bg-card hover:bg-muted transition-colors"
        >
          {atalho.rotulo}
          <ArrowUpRight className="w-3 h-3" />
        </Link>
      ))}
    </div>
  );
}

/** O bloco inteiro de uma análise: a conta, depois os caminhos até a origem. */
export function CartaoDaAnalise({ analise }: { analise: AnaliseDoItem }) {
  return (
    <div className="space-y-3">
      <CartaoDaAvaliacao avaliacao={analise.avaliacao} titulo={analise.produto.rotulo} />
      <Atalhos atalhos={analise.atalhos} />
    </div>
  );
}
