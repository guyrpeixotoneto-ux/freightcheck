import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    onChange();
    /*
      Sem `matchMedia` — jsdom dos testes, e qualquer runtime sem a API — a
      largura ainda responde: a leitura inicial vale, só não acompanha a
      rotação da tela. Antes, o hook derrubava a árvore inteira no efeito.
    */
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return !!isMobile;
}
