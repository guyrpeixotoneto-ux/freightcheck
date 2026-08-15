import { useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBrl, formatPercent } from "@/lib/format";
import type {
  ApuracaoDaDRE,
  ConsolidadoDaDRE,
  LinhaDaDRE,
  OrigemDoValor,
  SecaoDaDRE,
  SubtotalDaDRE,
} from "./tipos";

/**
 * A cascata da DRE — a tela inteira do módulo cabe neste componente.
 *
 * Três decisões de leitura, e cada uma custou uma versão anterior:
 *
 * 1. **Progressive disclosure de verdade** (§8). O que abre por padrão são as
 *    seções, não as linhas. Vinte e uma linhas simultâneas — a maioria delas
 *    vazias, porque o export não traz o dado — transformavam a demonstração numa
 *    lista de lacunas com dois números no meio.
 * 2. **O subtotal inconclusivo é uma linha, não uma ausência.** Ele ocupa o
 *    mesmo espaço vertical de um subtotal com número, com o nome em cinza e o
 *    motivo ao lado. Sumir com ele deixaria a cascata parecendo fechada.
 * 3. **A linha sem valor não some.** Ela fica com o rótulo do motivo no lugar do
 *    número. Uma DRE que escondesse o que não sabe apurar seria uma DRE que
 *    afirma completude — o oposto do que este produto é.
 */

export function Cascata({
  dre,
  className,
}: {
  dre: ApuracaoDaDRE | ConsolidadoDaDRE;
  className?: string;
}) {
  const subtotalPorId = new Map(dre.subtotais.map((s) => [s.id, s]));

  return (
    <div className={cn("border rounded-lg bg-card overflow-hidden", className)}>
      {dre.secoes.map((secao) => (
        <Secao key={secao.id} secao={secao} subtotal={subtotalPorId.get(secao.fecha)!} />
      ))}
    </div>
  );
}

function Secao({ secao, subtotal }: { secao: SecaoDaDRE; subtotal: SubtotalDaDRE }) {
  const [aberta, setAberta] = useState(false);
  const comValor = secao.linhas.filter((l) => l.valor !== null).length;

  return (
    <section className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setAberta((v) => !v)}
        aria-expanded={aberta}
        className="w-full flex items-baseline gap-3 px-5 py-3 text-left hover:bg-muted/40 transition-colors"
      >
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 self-center text-muted-foreground transition-transform",
            aberta && "rotate-90",
          )}
        />
        <span className="text-sm font-medium flex-1 min-w-0">{secao.titulo}</span>
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0">
          {comValor}/{secao.linhas.length}
        </span>
        <span className="text-sm tabular-nums w-36 text-right shrink-0">
          {/*
            A receita bruta não repete o próprio número.

            O subtotal que fecha esta seção **é** ela — mesmo nome, mesmo valor —
            e a cascata mostrava "Receita bruta R$ 1.204.664,11" duas vezes
            seguidas, uma em cinza e outra em negrito. Nas outras seções os dois
            números são diferentes (o da seção é o que ela soma, o do subtotal é
            o acumulado) e os dois valem.
          */}
          {secao.fecha === secao.id ? null : secao.total === null ? (
            <span className="text-muted-foreground">não apurado</span>
          ) : (
            formatBrl(Math.abs(secao.total))
          )}
        </span>
      </button>

      {aberta && (
        <div className="bg-muted/20 border-t">
          <p className="px-5 pt-3 pb-1 text-xs text-muted-foreground max-w-3xl">{secao.nota}</p>
          <ul>
            {secao.linhas.map((linha) => (
              <Linha key={linha.code} linha={linha} />
            ))}
          </ul>
        </div>
      )}

      <Subtotal subtotal={subtotal} />
    </section>
  );
}

