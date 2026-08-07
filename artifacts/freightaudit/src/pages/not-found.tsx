import { Layout } from "@/components/layout/layout";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <Layout>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center text-center max-w-md">
          <h1 className="text-6xl font-bold text-muted-foreground mb-4">404</h1>
          <h2 className="text-2xl font-semibold mb-2">Página não encontrada</h2>
          <p className="text-muted-foreground mb-6">
            A página que você está procurando não existe ou foi movida.
          </p>
          <Link href="/" className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90">
            Voltar ao Dashboard
          </Link>
        </div>
      </div>
    </Layout>
  );
}
