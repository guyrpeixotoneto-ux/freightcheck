import { motion } from 'framer-motion';
import { ArrowRight, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Scene3_Demo() {
  const [showImpact, setShowImpact] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowImpact(true), 3500);
    return () => clearTimeout(timer);
  }, []);

  const items = [
    { label: "Diária Recife/Truck", oldVal: "R$ 850", newVal: "R$ 810", diff: "-4,7%", type: "down" },
    { label: "Custo por KM", oldVal: "R$ 2,80", newVal: "R$ 2,65", diff: "-5,4%", type: "down" },
    { label: "Taxa de Espera", oldVal: "R$ 45", newVal: "R$ 55", diff: "+22,2%", type: "up" },
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full bg-slate-950"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/10 via-transparent to-transparent" />

      <div className="z-10 w-full max-w-[85vw] px-8">
        
        {/* Header */}
        <motion.div 
          className="flex items-center justify-between mb-12"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          <h2 className="text-4xl lg:text-[3vw] font-bold flex items-center gap-6">
            <span className="text-slate-400">Snapshot</span>
            <span className="px-4 py-2 bg-slate-800 rounded-xl text-slate-300 font-mono text-3xl">Jan/2025</span>
            <ArrowRight className="text-slate-600 w-10 h-10" />
            <span className="px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-xl font-mono text-3xl border border-indigo-500/30">Abr/2025</span>
          </h2>
        </motion.div>

        {/* Diff Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl mb-8 relative text-2xl">
          
          <div className="grid grid-cols-4 gap-6 p-6 border-b border-slate-800 bg-slate-950/50 text-slate-400 font-medium">
            <div className="col-span-1">Parâmetro</div>
            <div className="col-span-1 text-right">Anterior</div>
            <div className="col-span-1 text-right">Atual</div>
            <div className="col-span-1 text-right">Variação</div>
          </div>

          <div className="divide-y divide-slate-800/50">
            {items.map((item, i) => (
              <motion.div 
                key={i}
                className="grid grid-cols-4 gap-6 p-8 items-center hover:bg-slate-800/20 transition-colors"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.8 + i * 0.4, type: 'spring' }}
              >
                <div className="col-span-1 font-medium text-slate-200">{item.label}</div>
                <div className="col-span-1 text-right font-mono text-slate-400">{item.oldVal}</div>
                <div className="col-span-1 text-right font-mono text-slate-200 flex items-center justify-end gap-3">
                  <ArrowRight className="w-6 h-6 text-slate-600" />
                  {item.newVal}
                </div>
                <div className="col-span-1 flex justify-end">
                  <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full font-mono text-xl font-bold ${
                    item.type === 'down' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}>
                    {item.type === 'down' ? <TrendingDown className="w-6 h-6" /> : <TrendingUp className="w-6 h-6" />}
                    {item.diff}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Impact Overlay overlay that slides up */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 p-10 bg-gradient-to-t from-red-950/90 to-slate-900/90 border-t border-red-500/30 backdrop-blur-md flex items-center justify-between"
            initial={{ y: 250, opacity: 0 }}
            animate={showImpact ? { y: 0, opacity: 1 } : { y: 250, opacity: 0 }}
            transition={{ duration: 0.8, type: 'spring', bounce: 0.3 }}
          >
            <div className="flex items-center gap-6">
              <div className="p-4 bg-red-500/20 rounded-full text-red-400">
                <AlertTriangle className="w-10 h-10" />
              </div>
              <div>
                <h3 className="text-red-400/80 font-bold uppercase tracking-wider text-xl mb-2">Impacto Mensal Estimado</h3>
                <p className="text-slate-300 text-xl">Projeção baseada no volume de 12 meses</p>
              </div>
            </div>
            
            <motion.div 
              className="text-6xl lg:text-[4vw] font-mono font-bold text-red-400 drop-shadow-[0_0_15px_rgba(248,113,113,0.5)]"
              initial={{ scale: 0.8 }}
              animate={showImpact ? { scale: [1, 1.1, 1] } : { scale: 0.8 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              R$ -32.140,00
            </motion.div>
          </motion.div>

        </div>
      </div>
    </motion.div>
  );
}