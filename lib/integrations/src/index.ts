/**
 * INTEGRAÇÕES — o vocabulário da porta de API, sem banco e sem HTTP.
 *
 * O pacote guarda o que precisa estar certo antes de existir requisição: o
 * formato da credencial (`chave.ts`), o catálogo do que uma chave alcança
 * (`escopos.ts`) e a decisão do portão (`decisao.ts`). Nada aqui abre conexão,
 * lê tabela ou responde status — o que é o que permite testar a regra inteira
 * numa suíte que roda em milissegundos.
 *
 * Quem usa: `artifacts/api-server` — o middleware que autentica a chamada
 * externa e as rotas de gestão da tela de Integrações. O desenho inteiro, com
 * o que existe hoje e o que vem depois, está em `docs/INTEGRACOES.md`.
 */
export {
  CABECALHO_DA_CHAVE,
  FORMATO_DA_CHAVE,
  PREFIXO_DA_CHAVE,
  chaveApresentada,
  chaveConfere,
  emitirChave,
  hashDaChave,
  prefixoDe,
  type ChaveEmitida,
} from "./chave";
export {
  CATALOGO_DE_ESCOPOS,
  ESCOPOS,
  alcanca,
  descrever,
  ehEscopo,
  escoposConhecidos,
  type DescricaoDeEscopo,
  type Escopo,
} from "./escopos";
export {
  decidir,
  mensagemDaRecusa,
  recusar,
  statusDaRecusaDeChave,
  type ChaveGuardada,
  type Decisao,
  type MotivoDaRecusa,
} from "./decisao";
export {
  IntegracaoNaoEncontrada,
  NomeDeIntegracaoJaUsado,
  RecusaDeIntegracao,
  conferirDadosDaIntegracao,
  type DadosDaIntegracao,
} from "./recusas";
