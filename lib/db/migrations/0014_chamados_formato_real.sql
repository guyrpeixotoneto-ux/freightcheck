-- O export de chamados do Freightech, como ele é de verdade.
--
-- As `0012` e `0013` foram escritas contra um formato suposto. O arquivo real
-- — `Chamados_<unidade>.xlsx`, aba `<mês>_EXPORTACAO_HISTORICO` — desmente três
-- suposições, e cada uma delas custa uma coluna aqui.
--
-- **1. Nem toda alteração tem valor.** Em 1218 linhas de um export real, 1167
-- (96%) trazem `-` nos dois campos de valor. A razão está na coluna `Operação`:
-- só `SET` mexe num escalar. `FORM_THIS` — 1159 das linhas — é troca de
-- fórmula, e `ADD` é inclusão de item. As duas alteram a remuneração sem que
-- exista "de 10 para 12" nenhum para mostrar.
--
-- Isso não pode virar descarte. Uma tela que só listasse o que tem valor
-- mostraria 51 alterações num arquivo de 1218 e diria, sem dizer, que o resto
-- não aconteceu. `change_kind` é o que permite listar as 1218 e explicar, uma
-- por uma, por que 1167 não têm número — em vez de deixar a coluna vazia e o
-- leitor concluir que o dado se perdeu.
--
-- **2. O chamado declara a vigência a que se refere.** `Vig. Abertura` traz
-- `EMPURRADA_1_8_2026` — exatamente o `source_label` de `snapshot`. É melhor do
-- que qualquer heurística nossa para achar o valor anterior de um parâmetro: em
-- vez de "a vigência mais recente", a que o próprio chamado nomeia.
--
-- **3. O ativo vem descrito, e nem sempre é uma placa.** A coluna `Item` traz
-- `Placa: QYW2D78 | Placa Carreta: QYW4C69` numas linhas e
-- `Cargo: Manobrista | Classificação: … | Quantidade Ordenados: 10.0` noutras.
-- A placa é extraída para `entity_label`, que é o que casa com o canônico; o
-- texto inteiro fica em `entity_description`, porque nas linhas de cargo ele é
-- a **única** identificação que existe, e jogá-lo fora deixaria a alteração
-- pairando sobre coisa nenhuma.

-- ---------------------------------------------------------------------------
-- O chamado
-- ---------------------------------------------------------------------------

-- A vigência que o próprio chamado nomeia. Casa com `snapshot.source_label`.
-- Reentrante pelo mesmo motivo da `0013`: um diff automático aceito por engano
-- deixaria estas colunas de pé sem registrar nada, e a fila morreria aqui.
DO $$
DECLARE
  achado text;
BEGIN
  SELECT string_agg(format('%s.%s é %s, esperado text', t.tabela, t.coluna, c.data_type), E'\n  ')
    INTO achado
    FROM (VALUES
      ('ticket', 'vigencia_label'), ('ticket', 'entity_description'),
      ('ticket_change', 'change_kind')
    ) AS t(tabela, coluna)
    JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = t.tabela AND c.column_name = t.coluna
   WHERE c.data_type <> 'text';
  IF achado IS NOT NULL THEN
    RAISE EXCEPTION
      E'Colunas dos chamados já existem com outro tipo:\n  %\n\nNada foi alterado.',
      achado USING ERRCODE = 'data_exception';
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "vigencia_label" text;--> statement-breakpoint

-- O ativo como o arquivo o descreve, inteiro. `entity_label` guarda a placa
-- extraída daqui quando existe uma.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "entity_description" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ticket_vigencia_idx" ON "ticket" USING btree ("vigencia_label");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A alteração
-- ---------------------------------------------------------------------------

-- SET | ADD | FORM_THIS | … — texto, e não enum, porque é vocabulário do
-- Freightech: ele inventa uma operação nova sem avisar, e uma migration não
-- pode ser pré-requisito para receber um arquivo.
ALTER TABLE "ticket_change" ADD COLUMN IF NOT EXISTS "change_kind" text;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ticket_change_kind_idx" ON "ticket_change" USING btree ("change_kind");
