import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SeriesContext } from "@/components/inicio/types";

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
 *
 * ---------------------------------------------------------------------------
 * Por que ela recebe o contexto em pedaços, e não uma resposta inteira
 * ---------------------------------------------------------------------------
 *
 * Esta barra nasceu tipada em `GroupedView` — a resposta de uma tela só — e por
 * isso ficou montada em tela nenhuma: as outras oito que recortam por contexto
 * têm respostas de formatos diferentes, e nenhuma delas cabia no tipo. Duas
 * acabaram escrevendo o próprio seletor (Início e Parâmetros), e o produto
 * passou a ter **três** definições de "escolher unidade" na interface — a nona
 * definição de contexto desta auditoria, agora em React.
 *
 * Os campos abaixo são o mínimo que todo consumidor tem: o contexto atual, os
 * outros, e a lista de vigências. O que é específico de Alterações — a frota
 * por série e contra o que cada uma comparou — entra como adorno opcional, e
 * não como requisito de tipo.
 */

export interface ContextSelection {
  scopeHash?: string;
  canal?: string | null;
  period?: string;
}

export function unidadeOf(context: SeriesContext): string {
  const unidade = context.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? context.scopeHash;
}

function detailOf(context: SeriesContext): string {
  const parts = context.scopes
    .filter((s) => s.scopeType === "REGIONAL" || s.scopeType === "OPERADOR")
    .map((s) => s.name ?? s.code);
  return parts.join(" · ");
}

export interface ContextBarProps {
  /** O contexto que produziu o que está na tela. */
  contexto: SeriesContext;
  /** Os outros que existem no banco. Vazio enquanto houver uma unidade só. */
  outros: SeriesContext[];
  /** As vigências do contexto atual, em ordem. */
  periodos: { date: string; label: string }[];
  periodoAtual: string;
  /** O rótulo do arquivo da vigência aberta, quando a tela souber qual é. */
  vigenciaDetalhe?: string | null;
  /**
   * Contra o que a tela está comparando, quando ela compara.
   *
   * Carreta e cavalo são séries independentes e cada uma compara contra a sua
   * própria anterior, que pode não ser a mesma vigência. Quando são a mesma, o
   * campo mostra um rótulo; quando não, mostra os dois, porque esconder essa
   * diferença faria o usuário atribuir a uma série o que veio da outra.
   *
   * `undefined` esconde o campo: numa tela que não compara, "Comparar com" é
   * uma promessa que ela não cumpre.
   */
  compararCom?: string[];
  /** A linha de rodapé da tela — frota, contagens. Opcional por desenho. */
  rodape?: React.ReactNode;
  onChange: (selection: ContextSelection) => void;
}

export function ContextBar({
  contexto,
  outros,
  periodos,
  periodoAtual,
  vigenciaDetalhe,
  compararCom,
  rodape,
  onChange,
}: ContextBarProps) {
  const contexts = [contexto, ...outros];
  const unidades = [...new Map(contexts.map((c) => [c.scopeHash, c])).values()];
  const canais = contexts.filter((c) => c.scopeHash === contexto.scopeHash);
  const baselines = compararCom ?? [];

  return (
    <div className="border-b bg-card px-8 py-4">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
        <Field label="Unidade" detail={detailOf(contexto)}>
          {unidades.length > 1 ? (
            <Select
              value={contexto.scopeHash}
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
            <Fixed value={unidadeOf(contexto)} note="única unidade importada" />
          )}
        </Field>

        <Field label="Canal/Segmento" detail={null}>
          {canais.length > 1 ? (
            <Select
              value={contexto.channel ?? ""}
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
              value={contexto.channel ?? "sem canal no rótulo"}
              note="único canal importado"
            />
          )}
        </Field>

        <Field
          label="Vigência atual"
          detail={vigenciaDetalhe ?? null}
        >
          <Select value={periodoAtual} onValueChange={(period) => onChange({ period })}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periodos.map((p) => (
                <SelectItem key={p.date} value={p.date}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {compararCom !== undefined && (
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
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        {rodape}
        {rodape ? " · " : ""}
        {contexto.periods} {contexto.periods === 1 ? "vigência" : "vigências"} no histórico
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
