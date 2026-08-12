import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const formatBRL = (value: number | null | undefined) => {
  if (value == null) return "R$ 0,00";
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
};

export const formatPercent = (value: number | null | undefined) => {
  if (value == null) return "0,00%";
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 100);
};

export const formatDate = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(dateString));
};

export const formatDateTime = (dateString: string | null | undefined) => {
  if (!dateString) return "-";
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateString));
};

/**
 * `cn` recebe objeto, e isso não é detalhe: sem isso nenhum botão do produto
 * tinha cor.
 *
 * A versão anterior era `classes.filter(Boolean).join(" ")`, que aceita apenas
 * strings. Só que todo componente do shadcn — `Button`, `Badge`, `chart` —
 * passa o mapa `{ "classe": condição }` que este formato descreve, e um objeto
 * dentro de um `join` vira a string literal `[object Object]`. O efeito era um
 * botão sem fundo, sem altura e sem padding em todas as telas, e nada quebrava
 * o suficiente para alguém procurar aqui: era um estilo faltando, não um erro.
 *
 * `twMerge` por cima resolve o conflito na direção certa quando quem chama
 * passa `className`: `<Button className="bg-…">` sobrescreve o fundo da
 * variante em vez de as duas classes irem juntas e a ordem da folha de estilo
 * decidir. É o contrato que estes componentes já assumiam ter.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
