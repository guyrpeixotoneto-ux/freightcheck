import {
  AlertTriangle,
  FileText,
  Flag,
  GitBranch,
  Play,
  Server,
  ShieldCheck,
  Square,
  type LucideIcon,
} from "lucide-react";

/**
 * OS ÍCONES DO CATÁLOGO — a tradução do nome para o desenho, num lugar só.
 *
 * O catálogo servido pela API manda o **nome** do ícone (`"ShieldCheck"`), e
 * não o componente: um `lucide-react` do lado do servidor seria uma biblioteca
 * de interface dentro do motor. A tradução, então, é da tela — e mora aqui,
 * porque três telas precisam dela: a paleta de elementos, o cartão do canvas e
 * a legenda.
 *
 * Uma cópia por tela é o caminho conhecido para um tipo novo aparecer com
 * ícone na paleta e sem ícone no cartão — e isso não parece um defeito, parece
 * um cartão feio, que é o tipo de coisa que ninguém abre chamado para relatar.
 *
 * Nome que o mapa não conhece devolve `null`, e quem desenha decide o que fazer
 * — nunca um ícone errado no lugar do que falta.
 */
const ICONES: Record<string, LucideIcon> = {
  Play,
  Square,
  GitBranch,
  ShieldCheck,
  FileText,
  Server,
  AlertTriangle,
  Flag,
};

export function iconeDoCatalogo(nome: string | null | undefined): LucideIcon | null {
  if (!nome) return null;
  return ICONES[nome] ?? null;
}
