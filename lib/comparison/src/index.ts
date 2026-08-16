export * from "./series";
export * from "./classification";
export * from "./impact";
export * from "./engine";
/*
  O resultado da vigência anterior é o tipo da **autoridade**, e é reexportado
  aqui para que um consumidor de `@workspace/comparison` não precise saber de
  onde ele vem para tratar a recusa. Reexportar não é redefinir: o tipo continua
  tendo um dono só.
*/
export type { MotivoSemAnterior, ResultadoDaAnterior } from "@workspace/availability";
export * from "./garantia";
export * from "./query";
export * from "./consolidated";
export * from "./composition";
export * from "./anomalies";
export * from "./labels";
export * from "./grouped";
export * from "./cockpit";
export * from "./families";
export * from "./families-view";
export * from "./end-to-end";
export * from "./impacto";
export * from "./panorama";
export * from "./chamados";