function Linha({ linha }: { linha: LinhaDaDRE }) {
  const [aberta, setAberta] = useState(false);
  const podeAbrir = linha.origens.length > 0 || linha.ausencia !== null;

  return (
    <li className="border-t border-border/50 first:border-t-0">
      <button
        type="button"
        onClick={() => podeAbrir && setAberta((v) => !v)}
        aria-expanded={podeAbrir ? aberta : undefined}
        className={cn(
          "w-full flex items-baseline gap-3 pl-12 pr-5 py-2 text-left",
          podeAbrir && "hover:bg-muted/50 transition-colors",
        )}
      >
        <span
          className={cn(
            "text-sm flex-1 min-w-0 truncate",
            linha.valor === null && "text-muted-foreground",
          )}
        >
          {linha.titulo}
        </span>

        {linha.valor === null ? (
          <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground shrink-0">
            {linha.ausencia?.rotulo}
          </span>
        ) : (
          <>
            <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
              {formatPercent(linha.percentualDaReceita, 1)}
            </span>
            <span className="text-sm tabular-nums shrink-0 w-36 text-right">
              {formatBrl(Math.abs(linha.valor))}
            </span>
          </>
        )}
      </button>

      {aberta && <Detalhe linha={linha} />}
    </li>
  );
}

/**
 * De onde veio este número (§5).
 *
 * Fórmula, quantidade, parâmetro, periodicidade, vigência, arquivo, aba, célula,
 * atributo canônico, versão da semântica e a transformação aplicada — tudo o que
 * o pedido lista, e nada que não esteja no dado.
 */
function Detalhe({ linha }: { linha: LinhaDaDRE }) {
  if (linha.valor === null && linha.ausencia) {
    return (
      <div className="pl-12 pr-5 pb-4 pt-1 space-y-2 bg-background/60">
        <p className="text-sm">{linha.ausencia.oQueFalta}</p>
        <p className="text-xs text-muted-foreground max-w-3xl">{linha.evidencia}</p>
      </div>
    );
  }

  return (
    <div className="pl-12 pr-5 pb-4 pt-1 space-y-3 bg-background/60">
      {linha.origens.length > 1 && (
        <p className="text-xs text-muted-foreground">
          {formatBrl(linha.valor!)} ={" "}
          {linha.origens.map((o) => formatBrl(o.valorNaDRE)).join(" + ")}
        </p>
      )}

      {linha.origens.map((origem) => (
        <Origem key={`${origem.entityId}-${origem.attributeCode}`} origem={origem} />
      ))}

      <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">{linha.evidencia}</p>
    </div>
  );
}

