import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  APARENCIA_DA_CRITICIDADE,
  ORIGEM_DO_ESPERADO,
  numero,
  type Criticidade,
  type Lacuna,
} from "./tipos";

/**
 * As lacunas, priorizadas por impacto.
 *
 * Três grupos, e a ordem é a de quem decide o que fazer hoje: crítica bloqueia
 * ou compromete análise, relevante reduz confiança, informativa é diferença sem
 * impacto conhecido. Dentro de cada grupo, quantas entidades a lacuna atinge.
 *
 * **Toda lacuna traz o porquê, e o porquê diz se é declaração ou inferência.**
 * É a diferença entre "esperado por contrato, alimenta a receita fixa da DRE" e
 * "presente nas 8 vigências anteriores para 144 entidades — é inferência, não
 * contrato". A segunda é evidência forte e continua sendo um palpite; escondê-la
 * atrás do mesmo rótulo da primeira é o jeito silencioso de uma estatística
 * virar regra.
 */
export function Lacunas({
  lacunas,
  aoAbrir,
}: {
  lacunas: Lacuna[];
  aoAbrir: (lacuna: Lacuna) => void;
}) {
  const grupos: { criticidade: Criticidade; nota: string }[] = [
    { criticidade: "CRITICO", nota: "Bloqueiam ou comprometem uma análise que o FreightCheck publica." },
    { criticidade: "RELEVANTE", nota: "Reduzem a confiança no número, sem bloquear a análise." },
    { criticidade: "INFORMATIVO", nota: "Diferenças sem impacto conhecido sobre as análises." },
  ];

  return (
    <section className="mt-8">
      <h2 className="text-lg font-bold uppercase tracking-wide">Lacunas</h2>
      <div className="border-b-2 border-brand mt-2" />

      {lacunas.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-4">
          Nenhuma lacuna nas vigências analisadas: tudo o que se espera chegou.
        </p>
      ) : (
        <div className="mt-4 space-y-6">
          {grupos.map((grupo) => {
            const doGrupo = lacunas.filter((l) => l.criticidade === grupo.criticidade);
            if (doGrupo.length === 0) return null;
            return (
              <div key={grupo.criticidade}>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <h3
                    className={cn(
                      "text-sm font-bold uppercase tracking-wide px-2 py-0.5 border",
                      APARENCIA_DA_CRITICIDADE[grupo.criticidade].classe,
                    )}
                  >
                    {APARENCIA_DA_CRITICIDADE[grupo.criticidade].rotulo}s ({doGrupo.length})
                  </h3>
                  <p className="text-xs text-muted-foreground">{grupo.nota}</p>
                </div>
                <ul className="mt-3 space-y-2">
                  {doGrupo.map((lacuna) => (
                    <LinhaDeLacuna
                      key={`${lacuna.snapshotId}|${lacuna.attributeCode}`}
                      lacuna={lacuna}
                      aoAbrir={aoAbrir}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function LinhaDeLacuna({
  lacuna,
  aoAbrir,
}: {
  lacuna: Lacuna;
  aoAbrir: (lacuna: Lacuna) => void;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <li className="bg-card border">
      <div className="flex items-start gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setAberta((v) => !v)}
          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          aria-expanded={aberta}
          aria-label={aberta ? "Fechar o motivo" : "Ver por que isto é esperado"}
        >
          {aberta ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold">{lacuna.attributeLabel}</span>
            <code className="text-xs text-muted-foreground">{lacuna.attributeCode}</code>
            <span className="text-xs text-muted-foreground">
              {lacuna.entityType.toLowerCase()} · {lacuna.periodo} · {lacuna.scopeLabel}
            </span>
          </div>

          <div className="text-sm mt-1">
            <strong className="tabular-nums">{numero(lacuna.entidadesFaltando)}</strong>{" "}
            {lacuna.entidadesFaltando === 1 ? "equipamento sem o dado" : "equipamentos sem o dado"}
            <span className="text-muted-foreground">
              {" "}
              · {numero(lacuna.entidadesPresentes)} de {numero(lacuna.entidadesEsperadas)} presentes
            </span>
          </div>

          {lacuna.possivelSucessor && (
            <div className="mt-2 text-xs border border-brand/40 bg-brand/5 px-3 py-2">
              <span className="inline-flex items-center gap-1 font-semibold text-brand">
                <Sparkles className="w-3 h-3" /> Possível correspondência
              </span>{" "}
              — pode ter virado{" "}
              <code className="font-semibold">{lacuna.possivelSucessor.attributeCode}</code>, com{" "}
              {Math.round(lacuna.possivelSucessor.confianca * 100)}% de confiança. Nada foi
              remapeado: a decisão é da Curadoria.
            </div>
          )}

          {aberta && (
            <div className="mt-3 border-l-2 border-border pl-3">
              <div className="text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                Por que o FreightCheck considera que isto está faltando
              </div>
              <p className="text-sm mt-1">{lacuna.justificativa.motivo}</p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span
                  className={cn(
                    "px-1.5 border font-semibold",
                    lacuna.justificativa.declarado
                      ? "text-foreground border-foreground/30"
                      : "text-muted-foreground border-dashed",
                  )}
                >
                  {ORIGEM_DO_ESPERADO[lacuna.justificativa.origem]}
                </span>
                {Object.entries(lacuna.justificativa.medicao)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .map(([chave, valor]) => (
                    <span key={chave}>
                      {chave}: <strong>{String(valor)}</strong>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => aoAbrir(lacuna)}
          className="shrink-0 text-xs font-semibold text-brand hover:underline whitespace-nowrap"
        >
          Ver equipamentos
        </button>
      </div>
    </li>
  );
}
