import { useState } from "react";
import { ChevronRight } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatBrl } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Afericao,
  Aferibilidade,
  ClasseDeLastro,
  FonteFaltante,
  LimiteDaAfericao,
  ParcelaAferida,
  TresColunas,
} from "@/lib/fechamento";

/**
 * OS DOIS SELOS — e a promessa de que nenhum dos dois é opinião.
 *
 * **A pergunta que eles respondem.** Quem abre esta tela quer saber, antes de
 * discutir qualquer linha, *o quanto dá para confiar neste mês*. A resposta
 * honesta são duas perguntas separadas, e é por isso que são dois selos e não
 * uma nota:
 *
 * - **Precisão** — do dinheiro que o sistema conseguiu conferir, quanto bate?
 * - **Lastro** — do dinheiro que o fechamento move, quanto tem contrapartida
 *   num documento que **não** o produziu?
 *
 * Elas andam em direções opostas com frequência, e é justamente aí que a
 * separação paga: um fechamento pode ter 100% de precisão com lastro
 * baixíssimo — basta conferir tudo contra o arquivo de onde os números saíram,
 * que é uma conferência que concorda consigo mesma. Uma nota só esconderia isso.
 *
 * **Um número num selo tem de ser clicável, ou é propaganda.** Um percentual
 * grande e verde sem nada atrás é a coisa mais fácil de fabricar numa tela e a
 * mais difícil de contestar. A barra lateral existe para que a conta inteira
 * fique a um clique: o numerador, o denominador, cada parcela que entrou nela e,
 * no fim, **o que o número não mede**. Se o painel afirma 99%, quem lê tem de
 * poder chegar aos 99% sozinho.
 *
 * **Nada é somado no navegador.** Os dois percentuais, as parcelas e os limites
 * chegam calculados de `@workspace/fechamento`. Uma soma feita aqui seria uma
 * segunda opinião sobre remuneração — a mesma regra do resto desta tela.
 */

/** Qual das três colunas o recorte da tela está lendo. */
export type ColunaDaAfericao = "primeira" | "segunda" | "total";

/** Reexportado para o teste desta tela não precisar do pacote de domínio. */
export type Completude = "COMPLETO" | "INCOMPLETO" | "NAO_APLICAVEL";

const dinheiro = (v: number | null) => (v === null ? "—" : formatBrl(v));

/**
 * Um percentual com uma casa. `null` vira `—`, e a distinção é o ponto.
 *
 * Razão sem denominador não é 0% nem 100%: é uma pergunta que ninguém fez. O
 * canal cujo painel não foi transcrito cai aqui, e mostrar `0,0%` nele afirmaria
 * que a conta está errada quando ninguém a conferiu.
 */
