import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GroupedView } from "@/components/inicio/types";

/**
 * A barra de contexto — a mesma seleção que o usuário faz no Freightech.
 *
 * Lá a ordem é **Canal/Segmento → Vigência → Unidade → Parâmetro**, e só depois
 * de clicar em FILTRAR alguma coisa acontece. Aqui a ordem é reconhecível de
 * propósito, e três coisas mudam:
 *
 * 1. **Não há botão.** Trocar um campo já recarrega. O trabalho de carregar é
 *    do sistema; e o estado vive na URL, de modo que o endereço volta ao mesmo
 *    lugar e pode ser mandado para outra pessoa.
 * 2. **Já abre preenchida** com a vigência mais recente. Abrir uma vigência
 *    nova é o caso da maioria dos dias, e ela não deveria custar um clique.
 * 3. **Campo com uma opção só não finge ser escolha.** Enquanto houver uma
 *    unidade e um canal no banco, os dois aparecem preenchidos e explicados —
 *    um seletor de um item é uma promessa de variedade que o dado não tem.
 *
 * O quarto campo é o que o Freightech não tem, e é a razão deste produto
 * existir: **Comparar com**.
 */

export interface ContextSelection {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
}

function unidadeOf(context: GroupedView["context"]): string {
  const unidade = context.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? context.scopeHash;
}

function detailOf(context: GroupedView["context"]): string {
  const parts = context.scopes
    .filter((s) => s.scopeType === "REGIONAL" || s.scopeType === "OPERADOR")
    .map((s) => s.name ?? s.code);
  return parts.join(" · ");
}

export function ContextBar({
  view,
  onChange,
}: {
  view: GroupedView;
  onChange: (selection: ContextSelection) => void;
}) {
  const contexts = [view.context, ...view.otherContexts];
  const unidades = [...new Map(contexts.map((c) => [c.scopeHash, c])).values()];
  const canais = contexts.filter((c) => c.scopeHash === view.context.scopeHash);

  /**
   * O que cada série está comparando contra.
   *
   * Carreta e cavalo são séries independentes e cada uma compara contra a sua
   * própria anterior, que pode não ser a mesma vigência. Quando são a mesma, o
   * campo mostra um rótulo; quando não, mostra os dois, porque esconder essa
   * diferença faria o usuário atribuir a uma série o que veio da outra.
   */
  const baselines = [...new Set(view.series.map((s) => s.previousLabel).filter(Boolean))];

  return (
    <div className="border-b bg-card px-8 py-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Field label="Unidade" detail={detailOf(view.context)}>
          {unidades.length > 1 ? (
            <Select
              value={view.context.scopeHash}
              onValueChange={(scopeHash) => onChange({ scopeHash, period: undefined })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {unidades.map((c) => (
                  <SelectItem key={c.scopeHash} value={c.scopeHash}>
                    {unidadeOf(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Fixed value={unidadeOf(view.context)} note="única unidade importada" />
          )}
        </Field>

        <Field label="Canal/Segmento" detail={null}>
          {canais.length > 1 ? (
            <Select
              value={view.context.channel ?? ""}
              onValueChange={(canal) => onChange({ canal, period: undefined })}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {canais.map((c) => (
                  <SelectItem key={c.channel ?? "sem-canal"} value={c.channel ?? ""}>
                    {c.channel ?? "sem canal no rótulo"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Fixed
              value={view.context.channel ?? "sem canal no rótulo"}
              note="único canal importado"
            />
          )}
        </Field>

        <Field
          label="Vigência atual"
          detail={view.series.map((s) => s.snapshotLabel).join(" · ")}
        >
          <Select value={view.period} onValueChange={(period) => onChange({ period })}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {view.periods.map((p) => (
                <SelectItem key={p.date} value={p.date}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Comparar com" detail={baselines.join(" · ") || null}>
          {/*
            Fixo, e por um motivo que vale dizer em voz alta: o produto compara
            cada série contra a sua própria vigência anterior, e essas
            comparações são calculadas na importação. Oferecer aqui um par
            arbitrário faria abrir uma tela disparar cálculo pesado — e o número
            passaria a depender de quem abriu primeiro. Para escolher o par à
            mão existe Comparar Vigências, que é onde esse cálculo é pedido de
            propósito.
          */}
          <Fixed
            value={baselines.length > 0 ? "vigência anterior" : "não há anterior"}
            note={
              baselines.length > 0 ? (
                <Link href="/comparar" className="underline hover:text-foreground">
                  escolher outro par
                </Link>
              ) : (
                "primeira vigência desta série"
              )
            }
          />
        </Field>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        {view.series.map((s, i) => (
          <span key={s.entityTypeSet}>
            {i > 0 && " · "}
            {s.fleet} {s.equipment.toLowerCase()}
            {s.fleet === 1 ? "" : "s"}
          </span>
        ))}
        {" · "}
        {view.context.periods} {view.context.periods === 1 ? "vigência" : "vigências"} no
        histórico
      </p>
    </div>
  );
}

function Field({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
      {detail && (
        <div className="text-[0.6875rem] font-mono text-muted-foreground truncate max-w-56">
          {detail}
        </div>
      )}
    </div>
  );
}

/** Campo sem escolha a fazer — dito assim, em vez de um seletor de um item só. */
function Fixed({ value, note }: { value: string; note: React.ReactNode }) {
  return (
    <div className="w-44">
      <div className="h-9 px-3 flex items-center rounded-md border bg-muted/40 text-sm truncate">
        {value}
      </div>
      <div className="text-[0.6875rem] text-muted-foreground mt-1">{note}</div>
    </div>
  );
}
