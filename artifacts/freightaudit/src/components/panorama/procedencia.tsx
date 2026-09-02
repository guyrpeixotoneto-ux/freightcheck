import { CloudDownload, Database, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { escreverPercentual } from "@/lib/visao-geral";
import { cn } from "@/lib/utils";
import type { Procedencia as DadosDaProcedencia } from "@/lib/panorama";
import type { Tom } from "@/lib/visao-geral";

const COR_DO_TOM: Record<Tom, string> = {
  grave: "text-red-700",
  atencao: "text-amber-700",
  ok: "text-emerald-700",
};

/**
 * Andar 7 — a procedência. *"Posso confiar nisto?"*
 *
 * **O último andar, e deliberadamente o último.** Quem abre a tela vem ver
 * dinheiro, e a qualidade do dado nunca deve competir com o financeiro pelo
 * primeiro olhar — a mesma ordem que o Resumo executivo já praticava com o
 * cartão "Qualidade da auditoria".
 *
 * É também o único andar que lê fontes fora de `/changes` (`/balance` e
 * `/imports`), e o único que responde por *como sabemos* em vez de por *quanto
 * foi*.
 *
 * **É aqui que mora a cobertura auditada** — células alcançadas ÷ células
 * importadas —, e é essa mudança de lugar que conserta o defeito que a seção
 * tinha: o Impacto Líquido publicava "Cobertura financeira" e o Resumo
 * executivo publicava "Cobertura auditada", as duas em percentual, as duas num
 * anel, as duas coloridas pela mesma régua. Quem abria as duas telas na mesma
 * vigência via dois números do mesmo recorte sem pista de que falavam de
 * populações diferentes. Agora a da apuração fica no placar, qualificando o
 * líquido, e a auditada fica aqui, qualificando o dado — separadas por assunto,
 * e cada uma dizendo por extenso do que é percentual.
 */
export function Procedencia({ procedencia }: { procedencia: DadosDaProcedencia }) {
  const { cobertura, qualidade, integridade, ultima } = procedencia;

  return (
    <section
      className="bg-card border rounded-xl shadow-sm px-6 py-5"
      aria-label="A procedência dos números"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold">De onde vêm estes números</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Medidas da apuração, não da remuneração
          </p>
        </div>
        <Link
          href="/rastreio-de-dados"
          className="text-xs font-semibold text-brand hover:underline"
        >
          Rastreio de Dados →
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-3 mt-5">
        {cobertura && (
          <Medida
            icone={ShieldCheck}
            rotulo="Cobertura auditada"
            valor={escreverPercentual(cobertura.percentual, 1)}
            tom={qualidade?.tom ?? null}
            /*
              O rótulo diz "das células importadas" por extenso, e não "%
              coberto". Chamar de "% do valor importado" daria a um número de
              massa a autoridade de um número de remuneração — a nota original
              de `cobertura`, em `lib/visao-geral.ts`.
            */
            nota={`das células importadas · ${cobertura.celulas.toLocaleString("pt-BR")} conferidas em ${cobertura.importacoes} ${
              cobertura.importacoes === 1 ? "importação" : "importações"
            }`}
          />
        )}

        {integridade && (
          <Medida
            icone={Database}
            rotulo={integridade.titulo}
            valor={integridade.ok ? "íntegro" : "atenção"}
            tom={integridade.ok ? "ok" : "grave"}
            nota={integridade.detalhe}
          />
        )}

        {ultima && (
          <Medida
            icone={CloudDownload}
            rotulo="Última importação"
            valor={ultima.hora}
            tom={null}
            nota={`${ultima.relativo} · ${ultima.filename}`}
          />
        )}
      </div>

      {cobertura && cobertura.foraDaAuditoria > 0 && (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          {cobertura.foraDaAuditoria.toLocaleString("pt-BR")}{" "}
          {cobertura.foraDaAuditoria === 1 ? "célula ficou" : "células ficaram"} fora da auditoria
          — o Rastreio de Dados diz quais e por quê.
        </p>
      )}

      {cobertura && cobertura.foraDaAuditoria === 0 && (
        <p className="text-xs text-muted-foreground leading-snug mt-5 pt-4 border-t">
          Toda célula que os arquivos trouxeram chegou a um destino declarado.
        </p>
      )}
    </section>
  );
}

function Medida({
  icone: Icone,
  rotulo,
  valor,
  tom,
  nota,
}: {
  icone: typeof ShieldCheck;
  rotulo: string;
  valor: string;
  tom: Tom | null;
  nota: string;
}) {
  return (
    <div className="flex gap-3 min-w-0">
      <span className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
        <Icone className={cn("w-4 h-4", tom ? COR_DO_TOM[tom] : "text-brand")} strokeWidth={2.25} />
      </span>
      <div className="min-w-0">
        <p className={cn("text-lg font-extrabold leading-tight", tom ? COR_DO_TOM[tom] : "")}>
          {valor}
        </p>
        <p className="text-[0.8125rem] font-semibold leading-tight mt-0.5">{rotulo}</p>
        <p className="text-xs text-muted-foreground leading-snug mt-1">{nota}</p>
      </div>
    </div>
  );
}
