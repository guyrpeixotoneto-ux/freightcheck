import { FileSpreadsheet, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import { numero, type Descoberta } from "./tipos";

/**
 * Descobertos recentemente.
 *
 * A seção que permite o FreightCheck evoluir junto com o Freightec: quando a
 * origem inventa uma coluna, ela aparece aqui com a primeira vigência em que
 * apareceu, o arquivo que a trouxe, quantas entidades já a têm e — quando
 * existe — o provável campo que ela substitui.
 *
 * **A correspondência é uma proposta, e a tela diz isso em voz alta.** Nada é
 * remapeado: a confiança vem acompanhada dos motivos que a formaram, um a um,
 * e o botão manda a decisão para a Curadoria em vez de tomá-la. Um remapeamento
 * automático apagaria a evidência de que houve uma pergunta a fazer, e é
 * justamente essa evidência que faz este módulo valer alguma coisa.
 */
export function Descobertas({ descobertas }: { descobertas: Descoberta[] }) {
  if (descobertas.length === 0) {
    return (
      <section className="mt-8">
        <h2 className="text-lg font-bold uppercase tracking-wide">Descobertos recentemente</h2>
        <div className="border-b-2 border-brand mt-2" />
        <p className="text-sm text-muted-foreground mt-4">
          Nada novo na vigência mais recente — o universo de dados conhecido não mudou.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide">
        Descobertos recentemente ({descobertas.length})
      </h2>
      <div className="border-b-2 border-brand mt-2" />
      <p className="text-xs text-muted-foreground mt-3 max-w-4xl">
        Atributos que não faziam parte do universo conhecido. Eles não contam como cobertura — o
        denominador é o que se espera —, e ficam aqui até que alguém decida o que são.
      </p>

      <ul className="mt-4 space-y-2">
        {descobertas.map((d) => (
          <li key={d.attributeCode} className="bg-card border px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1 font-semibold text-brand">
                <Sparkles className="w-3.5 h-3.5" />
                {d.attributeLabel}
              </span>
              <code className="text-xs text-muted-foreground">{d.attributeCode}</code>
              <span
                className={cn(
                  "text-[0.6875rem] uppercase tracking-wide px-1.5 border font-semibold",
                  d.statusDeCuradoria === "PENDENTE"
                    ? "text-warning-foreground border-warning/40 bg-warning/10"
                    : "text-success border-success/40 bg-success/10",
                )}
              >
                {d.statusDeCuradoria === "PENDENTE" ? "aguarda curadoria" : "decidido"}
              </span>
            </div>

            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              <span>
                primeira aparição: <strong>{d.primeiroRotulo}</strong>
              </span>
              <span>
                equipamento: <strong>{d.entityType.toLowerCase()}</strong>
              </span>
              <span>
                entidades: <strong className="tabular-nums">{numero(d.entidadesAfetadas)}</strong>
              </span>
              {d.arquivo && (
                <span className="inline-flex items-center gap-1">
                  <FileSpreadsheet className="w-3 h-3" />
                  {d.arquivo}
                </span>
              )}
            </div>

            {d.possivelSucessaoDe && (
              <div className="mt-2 border border-brand/40 bg-brand/5 px-3 py-2 text-xs">
                <div className="font-semibold text-brand">Possível correspondência</div>
                <div className="mt-1">
                  Provável equivalente: <code className="font-semibold">
                    {d.possivelSucessaoDe.attributeCode}
                  </code>{" "}
                  · confiança{" "}
                  <strong>{Math.round(d.possivelSucessaoDe.confianca * 100)}%</strong>
                </div>
                <ul className="mt-1 list-disc list-inside text-muted-foreground">
                  {d.possivelSucessaoDe.motivos.map((motivo) => (
                    <li key={motivo}>{motivo}</li>
                  ))}
                </ul>
                <p className="mt-1.5">
                  Nada foi remapeado e o campo anterior continua contando como lacuna até que uma
                  pessoa decida.{" "}
                  <Link href="/curadoria" className="text-brand font-semibold hover:underline">
                    Levar para a Curadoria
                  </Link>
                  .
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
