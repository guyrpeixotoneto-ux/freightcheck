import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';

export function Scene1_Context() {
  const [value1, setValue1] = useState('850.00');
  const [value2, setValue2] = useState('2.80');
  
  useEffect(() => {
    const intervals = [
      setInterval(() => setValue1((850 + (Math.random() * 100 - 50)).toFixed(2)), 150),
      setInterval(() => setValue2((2.8 + (Math.random() * 0.4 - 0.2)).toFixed(2)), 200),
    ];
    return () => intervals.forEach(clearInterval);
  }, []);

  return (
    <motion.div
      className="absolute inset-0 flex items-center justify-center w-full h-full bg-slate-950"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, x: -100 }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex flex-col md:flex-row items-center justify-center gap-16 w-full max-w-[90vw] px-8">
        
        {/* Left Side: Statement */}
        <div className="flex-1 space-y-8 z-10 relative">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: 150 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="h-2 bg-indigo-500 rounded-full"
          />
          <motion.h2 
            className="text-6xl md:text-8xl lg:text-[6vw] font-bold leading-tight"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
          >
            Contratos <br/>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-orange-400">
              mudam rápido.
            </span>
          </motion.h2>
          <motion.p
            className="text-2xl md:text-3xl lg:text-[2vw] text-slate-400 max-w-2xl leading-relaxed"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.8 }}
          >
            Planilhas se perdem. Históricos somem. O impacto financeiro passa despercebido até ser tarde demais.
          </motion.p>
        </div>

        {/* Right Side: Fast changing values visualization */}
        <motion.div 
          className="flex-1 relative h-[60vh] w-full"
          initial={{ opacity: 0, x: 50 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1, delay: 0.6 }}
        >
          {/* Mockup Table changing rapidly */}
          <div className="absolute inset-0 bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col gap-6 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 pb-6">
              <div className="h-6 w-48 bg-slate-800 rounded-md"></div>
              <div className="h-6 w-32 bg-slate-800 rounded-md"></div>
            </div>
            
            <div className="space-y-8 mt-6">
              <div className="flex items-center justify-between p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                <span className="text-slate-300 font-medium text-2xl lg:text-[1.5vw]">Diária Truck</span>
                <motion.span 
                  key={value1}
                  initial={{ opacity: 0.5, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-mono text-4xl lg:text-[2.5vw] font-bold text-red-400"
                >
                  R$ {value1}
                </motion.span>
              </div>

              <div className="flex items-center justify-between p-6 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                <span className="text-slate-300 font-medium text-2xl lg:text-[1.5vw]">Custo por KM</span>
                <motion.span 
                  key={value2}
                  initial={{ opacity: 0.5, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="font-mono text-4xl lg:text-[2.5vw] font-bold text-emerald-400"
                >
                  R$ {value2}
                </motion.span>
              </div>
              
              {/* Fake glitch effect */}
              <motion.div 
                className="absolute inset-0 bg-red-500/5 mix-blend-overlay pointer-events-none"
                animate={{ opacity: [0, 0.2, 0, 0.5, 0] }}
                transition={{ duration: 2, repeat: Infinity, times: [0, 0.1, 0.2, 0.3, 1] }}
              />
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}