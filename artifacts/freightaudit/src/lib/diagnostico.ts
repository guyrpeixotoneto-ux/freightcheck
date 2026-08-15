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

export type CodigoDeAcao =
  | "APLICAR_MIGRATIONS"
  | "ADOTAR_MIGRATIONS"
  | "INVESTIGAR_FALHA"
  | "CONFERIR_SCHEMA"
  | "CONFIGURAR_DATABASE_URL"
  | "RESTABELECER_BANCO";

export interface Acao {
  codigo: CodigoDeAcao;
  texto: string;
  comando?: string;
  quem: "operador" | "plataforma";
}

export interface Diagnostico {
  estado: EstadoDoBanco;
  resumo: string;
  risco: { emRisco: boolean; texto: string };
  acao: Acao | null;
  evidencia?: string;
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
