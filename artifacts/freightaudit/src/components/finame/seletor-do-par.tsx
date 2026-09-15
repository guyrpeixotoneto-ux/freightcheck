import { ArrowLeftRight, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Uma vigência que pode ser escolhida como ponta. */
export interface VigenciaEscolhivel {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
}

/**
 * Os dois seletores de vigência — e o botão que inverte o par.
 *
 * ---------------------------------------------------------------------------
 * Por que inverter não é trocar o sinal na tela
 * ---------------------------------------------------------------------------
 * Porque o percentual não é simétrico. Ir de 100 para 110 é +10,0%; voltar de
 * 110 para 100 é −9,09%, e não −10,0% — a base do percentual passou a ser a
 * outra ponta. Uma tela que negasse o sinal do número que já tem mostraria
 * −10,0% na volta, que é um número que não existe.
 *
 * Então o botão troca os dois parâmetros e **pede o par invertido ao motor**,
 * que calcula B×A de verdade. É mais uma consulta e é a única forma de o número
 * continuar verdadeiro.
 *
 * As opções são exatamente as vigências que o acervo entregou (`/snapshots`),
 * nunca um calendário: um seletor de datas ofereceria meses que não existem, e
 * a recusa viria depois do clique.
 */
export function SeletorDoPar({
  vigencias,
  base,
  comparada,
  onBase,
  onComparada,
  onInverter,
  carregando = false,
}: {
  vigencias: VigenciaEscolhivel[];
  base: string;
  comparada: string;
  onBase: (id: string) => void;
  onComparada: (id: string) => void;
  onInverter: () => void;
  carregando?: boolean;
}) {
  const rotulo = (v: VigenciaEscolhivel) =>
    `${v.sourceLabel} · ${v.effectiveDate.split("-").reverse().join("/")}`;

  return (
    <section className="superficie px-4 py-3" aria-label="Par de vigências">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor="finame-base"
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Vigência Base
          </label>
          <Select value={base} onValueChange={onBase}>
            <SelectTrigger id="finame-base" aria-label="Vigência Base">
              <SelectValue placeholder="Escolha a vigência base" />
            </SelectTrigger>
            <SelectContent>
              {vigencias.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {rotulo(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onInverter}
          disabled={carregando || !base || !comparada}
          aria-label="Inverter a vigência base com a comparada"
          className="gap-2"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Inverter
        </Button>

        <div className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor="finame-comparada"
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Vigência Comparada
          </label>
          <Select value={comparada} onValueChange={onComparada}>
            <SelectTrigger id="finame-comparada" aria-label="Vigência Comparada">
              <SelectValue placeholder="Escolha a vigência comparada" />
            </SelectTrigger>
            <SelectContent>
              {vigencias.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {rotulo(v)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="mt-3 flex items-start gap-2 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          Inverter troca o par pedido ao motor: a diferença muda de sinal, e a variação
          muda de sinal <strong className="font-semibold">mas não de magnitude</strong> —
          a base do percentual passa a ser a outra vigência.
        </span>
      </p>
    </section>
  );
}
