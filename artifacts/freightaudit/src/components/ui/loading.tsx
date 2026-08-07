import { Loader2 } from "lucide-react";

export function LoadingSpinner({ className }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className || "w-6 h-6"}`} />;
}

export function PageLoading() {
  return (
    <div className="flex flex-1 items-center justify-center p-8 h-[calc(100vh-4rem)]">
      <div className="flex flex-col items-center gap-4 text-muted-foreground">
        <LoadingSpinner className="w-8 h-8 text-primary" />
        <p className="text-sm font-medium animate-pulse">Carregando dados...</p>
      </div>
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex flex-col items-center gap-4 max-w-md text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
          <span className="font-bold text-xl">!</span>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-1">Erro ao carregar dados</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {error instanceof Error ? error.message : "Ocorreu um erro inesperado. Tente novamente mais tarde."}
          </p>
          {retry && (
            <button
              onClick={retry}
              className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2"
            >
              Tentar novamente
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
