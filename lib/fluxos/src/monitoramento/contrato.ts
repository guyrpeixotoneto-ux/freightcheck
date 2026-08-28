/**
 * O CONTRATO DO COLETOR — como uma métrica chega a uma etapa, e o que o motor
 * se proíbe de saber sobre ela.
 *
 * O schema deixou a costura pronta e vazia: `fluxo_etapa.chave_monitoramento` é
 * "uma chave estável e opcional — `cte.autorizacao_sefaz` — pela qual um coletor
 * de métricas ainda inexistente vai poder dizer 'o farol desta etapa é vermelho'
 * sem que nada aqui saiba o que ele mede" (`lib/db/src/schema/fluxo.ts`). Este
 * arquivo é a outra ponta dessa frase, escrita como tipo.
 *
 * ---------------------------------------------------------------------------
 * Quem decide a cor é o coletor, nunca o motor
 * ---------------------------------------------------------------------------
 *
 * A `Leitura` traz o **farol já decidido**. Não traz limite, meta, faixa nem
 * regra de comparação — e isso é a decisão principal deste desenho, não uma
 * simplificação.
 *
 * A alternativa seria o motor guardar limiares ("acima de 4% é vermelho") e
 * pintar sozinho. Custaria uma tabela de limiares, uma tela para editá-los, e
 * uma pergunta sem resposta genérica em cada métrica nova: 4% de quê, medido em
 * que janela, comparado com qual base? Quem sabe isso é quem mede. O motor que
 * pinta é o motor que precisa saber o que é um CTe — exatamente o acoplamento
 * que este módulo inteiro existe para não ter.
 *
 * Sobra para o motor uma decisão só, e ela é genérica de verdade: **dado velho
 * não é dado**. Ver `farol.ts`.
 *
 * ---------------------------------------------------------------------------
 * `SEM_DADO` é a ausência, e ela não se declara
 * ---------------------------------------------------------------------------
 *
 * Um coletor que não sabe responder por uma chave **não devolve nada para ela**.
 * Não existe `farol: "SEM_DADO"` para ele emitir — por isso `FarolMedido` exclui
 * o valor. Silêncio, coletor que quebrou, coletor que não respondeu a tempo e
 * chave que ninguém reclamou produzem todos o mesmo estado na tela, que é o
 * estado honesto: não sei.
 *
 * O que **não** acontece em nenhum desses casos é a etapa ficar verde. Verde é
 * uma afirmação, e só um coletor pode fazê-la.
 */

/** As cores que um coletor pode afirmar. */
export type FarolMedido = "VERDE" | "AMARELO" | "VERMELHO";

/** O que a etapa mostra — as três acima, mais a ausência. */
export type Farol = FarolMedido | "SEM_DADO";

/**
 * A gravidade, para ordenar e para tirar o pior de um conjunto.
 *
 * `SEM_DADO` fica **fora** da escala, e não em `0`. Somar ausência com verde
 * numa mesma régua é o que produz o resumo mentiroso "fluxo verde" quando
 * metade das etapas não tem coletor nenhum. Ver `resumoDoFluxo`, em `farol.ts`,
 * onde as duas contas andam separadas de propósito.
 */
export const GRAVIDADE: Readonly<Record<FarolMedido, number>> = {
  VERDE: 1,
  AMARELO: 2,
  VERMELHO: 3,
};

export interface EntradaDeFarol {
  valor: Farol;
  rotulo: string;
  descricao: string;
  /** Classes do tema do FreightCheck, como no `catalogo.ts` — nunca cor literal. */
  classe: string;
}

/**
 * O vocabulário do farol, no mesmo formato do resto do catálogo: a tela lê
 * rótulo e classe daqui em vez de carregar um `switch` por cor.
 */
