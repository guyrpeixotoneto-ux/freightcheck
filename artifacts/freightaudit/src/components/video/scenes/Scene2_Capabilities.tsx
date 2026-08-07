import { motion } from 'framer-motion';
import { Camera, ArrowLeftRight, ActivitySquare, ShieldAlert } from 'lucide-react';

export function Scene2_Capabilities() {
  const capabilities = [
    {
      icon: <Camera className="w-8 h-8 text-indigo-400" />,
      title: "Snapshots Imutáveis",
      desc: "Cada versão é capturada e salva."
    },
    {
      icon: <ArrowLeftRight className="w-8 h-8 text-emerald-400" />,
      title: "Diff Automático",
      desc: "Compara parâmetro a parâmetro."
    },
    {
      icon: <ActivitySquare className="w-8 h-8 text-orange-400" />,
      title: "Simulação de Impacto",
      desc: "Projeta o impacto financeiro."
    },
    {
      icon: <ShieldAlert className="w-8 h-8 text-cyan-400" />,
      title: "Auditoria Completa",
      desc: "Histórico detalhado de mudanças."
    }
  ];

  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 z-0 flex items-center justify-center opacity-10">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 40, ease: 'linear', repeat: Infinity }}
          className="w-[800px] h-[800px] border-[1px] border-dashed border-indigo-500 rounded-full"
        />
        <motion.div
          animate={{ rotate: -360 }}
          transition={{ duration: 50, ease: 'linear', repeat: Infinity }}
          className="absolute w-[600px] h-[600px] border-[1px] border-dashed border-emerald-500 rounded-full"
        />
      </div>

      <div className="z-10 w-full max-w-[80vw] px-8 flex flex-col items-center">
        <motion.h2
          className="text-6xl md:text-7xl lg:text-[5vw] font-bold mb-20 text-center"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
        >
          Visibilidade total em <span className="text-indigo-400">cada etapa</span>
        </motion.h2>

        <div className="grid grid-cols-2 gap-12 w-full">
          {capabilities.map((cap, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ 
                duration: 0.8, 
                delay: 0.4 + i * 0.2, 
                type: 'spring', 
                bounce: 0.3 
              }}
              className="bg-slate-900/60 backdrop-blur-md border border-slate-800 p-10 rounded-3xl flex items-start gap-8 relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <div className="p-6 bg-slate-950 rounded-2xl border border-slate-800 shadow-inner">
                <div className="scale-150">
                  {cap.icon}
                </div>
              </div>
              <div className="flex-1">
                <h3 className="text-3xl lg:text-[2vw] font-bold text-slate-100 mb-4">{cap.title}</h3>
                <p className="text-2xl lg:text-[1.2vw] text-slate-400">{cap.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}