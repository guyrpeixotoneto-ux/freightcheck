-- A viagem inteira do 2Art, e não só as quinze colunas que a conta soma.
--
-- `fechamento_viagem` nasceu com o que a apuração precisa: dia, canal, frota,
-- caixas, frete, imposto. A escolha estava escrita no leitor — "lemos 15
-- colunas das 120; as demais entram quando uma tela precisar delas, porque uma
-- coluna lida e não usada é uma promessa de exatidão que ninguém está
-- conferindo". Uma tela passou a precisar: a **visão por dia**, que reproduz as
-- abas `01`…`31` da planilha `Fechamento_Remuneracao.xlsb` — uma aba por dia do
-- mês, uma linha por viagem, a linha inteira à vista de quem confere.
--
-- É por isso que as colunas abaixo entram agora, e não antes.
--
-- **Todas anuláveis, nenhuma com default.** O 2Art de um CDD traz colunas que o
-- de outro não traz, e a mesma exportação muda de grafia conforme quem a salvou.
-- Um `0` onde o arquivo não trouxe nada afirmaria que a viagem não pagou
-- aquilo — que é diferente de não sabermos. `NULL` é a única resposta honesta, e
-- é o traço que a tela mostra.
--
-- **Códigos são `text`, não número.** Veículo, região, transportadora,
-- matrícula e unidade de origem identificam algo; somá-los não significaria
-- nada, e o texto ainda preserva o zero à esquerda que um número perderia.
--
-- **As durações também são `text`.** O mesmo arquivo escreve `9:14` e `0:37:00`
-- na mesma coluna. Convertê-las a minutos seria decidir, sem fonte, qual das
-- duas grafias o Promax quis dizer.
--
-- Nenhuma linha existente muda de valor: as colunas nascem `NULL` nas viagens já
-- importadas, e reenviar o 2Art da competência (que substitui o documento
-- vigente e regrava as linhas) é o que as preenche.

-- ---------------------------------------------------------------------------
-- Quem rodou
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "transportadora" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "carga_atual" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "regiao" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "veiculo" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "entrega_ou_volume" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "unidade_de_origem" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "situacao_multi_cdd" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "veiculo_cadastrado_no_cdd" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "matricula_do_motorista" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "matricula_do_ajudante_1" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "matricula_do_ajudante_2" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A indisponibilidade: o veículo que não saiu, e quem saiu no lugar
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "veiculo_indisponivel" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "placa_indisponivel" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "frota_indisponivel" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tipo_de_indisponibilidade" text;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O que a viagem moveu
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "ocupacao" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "caixas_de_rota" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "caixas_de_as" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "veiculo_bm" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "r_show" numeric(14, 4);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O relógio e o hodômetro
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "hora_de_saida" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "hora_de_entrada" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "km_de_saida" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "km_de_entrada" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tempo_interno" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tempo_do_laco" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tempo_de_deslocamento" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "km_do_laco" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "km_de_deslocamento" numeric(14, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O previsto do roteirizador
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tempo_previsto" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "km_previsto" numeric(14, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O dinheiro da viagem, além do frete
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "custo_spot" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "custo_variavel" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "lucro" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "lucro_unitario" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "tipo_de_imposto" text;--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_unitario_por_caixa_entregue" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_pago_por_caixa_sem_imposto" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_pago_por_caixa_com_imposto" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_dropdown" numeric(14, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A remuneração da equipe de entrega
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_unitario_do_ponto_do_motorista" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_unitario_do_ponto_do_ajudante" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_da_equipe_de_entrega_motorista" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "valor_da_equipe_de_entrega_ajudante" numeric(14, 2);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- A abertura CEDBZ
-- ---------------------------------------------------------------------------
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "custo_variavel_cedbz" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "lucro_unitario_cedbz" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "fechamento_viagem" ADD COLUMN IF NOT EXISTS "lucro_variavel_por_caixa_entregue_ffcedbz" numeric(14, 4);
