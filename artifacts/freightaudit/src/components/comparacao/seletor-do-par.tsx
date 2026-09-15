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
  /**
   * De qual unidade/operador é esta vigência.
   *
   * Está aqui porque o rótulo sozinho não distingue: um arquivo da Ambev traz
   * as cinco unidades juntas, então uma importação produz cinco vigências com o
   * **mesmo** `sourceLabel` e a **mesma** data — cinco linhas idênticas no
   * seletor. Comparar uma com a outra é o que o motor recusa (`engine.ts`), e
   * era o que o par padrão desta tela fazia sozinho.
   *
   * Quem recorta a lista pela unidade aberta é a página; quem escreve a unidade
   * no rótulo é `rotulosDasVigencias` (`lib/finame.ts`). O campo precisa chegar
   * aos dois.
   */
  scopeHash: string;
  /** A revisão da importação — o último desempate de rótulo. */
  revision?: number | null;
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
 *
 * ---------------------------------------------------------------------------
 * "De" e "Para", e não "Anterior" e "Atual"
 * ---------------------------------------------------------------------------
 * Os dois campos não guardam um **estado** — guardam as duas pontas de uma
 * **direção**. Chamar o da direita de "Vigência Atual" afirmaria que ele é a
 * última do acervo, e ele não é: qualquer vigência pode ser escolhida ali, e o
 * botão no meio troca as duas de lado. No clique seguinte o rótulo estaria
 * mentindo sobre o que está na caixa.
 *
 * "De" e "Para" continuam verdadeiros depois de inverter, e são o vocabulário
 * em que o resultado já é lido: a parcela saiu de X e chegou em Y. As colunas
 * da tabela e as da gaveta do veículo usam as mesmas duas palavras.
 *
 * ---------------------------------------------------------------------------
 * Por que ele mora em `components/comparacao/` e não na pasta de uma tela
 * ---------------------------------------------------------------------------
 * Porque agora são duas as telas que escolhem um par de vigências — a Auditoria
 * de FINAME e a de IPVA —, e serão mais à medida que as rubricas do Custo Fixo
 * ganharem tela. Ele nasceu em `components/finame/` e mudou de endereço no dia
 * em que a segunda chegou: uma cópia por rubrica divergiria no primeiro ajuste
 * que alguém fizesse numa e esquecesse nas outras, e o aviso sobre a
 * assimetria do percentual — que é a única coisa difícil desta peça — é o que
 * menos pode existir em duas versões.
 *
 * O que ele **não** faz é adivinhar o par. Qual vigência abre selecionada é
 * decisão da tela, que conhece a série que interessa a ela.
 */
export function SeletorDoPar({
  vigencias,
  rotulos,
  base,
  comparada,
  onBase,
  onComparada,
  onInverter,
  carregando = false,
  idPrefixo,
}: {
  vigencias: VigenciaEscolhivel[];
  /**
   * O texto de cada vigência, por id — já desempatado por quem o montou.
   *
   * Vem de fora e não é calculado aqui porque desempatar é uma decisão sobre a
   * **lista inteira**: só olhando as outras dá para saber se esta precisa dizer
   * a unidade. Um componente que escrevesse o rótulo linha a linha é
   * exatamente o que produzia cinco `EMPURRADA_1_6_2026 · 01/06/2026` seguidas.
   */
  rotulos: ReadonlyMap<string, string>;
  base: string;
  comparada: string;
  onBase: (id: string) => void;
  onComparada: (id: string) => void;
  onInverter: () => void;
  carregando?: boolean;
  /**
   * O prefixo dos `id` dos dois campos — `finame`, `ipva`.
   *
   * Existe porque `id` é global na página e `<label htmlFor>` resolve pelo
   * primeiro que encontra: duas telas com o mesmo `finame-base` funcionariam
   * até o dia em que as duas fossem montadas juntas, e então o rótulo de uma
   * passaria a focar o campo da outra.
   */
  idPrefixo: string;
}) {
  const rotulo = (v: VigenciaEscolhivel) =>
    rotulos.get(v.id) ??
    `${v.sourceLabel} · ${v.effectiveDate.split("-").reverse().join("/")}`;

  return (
    <section className="superficie px-4 py-3" aria-label="Par de vigências">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor={`${idPrefixo}-base`}
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            De
          </label>
          <Select value={base} onValueChange={onBase}>
            <SelectTrigger id={`${idPrefixo}-base`} aria-label="De (vigência de origem)">
              <SelectValue placeholder="Escolha a vigência de origem" />
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
          aria-label="Inverter: trocar a vigência de origem com a de destino"
          className="gap-2"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Inverter
        </Button>

        <div className="flex min-w-[15rem] flex-1 flex-col gap-1.5">
          <label
            htmlFor={`${idPrefixo}-comparada`}
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Para
          </label>
          <Select value={comparada} onValueChange={onComparada}>
            <SelectTrigger id={`${idPrefixo}-comparada`} aria-label="Para (vigência de destino)">
              <SelectValue placeholder="Escolha a vigência de destino" />
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
