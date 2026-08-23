/**
 * O diagnóstico do banco como ele chega pela rede.
 *
 * O tipo é declarado aqui, e não importado de `@workspace/db`, pela mesma razão
 * pela qual `DatabaseHealth` já era: este bundle vai para o navegador, e o
 * módulo de origem vive num pacote que carrega o driver do Postgres. O que
 * atravessa é JSON; o que precisa existir deste lado é a forma dele.
 *
 * O que **não** está duplicado é a classificação. Nenhuma função deste arquivo
 * decide estado, escolhe ação ou escreve recomendação — isso é trabalho de
 * `diagnosticar`, no servidor, e chega pronto. Aqui só se confere que o que
 * chegou tem a forma esperada, e se desenha.
 */

export type EstadoDoBanco =
  | "SAUDAVEL"
  | "MIGRATIONS_PENDENTES"
  | "REGISTRO_PERDIDO"
  | "MIGRATION_FALHOU"
  | "SCHEMA_DIVERGENTE"
  | "INDISPONIVEL";

/**
 * Os códigos de ação dos **dois** eixos.
 *
 * Os do banco espelham `CodigoDeAcao` do servidor. Os dois últimos não têm par
 * do outro lado, e não teriam: nascem de falhas em que o servidor não chegou a
 * ser consultado, e portanto não teria como classificar coisa alguma. Ver
 * `transporte.ts`.
 *
 * **`IDENTIFICAR_QUEDA` não é um `RESTABELECER_API` mais educado.** Os dois
 * descrevem camadas diferentes e mandam fazer coisas diferentes:
 * `RESTABELECER_API` é para quando se sabe que não há ninguém atrás do `/api`
 * — houve resposta, e ela veio de uma camada anterior. `IDENTIFICAR_QUEDA` é
 * para quando não houve resposta nenhuma, e por isso **não se sabe** qual
 * camada caiu; mandar subir um processo aí é chutar. Ver `SEM_RESPOSTA`.
 */
export type CodigoDeAcao =
  | "APLICAR_MIGRATIONS"
  | "ADOTAR_MIGRATIONS"
  | "INVESTIGAR_FALHA"
  | "CONFERIR_SCHEMA"
  | "CONFIGURAR_DATABASE_URL"
  | "RESTABELECER_BANCO"
  | "RESTABELECER_API"
  | "IDENTIFICAR_QUEDA";

export interface Acao {
  codigo: CodigoDeAcao;
  texto: string;
  comando?: string;
  quem: "operador" | "plataforma";
}

/**
 * O que a tela apresenta sobre uma falha, seja qual for a camada que falhou.
 *
 * Existem dois eixos de diagnóstico, e eles são independentes: o **banco**
 * (migrations, registro, schema) e o **transporte** (a requisição chegou? o que
 * respondeu era nosso?). Nada garante que os dois concordem — com o processo
 * fora do ar, o banco pode estar impecável — e é por isso que a tela nunca pode
 * apresentar um como explicação do outro.
 *
 * Esta é a forma comum aos dois. Ter uma só é o que mantém `apresentar` com um
 * caminho de renderização único: a tela mostra **uma** orientação, e de qual
 * eixo ela veio é decisão de quem escolhe, não de quem desenha.
 */
export interface Orientacao {
  /**
   * A frase que a tela mostra como **mensagem principal**.
   *
   * Vem pronta dos dois eixos — do servidor, em `diagnosticar`; daqui, em
   * `diagnosticarTransporte` — e a regra dela é a mesma nos dois: nenhum nome
   * de migration, nenhum comando, nenhum SQLSTATE, nenhum endereço de rota. O
   * detalhe técnico continua existindo em `resumo`, `acao.comando` e
   * `evidencia`, e a tela o guarda atrás de "Detalhes técnicos".
   *
   * **Opcional porque o servidor pode ser mais velho que este bundle.** É
   * situação real neste projeto — um build anterior ainda no ar —, e um
   * diagnóstico sem `humano` precisa continuar sendo apresentável. Quem
   * desenha usa `humano ?? resumo`, que é a frase de antes: pior, e não
   * quebrada.
   */
  humano?: string;
  /** O que aconteceu, em uma ou duas frases, para quem opera o ambiente. */
  resumo: string;
  /** Os dados correm risco? Respondido sempre, nunca deixado para dedução. */
  risco: { emRisco: boolean; texto: string };
  /** O que resolve. `null` quando não há nada a fazer. */
  acao: Acao | null;
  /** O detalhe verificável, para quem investiga. */
  evidencia?: string;
}

export interface Diagnostico extends Orientacao {
  estado: EstadoDoBanco;
}

const ESTADOS: ReadonlySet<string> = new Set<EstadoDoBanco>([
  "SAUDAVEL",
  "MIGRATIONS_PENDENTES",
  "REGISTRO_PERDIDO",
  "MIGRATION_FALHOU",
  "SCHEMA_DIVERGENTE",
  "INDISPONIVEL",
]);

/**
 * O que chegou é um diagnóstico?
 *
 * Confere a forma em vez de confiar no campo. Um servidor antigo — o bundle
 * anterior ainda no ar, que é situação real neste projeto — responde sem
 * `diagnostico`, e a tela precisa cair no caminho antigo em vez de quebrar
 * lendo `.resumo` de `undefined`.
 */
export function ehDiagnostico(valor: unknown): valor is Diagnostico {
  if (typeof valor !== "object" || valor === null) return false;
  const d = valor as Record<string, unknown>;
  const risco = d["risco"] as Record<string, unknown> | undefined;
  return (
    typeof d["estado"] === "string" &&
    ESTADOS.has(d["estado"]) &&
    typeof d["resumo"] === "string" &&
    typeof risco === "object" &&
    risco !== null &&
    typeof risco["emRisco"] === "boolean" &&
    typeof risco["texto"] === "string" &&
    (d["acao"] === null || typeof d["acao"] === "object")
  );
}
