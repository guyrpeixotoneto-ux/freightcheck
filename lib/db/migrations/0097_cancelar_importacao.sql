-- ---------------------------------------------------------------------------
-- CANCELAR IMPORTAÇÃO — desistir é uma decisão, e decisão se registra.
-- ---------------------------------------------------------------------------
--
-- Até aqui, quem enviou o arquivo errado — ou o arquivo certo grande demais —
-- só tinha dois gestos: esperar até o fim e excluir depois, ou fechar a aba e
-- torcer. O primeiro obriga a deixar entrar para então tirar; o segundo não
-- para nada, porque o trabalho roda no servidor e não na aba.
--
-- Esta migration abre o terceiro: parar antes de entrar. Ele vale nos dois
-- momentos em que há trabalho em curso — a leitura do arquivo e a aprovação —
-- e num terceiro em que não há nenhum: a importação conferida, parada
-- esperando decisão, cuja decisão pode ser "não".
--
-- ---------------------------------------------------------------------------
-- Por que um estado novo, e não ABORTED
-- ---------------------------------------------------------------------------
--
-- ABORTED já existe e já significa uma coisa: o processo que lia morreu com um
-- reinício do servidor (ver `recuperacao.ts`). É um acidente. Cancelar é o
-- contrário — alguém decidiu —, e quem lê o histórico daqui a três meses tem de
-- poder distinguir "o servidor caiu no meio" de "mandei o arquivo errado e
-- parei". Reaproveitar o estado economizaria esta migration e custaria a
-- resposta.
--
-- ---------------------------------------------------------------------------
-- Por que o pedido mora numa tabela, e não numa coluna de import_run
-- ---------------------------------------------------------------------------
--
-- A aprovação roda dentro de uma transação que começa travando a linha do run
-- (`SELECT … FOR UPDATE`). Enquanto ela corre, qualquer `UPDATE import_run`
-- naquela linha fica na fila até ela acabar. Uma bandeira de cancelamento
-- gravada ali esperaria justamente o trabalho que ela existe para interromper:
-- o pedido só seria escrito quando a promoção terminasse, e a promoção só
-- saberia do pedido depois de não precisar mais dele.
--
-- Numa tabela à parte não há disputa: quem cancela grava na hora, e quem
-- trabalha lê na publicação de progresso que ele já fazia de qualquer jeito.
--
-- `atendido_em` separa o pedido feito do pedido cumprido. Chegar tarde é caso
-- normal: entre o clique e a escrita o trabalho pode ter acabado, e aí o run
-- termina como terminaria, com a linha do pedido guardada e não atendida — o
-- que permite dizer "não deu tempo" em vez de mostrar um cancelamento que não
-- cancelou coisa nenhuma.
--
-- ---------------------------------------------------------------------------
-- E as duas colunas de import_run, que são a outra metade da mesma mudança
-- ---------------------------------------------------------------------------
--
-- A aprovação saiu de dentro da requisição. Ela levava minutos com a conexão
-- aberta — 75 s só a transação, medidos com 314 mil fatos — e o proxy cortava
-- antes do fim: a transação voltava atrás inteira e o run reaparecia em
-- PREVIEWED pedindo a aprovação que a pessoa já tinha dado. Visto na tela, com
-- estas palavras: "Veio uma resposta, e ela não é da nossa API". Agora a rota
-- responde 202 e o trabalho segue destacado.
--
-- `promotion_report` é onde passa a morar o relatório que voltava no corpo da
-- resposta — vigências gravadas, nós de taxonomia garantidos, semânticas
-- aplicadas, pares comparados e o que ficou para trás. Sem ele, uma importação
-- de três minutos terminaria dizendo apenas "aprovada".
--
-- `promocao_em` é a hora em que a aprovação começou, e existe porque a reserva
-- do estado PROMOTING passou a ser comitada antes da transação: o `ROLLBACK`
-- já não a desfaz, e um reinício no meio da gravação deixaria o run em
-- PROMOTING para sempre. É por ela que a varredura de órfãs mede a idade de
-- uma aprovação — nunca por `started_at`, que é o começo do run e inclui o
-- tempo, às vezes de dias, em que o arquivo ficou esperando decisão.
-- ---------------------------------------------------------------------------

ALTER TYPE "public"."import_run_status" ADD VALUE IF NOT EXISTS 'CANCELLED';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_cancelamento" (
	"import_run_id" uuid PRIMARY KEY NOT NULL,
	"pedido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"pedido_por" text,
	"motivo" text,
	"atendido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "promotion_report" jsonb;--> statement-breakpoint
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "promocao_em" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'import_cancelamento_import_run_id_import_run_id_fk'
	) THEN
		ALTER TABLE "import_cancelamento" ADD CONSTRAINT "import_cancelamento_import_run_id_import_run_id_fk"
			FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;