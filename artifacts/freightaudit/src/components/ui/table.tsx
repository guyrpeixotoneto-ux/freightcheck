import * as React from "react"
import { cn } from "@/lib/utils"

/*
 * A tabela — o objeto mais usado do produto, e o que menos tinha decisão.
 *
 * Três mudanças, e nenhuma delas mexe em coluna, ordenação ou dado:
 *
 * 1. **O cabeçalho ganhou fundo e versalete.** Ele era texto cinza do mesmo
 *    tamanho do conteúdo, separado por uma linha; numa tabela de doze colunas
 *    que rola, a primeira linha de dados e o cabeçalho se confundiam à
 *    primeira vista. Fundo esmaecido mais caixa alta em corpo menor é o que
 *    faz o cabeçalho ser lido como régua, e não como o primeiro registro.
 * 2. **As linhas divisoras esmaeceram.** Doze linhas cheias empilhadas viram
 *    uma grade, e a grade compete com o número que ela deveria estar
 *    organizando. A 60% elas continuam guiando o olho pela linha sem desenhar
 *    a caixa.
 * 3. **A linha sob o cursor esfria para o azul do produto** (`accent`), e não
 *    para o cinza. É a mesma cor do item aceso do menu e da linha selecionada
 *    — três lugares em que "isto aqui" já queria dizer a mesma coisa.
 */

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
))
Table.displayName = "Table"

const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("bg-muted/50 [&_tr]:border-b [&_tr]:border-border/70", className)} {...props} />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn("border-t bg-muted/50 font-semibold [&>tr]:last:border-b-0", className)} {...props} />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(({ className, ...props }, ref) => (
  <tr ref={ref} className={cn("border-b border-border/60 transition-colors hover:bg-accent/50 data-[state=selected]:bg-accent", className)} {...props} />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <th ref={ref} className={cn("h-10 px-4 text-left align-middle text-3xs font-bold uppercase tracking-[0.08em] text-muted-foreground whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)} {...props} />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]", className)} {...props} />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<HTMLTableCaptionElement, React.HTMLAttributes<HTMLTableCaptionElement>>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
))
TableCaption.displayName = "TableCaption"

export { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell, TableCaption }