function Origem({ origem }: { origem: OrigemDoValor }) {
  const t = origem.transformacao;
  return (
    <div className="border rounded-md bg-card px-3 py-2.5 text-xs space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{origem.titulo}</span>
        <span className="tabular-nums text-muted-foreground">
          {origem.placa ?? origem.entityType}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
        <dt>Valor na fonte</dt>
        <dd className="tabular-nums text-foreground">
          {formatBrl(origem.valorNaFonte)}
          {t.periodicidadeOriginal === "ANUAL" ? "/ano" : "/mês"}
        </dd>

        {t.fator !== 1 && (
          <>
            <dt>Transformação</dt>
            <dd className="text-foreground">
              {t.formula} = {formatBrl(origem.valorNaDRE)}/mês
              <span className="block text-muted-foreground mt-0.5">{t.explicacao}</span>
            </dd>
          </>
        )}

        <dt>Atributo canônico</dt>
        <dd className="font-mono text-[0.6875rem] text-foreground">{origem.attributeCode}</dd>

        <dt>Semântica</dt>
        <dd className="text-foreground">
          {origem.semanticsStatus}
          {origem.semanticsVersion !== null && ` · versão ${origem.semanticsVersion}`}
          {origem.unit && ` · ${origem.unit}`}
          {origem.periodicity && ` · ${origem.periodicity.toLowerCase()}`}
        </dd>

        {origem.calculationBasis && (
          <>
            <dt>Base de cálculo</dt>
            <dd className="text-foreground">{origem.calculationBasis}</dd>
          </>
        )}

        {origem.taxonomyPath && (
          <>
            <dt>Classificação</dt>
            <dd className="font-mono text-[0.6875rem] text-foreground">{origem.taxonomyPath}</dd>
          </>
        )}

        {origem.celula && (
          <>
            <dt>Origem</dt>
            <dd className="text-foreground">
              {origem.celula.sourceLabel}
              {origem.celula.sheetName && ` · aba ${origem.celula.sheetName}`}
              {origem.celula.columnLetter &&
                origem.celula.rowIndex !== null &&
                ` · célula ${origem.celula.columnLetter}${origem.celula.rowIndex}`}
              {origem.celula.rawValue && (
                <span className="block text-muted-foreground mt-0.5">
                  como veio: “{origem.celula.rawValue}”
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * O subtotal — com número, ou com o motivo de não haver número.
 *
 * O caso que define o componente é o EBITDA deste export: sem diesel, sem pneu e
 * sem motorista, ele sairia em 97% da receita. A linha existe, ocupa o mesmo
 * lugar, e diz o que falta.
 */
function Subtotal({ subtotal }: { subtotal: SubtotalDaDRE }) {
  const [aberto, setAberto] = useState(false);

  if (!subtotal.conclusivo) {
    return (
      <div className="border-t bg-muted/30">
        <button
          type="button"
          onClick={() => setAberto((v) => !v)}
          aria-expanded={aberto}
          className="w-full flex items-baseline gap-3 px-5 py-3 text-left hover:bg-muted/50 transition-colors"
        >
          <span className="text-sm font-semibold text-muted-foreground flex-1 min-w-0">
            {subtotal.titulo}
          </span>
          <span className="inline-flex items-center gap-1.5 text-[0.6875rem] uppercase tracking-wide text-amber-600 dark:text-amber-500 shrink-0">
            <CircleAlert className="w-3.5 h-3.5" />
            não apurável
          </span>
          <ChevronRight
            className={cn(
              "w-4 h-4 shrink-0 self-center text-muted-foreground transition-transform",
              aberto && "rotate-90",
            )}
          />
        </button>

        {aberto && (
          <div className="px-5 pb-4 space-y-2">
            <p className="text-xs text-muted-foreground">
              {subtotal.bloqueadoPor.length}{" "}
              {subtotal.bloqueadoPor.length === 1 ? "componente essencial" : "componentes essenciais"}{" "}
              sem dado impedem este subtotal de significar o que o nome promete.
            </p>
            <ul className="space-y-1.5">
              {subtotal.bloqueadoPor.map((b) => (
                <li key={b.code} className="text-xs">
                  <span className="font-medium">{b.titulo}</span>
                  <span className="text-muted-foreground"> — {b.oQueFalta}</span>
                </li>
              ))}
            </ul>
            {subtotal.valorParcial !== null && (
              <p className="text-xs text-muted-foreground pt-1 border-t">
                Com o que existe hoje, a conta daria{" "}
                <span className="tabular-nums text-foreground">
                  {formatBrl(subtotal.valorParcial)}
                </span>
                . Não é o {subtotal.titulo.toLowerCase()} — é a mesma conta com as linhas
                ausentes fora dela.
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t bg-muted/30 flex items-baseline gap-3 px-5 py-3">
      <CircleCheck className="w-4 h-4 shrink-0 self-center text-emerald-600 dark:text-emerald-500" />
      <span className="text-sm font-semibold flex-1 min-w-0">{subtotal.titulo}</span>
      {subtotal.percentualDaReceita !== null && (
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums shrink-0 w-14 text-right">
          {subtotal.percentualDaReceita.toFixed(1)}%
        </span>
      )}
      <span className="text-base font-semibold tabular-nums shrink-0 w-36 text-right">
        {formatBrl(subtotal.valor!)}
      </span>
    </div>
  );
}

/** O aviso de circularidade, que não pode ser fechado nem escondido. */
export function AvisoDeCircularidade({ texto }: { texto: string }) {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-500" />
      <p className="text-xs leading-relaxed text-muted-foreground max-w-4xl">{texto}</p>
    </div>
  );
}