export const FAROIS: readonly EntradaDeFarol[] = [
  {
    valor: "VERDE",
    rotulo: "Normal",
    descricao: "A etapa está dentro do que o coletor considera normal.",
    classe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
  },
  {
    valor: "AMARELO",
    rotulo: "Atenção",
    descricao: "A etapa saiu do normal sem chegar a ser um problema.",
    classe: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  },
  {
    valor: "VERMELHO",
    rotulo: "Problema",
    descricao: "A etapa está fora do aceitável agora.",
    classe: "border-rose-500/40 bg-rose-500/10 text-rose-600",
  },
  {
    valor: "SEM_DADO",
    rotulo: "Sem dado",
    descricao:
      "Ninguém mede esta etapa, ou a última medição venceu. Não é o mesmo que estar bem.",
    classe: "border-border bg-muted/40 text-muted-foreground",
  },
];

export function ehFarol(valor: unknown): valor is Farol {
  return FAROIS.some((f) => f.valor === valor);
}

export function ehFarolMedido(valor: unknown): valor is FarolMedido {
  return valor === "VERDE" || valor === "AMARELO" || valor === "VERMELHO";
}

/**
 * Uma medição publicada por um coletor para uma chave.
 *
 * Tudo além de `chave`, `farol` e `medidoEm` é opcional porque o mínimo já
 * pinta a etapa: um coletor que só sabe dizer "vermelho" é um coletor útil, e
 * exigir dele um número e uma unidade seria exigir que ele mentisse um.
 */
export interface Leitura {
  /** A mesma string de `fluxo_etapa.chave_monitoramento`. */
  chave: string;
  farol: FarolMedido;
  /** Quando a medição foi feita — ISO 8601. Não é quando o coletor respondeu. */
  medidoEm: string;
  /**
   * Por quanto tempo esta medição continua valendo, em segundos.
   *
   * É do coletor, e não do motor, porque a validade é uma propriedade do que se
   * mede: taxa de rejeição na SEFAZ envelhece em minutos, prazo médio de
   * recebimento envelhece em dias. Quem omite cai na validade padrão da
   * colheita — ver `farol.ts`.
   */
  validadeEmSegundos?: number;
  /** O número, quando existe. `null` para o que só tem cor. */
  valor?: number | null;
  /** `%`, `dias`, `R$`, `h` — a unidade do número acima. */
  unidade?: string | null;
  /** Uma frase curta para a etapa mostrar: "12 rejeições nas últimas 24h". */
  texto?: string | null;
}

/** O que o registro entrega a um coletor quando pede as medições dele. */
export interface PedidoDeColeta {
  /**
   * A empresa é parâmetro, como em toda função do repositório e pelo mesmo
   * motivo: um coletor que descobrisse sozinho de quem é o escopo funcionaria
   * em todos os testes de uma empresa só.
   */
  empresaId: string;
  /** Só as chaves deste coletor, e só as que algum fluxo pediu. */
  chaves: readonly string[];
  /** O instante da colheita, injetado — nenhum coletor chama `new Date()`. */
  agora: Date;
}

/**
 * O COLETOR — a única coisa que alguém precisa escrever para ligar um farol.
 *
 * Três membros, e nenhum deles é do banco de fluxos: um coletor não lê
 * `fluxo_etapa`, não sabe quantos fluxos existem e não é avisado quando alguém
 * cadastra uma etapa nova. Ele recebe chaves e devolve medições.
 *
 * O acordo tem exatamente duas cláusulas, e as duas são checadas em `colher`:
 *
 * 1. **Só se pinta o que é seu.** Leitura de chave fora dos prefixos declarados
 *    é descartada e vira falha. Sem isso, um coletor de financeiro poderia
 *    pintar de verde uma etapa fiscal, e a origem do erro seria invisível na
 *    tela.
 * 2. **Silêncio é resposta.** Não devolver uma chave é dizer "não sei sobre
 *    ela" — o que é diferente de "está tudo bem com ela".
 */
export interface Coletor {
  /**
   * A identidade, curta e estável: aparece no diagnóstico de cobertura e no
   * registro da falha quando este coletor quebra.
   */
  nome: string;
  /**
   * O que ele responde. Um prefixo termina em ponto e reivindica um espaço
   * inteiro (`"cte."`); sem ponto no fim, é uma chave exata
   * (`"cte.autorizacao_sefaz"`). Ver `registro.ts` para quem ganha quando dois
   * coletores alcançam a mesma chave.
   */
  prefixos: readonly string[];
  ler(pedido: PedidoDeColeta): Promise<readonly Leitura[]>;
}