export function percentual(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * A faixa de um percentual — o que decide a cor do selo.
 *
 * Três faixas e não um gradiente: quem varre a tela precisa de uma leitura
 * categórica, e um verde que escurece devagar não é leitura, é decoração. Os
 * cortes valem para os dois selos porque os dois são a mesma grandeza — fração
 * do dinheiro do fechamento —, e usar cortes diferentes em cada um faria a
 * mesma cor significar coisas diferentes lado a lado.
 */
export function faixa(
  v: number | null,
  completude?: Completude,
): "SEM_MEDIDA" | "INCOMPLETO" | "BOA" | "ATENCAO" | "BAIXA" {
  /*
    **Fechamento incompleto tem faixa própria, e ela não é a pior.** Vermelho
    fica reservado para divergência real em fechamento aferível: pintar de
    vermelho um mês que só está pela metade faz quem lê entender "a remuneração
    está toda errada" quando a verdade é "ainda não tenho os documentos". Âmbar
    diz o que é — pendência de importação.
  */
  if (completude === "INCOMPLETO") return "INCOMPLETO";
  if (v === null) return "SEM_MEDIDA";
  if (v >= 0.99) return "BOA";
  if (v >= 0.9) return "ATENCAO";
  return "BAIXA";
}

const CORES: Record<ReturnType<typeof faixa>, string> = {
  INCOMPLETO:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  BOA: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100",
  ATENCAO:
    "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100",
  BAIXA:
    "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-100",
  SEM_MEDIDA: "border-border bg-muted/40 text-muted-foreground",
};

/** Qual selo está aberto na barra lateral. */
type Aberto = "PRECISAO" | "LASTRO" | null;

export function SelosDeAfericao({
  afericao,
  coluna,
  rotuloDaColuna,
}: {
  afericao: Afericao;
  coluna: ColunaDaAfericao;
  /** Como a tela chama o recorte — para a barra lateral dizer do que fala. */
  rotuloDaColuna: string;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);

  const precisao = afericao.precisao[coluna];
  const lastro = afericao.lastro[coluna];
  const aferibilidade = afericao.aferibilidade?.[coluna] ?? null;
  const incompleto = aferibilidade?.completude === "INCOMPLETO";

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Selo
          rotulo="Precisão"
          valor={precisao}
          completude={aferibilidade?.completude}
          /*
            No fechamento incompleto o resumo diz **o estado**, não a cifra. Um
            "R$ 1.023.037,11 sem explicação" ao lado de um traço convidaria a ler
            o número como divergência, quando ele é a soma de diferenças medidas
            sobre metade dos documentos.
          */
          resumo={
            incompleto
              ? "Fechamento incompleto"
              : precisao === null
                ? "nada conferido neste recorte"
                : `${dinheiro(afericao.naoExplicado[coluna])} sem explicação`
          }
          onAbrir={() => setAberto("PRECISAO")}
        />
        <Selo
          rotulo="Lastro"
          valor={lastro}
          resumo={
            lastro === null
              ? "nada movimentado neste recorte"
              : `${dinheiro(afericao.comLastroCruzado[coluna])} de ${dinheiro(
                  afericao.movimentado[coluna],
                )}`
          }
          onAbrir={() => setAberto("LASTRO")}
        />
      </div>

      {/*
        A lista do que falta, fora da barra lateral — ela responde "o que eu
        faço agora?", e essa pergunta não pode custar um clique. Cada item traz
        a rotina, a quinzena e a causa, que é o endereço de quem vai resolver.
      */}
      {incompleto && aferibilidade!.faltando.length > 0 && (
        <FaltamDados aferibilidade={aferibilidade!} />
      )}

      <Sheet open={aberto !== null} onOpenChange={(v) => !v && setAberto(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {aberto === "PRECISAO" && (
            <Detalhe
              titulo="Precisão"
              pergunta="Do dinheiro que o sistema conseguiu conferir, quanto bate?"
              valor={precisao}
              afericao={afericao}
              coluna={coluna}
              rotuloDaColuna={rotuloDaColuna}
              conta={[
                {
                  rotulo: "Diferença sem explicação",
                  valor: afericao.naoExplicado[coluna],
                  nota: "A soma do que está marcado na coluna Auditar — divergências que existem e que ninguém explicou.",
                },
                {
                  rotulo: "Dinheiro com contrapartida",
                  valor: afericao.comContrapartida[coluna],
                  nota: "O que tem os dois lados. O dinheiro sem contrapartida fica de fora: não há subtração que o meça.",
                },
              ]}
              formula="1 − diferença sem explicação ÷ dinheiro com contrapartida"
              mostrar="naoExplicado"
            />
          )}
          {aberto === "LASTRO" && (
            <Detalhe
              titulo="Lastro"
              pergunta="Do dinheiro que o fechamento move, quanto tem contrapartida num documento que não o produziu?"
              valor={lastro}
              afericao={afericao}
              coluna={coluna}
              rotuloDaColuna={rotuloDaColuna}
              conta={[
                {
                  rotulo: "Com lastro cruzado",
                  valor: afericao.comLastroCruzado[coluna],
                  nota: "O devido sai de um arquivo e o demonstrado de outro. Dois documentos que ninguém escreveu olhando o outro.",
                },
                {
                  rotulo: "Movimentado",
                  valor: afericao.movimentado[coluna],
                  nota: "Tudo o que o fechamento move, em módulo — parcela e desconto contam igual, porque os dois são dinheiro a conferir.",
                },
              ]}
              formula="com lastro cruzado ÷ movimentado"
              mostrar="lastro"
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Selo({
  rotulo,
  valor,
  resumo,
  completude,
  onAbrir,
}: {
  rotulo: string;
  valor: number | null;
  resumo: string;
  /** Decide a cor junto com o valor — ver {@link faixa}. */
  completude?: Completude;
  onAbrir: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "group flex items-baseline gap-2 rounded-md border px-3 py-1.5 text-left transition-colors",
        "hover:brightness-[0.97] dark:hover:brightness-125",
        CORES[faixa(valor, completude)],
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
        {rotulo}
      </span>
      <span className="font-mono text-base font-semibold tabular-nums">
        {percentual(valor)}
      </span>
      <span className="text-[11px] opacity-70">{resumo}</span>
      <ChevronRight className="h-3.5 w-3.5 self-center opacity-50 transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/**
 * O que falta para aferir — a lista que transforma um traço em trabalho.
 *
 * **Não basta dizer "fechamento incompleto".** Quem lê precisa saber qual
 * arquivo e de qual quinzena, ou o aviso vira ruído: um alerta que não diz o
 * que fazer é indistinguível de um alerta que não interessa. Cada item traz a
 * rotina como quem opera a chama (`2Art`, `03.08.20`), a quinzena, e a causa —
 * porque as duas causas pedem ações diferentes: importar um arquivo, ou abrir a
 * competência antes de poder importar.
 */
function FaltamDados({ aferibilidade }: { aferibilidade: Aferibilidade }) {
  /* Agrupa por quinzena, que é como quem vai resolver organiza o trabalho. */
  const porQuinzena = ([1, 2] as const)
    .map((q) => ({
      quinzena: q,
      itens: aferibilidade.faltando.filter((f) => f.quinzena === q),
    }))
    .filter((g) => g.itens.length > 0);

  return (
    <div className="rounded-md border border-amber-300 bg-amber-50/70 px-3 py-2 text-xs dark:border-amber-900/70 dark:bg-amber-950/30">
      <p className="font-semibold text-amber-900 dark:text-amber-100">
        Faltam dados para aferir
      </p>
      <ul className="mt-1 space-y-0.5">
        {porQuinzena.flatMap((g) =>
          g.itens.map((f) => (
            <li key={`${f.tipo}-${f.quinzena}`} className="text-muted-foreground">
              <span className="font-mono text-[11px] text-foreground">{f.rotina}</span>
              {" · "}
              {f.quinzena}ª quinzena — {motivoDaFalta(f)}
            </li>
          )),
        )}
      </ul>
      <p className="mt-1.5 text-muted-foreground">
        Enquanto faltarem, a precisão fica em branco — e branco aqui é{" "}
        <strong className="text-foreground">ainda não dá para saber</strong>, não
        “os valores estão errados”.
      </p>
    </div>
  );
}

/** A causa de uma falta, na palavra de quem vai resolvê-la. */
export function motivoDaFalta(f: FonteFaltante): string {
  return f.motivo === "NAO_IMPORTADO" ? "não importado" : "quinzena não aberta";
}

/** As classes de lastro na ordem em que a barra lateral as empilha. */
const ROTULO_DA_CLASSE: Record<ClasseDeLastro, string> = {
  CRUZADO: "Cruzado — dois documentos independentes",
  CRUZADO_EM_CONJUNTO: "Cruzado, mas só em conjunto",
  MESMA_FONTE: "Conferido contra a própria fonte",
  SEM_CONTRAPARTIDA: "Sem contrapartida",
};

function Detalhe({
  titulo,
  pergunta,
  valor,
  afericao,
  coluna,
  rotuloDaColuna,
  conta,
  formula,
  mostrar,
}: {
  titulo: string;
  pergunta: string;
  valor: number | null;
  afericao: Afericao;
  coluna: ColunaDaAfericao;
  rotuloDaColuna: string;
  conta: { rotulo: string; valor: number | null; nota: string }[];
  formula: string;
  /**
   * Qual coluna a lista de parcelas destaca.
   *
   * A mesma lista serve aos dois selos, e o que muda é o que se procura nela:
   * na precisão, quanto cada parcela deve; no lastro, quanto de cada parcela
   * tem documento atrás. Duas listas diriam a mesma coisa duas vezes e
   * ofereceriam dois lugares para divergir.
   */
  mostrar: "naoExplicado" | "lastro";
}) {
  const ordenadas = [...afericao.parcelas].sort(
    (a, b) => (b.valor[coluna] ?? 0) - (a.valor[coluna] ?? 0),
  );
  const aferibilidade = afericao.aferibilidade?.[coluna] ?? null;

  return (
    <>
      <SheetHeader className="space-y-2">
        <SheetTitle className="flex items-baseline gap-3">
          <span>{titulo}</span>
          <span className="font-mono text-2xl tabular-nums">{percentual(valor)}</span>
        </SheetTitle>
        <SheetDescription>
          {pergunta}
          <span className="mt-1 block text-xs">
            {afericao.canal} · {rotuloDaColuna}
          </span>
        </SheetDescription>
      </SheetHeader>

      <div className="mt-6 space-y-7 px-4 pb-10">
        {/*
          O estado vem antes da conta. Abrir a barra lateral de um fechamento
          incompleto e encontrar numerador e denominador convidaria a discutir
          uma conta que não devia ter sido feita.
        */}
        {aferibilidade?.completude === "INCOMPLETO" && (
          <section className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-900/70 dark:bg-amber-950/30">
              <p className="text-sm font-semibold">Fechamento incompleto</p>
              <p className="mt-1 text-xs text-muted-foreground">{aferibilidade.porque}</p>
            </div>
            {aferibilidade.faltando.length > 0 && (
              <FaltamDados aferibilidade={aferibilidade} />
            )}
          </section>
        )}

        {/* A conta, aberta. É o que transforma um selo numa afirmação conferível. */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            A conta
          </h3>
          <div className="space-y-3">
            {conta.map((c) => (
              <div key={c.rotulo} className="border-b pb-3 last:border-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-sm font-medium">{c.rotulo}</span>
                  <span className="font-mono text-sm tabular-nums">{dinheiro(c.valor)}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{c.nota}</p>
              </div>
            ))}
          </div>
          <p className="rounded border bg-muted/40 px-3 py-2 font-mono text-xs">{formula}</p>
          <p className="text-xs text-muted-foreground">
            Nenhum dos dois números é digitado em lugar nenhum. Os dois saem das parcelas
            abaixo, e mudam sozinhos quando o fechamento muda.
          </p>
        </section>

        {/* As parcelas — a lista de onde a conta saiu, maior primeiro. */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            De onde saiu — {ordenadas.length} parcelas
          </h3>
          <div className="space-y-3">
            {ordenadas.map((p) => (
              <Parcela key={p.chave} parcela={p} coluna={coluna} mostrar={mostrar} />
            ))}
          </div>
        </section>

        {/* Os limites — o que o número não mede, dito pelo próprio número. */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            O que este número não mede
          </h3>
          {afericao.limites.map((l) => (
            <Limite key={l.titulo} limite={l} coluna={coluna} />
          ))}
        </section>
      </div>
    </>
  );
}

function Parcela({
  parcela,
  coluna,
  mostrar,
}: {
  parcela: ParcelaAferida;
  coluna: ColunaDaAfericao;
  mostrar: "naoExplicado" | "lastro";
}) {
  const valor = parcela.valor[coluna];
  const comLastro = parcela.comLastro[coluna] ?? 0;
  const naoExplicado = parcela.naoExplicado[coluna] ?? 0;
  /* Cobertura parcial: o `DVS` é o caso, e é o que a barra de progresso mostra. */
  const fracao = valor && valor > 0 ? Math.min(1, comLastro / valor) : 0;

  return (
    <div className="border-b pb-3 last:border-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{parcela.nome}</span>
        <span className="font-mono text-sm tabular-nums">{dinheiro(valor)}</span>
      </div>

      <div className="mt-1 flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">
          {ROTULO_DA_CLASSE[parcela.classe]}
        </span>
        {parcela.fonteDoDevido && (
          <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
            {parcela.fonteDoDevido}
          </code>
        )}
      </div>

      {mostrar === "lastro" ? (
        <>
          {/*
            A barra existe por causa da cobertura parcial. Sem ela, uma parcela
            coberta pela metade e uma coberta inteira teriam a mesma cara.
          */}
          <div className="mt-2 h-1 w-full overflow-hidden rounded bg-muted">
            <div
              className="h-full bg-emerald-500 dark:bg-emerald-400"
              style={{ width: `${fracao * 100}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {comLastro === 0
              ? "sem lastro cruzado"
              : `${dinheiro(comLastro)} com lastro${
                  valor !== null && comLastro < valor - 0.005
                    ? ` · ${dinheiro(valor - comLastro)} sem`
                    : ""
                }`}
          </p>
        </>
      ) : (
        <p className="mt-1 text-[11px]">
          {naoExplicado > 0.005 ? (
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {dinheiro(naoExplicado)} sem explicação
            </span>
          ) : (
            <span className="text-muted-foreground">fecha</span>
          )}
        </p>
      )}

      <p className="mt-1 text-xs text-muted-foreground">{parcela.porque}</p>
    </div>
  );
}

function Limite({ limite, coluna }: { limite: LimiteDaAfericao; coluna: ColunaDaAfericao }) {
  const valor: TresColunas | null = limite.valor;
  return (
    <div className="rounded border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/25">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm font-medium">{limite.titulo}</span>
        {valor && (
          <span className="font-mono text-xs tabular-nums">{dinheiro(valor[coluna])}</span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{limite.texto}</p>
    </div>
  );
}
