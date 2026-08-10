import { motion } from 'framer-motion';
import { Network, Database, ShieldCheck } from 'lucide-react';

export function Scene0_Intro() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1, filter: 'blur(10px)' }}
      transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Dynamic Grid Background */}
      <div className="absolute inset-0 overflow-hidden opacity-20">
        <motion.div 
          className="w-[200vw] h-[200vh] absolute -top-[50vh] -left-[50vw]"
          style={{
            backgroundImage: 'linear-gradient(to right, #4f46e5 1px, transparent 1px), linear-gradient(to bottom, #4f46e5 1px, transparent 1px)',
            backgroundSize: '4rem 4rem',
            transformOrigin: 'center',
          }}
          initial={{ rotateX: 60, rotateZ: 0, scale: 1, y: 0 }}
          animate={{ rotateZ: 20, y: [0, -100] }}
          transition={{ duration: 10, ease: 'linear', repeat: Infinity }}
        />
      </div>

      {/* Floating abstract tech elements */}
      <motion.div
        className="absolute top-[20%] left-[30%] text-indigo-400 opacity-50"
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: [-10, 10, -10], opacity: [0, 0.5, 0] }}
        transition={{ duration: 4, repeat: Infinity }}
      >
        <Network size={64} strokeWidth={1} />
      </motion.div>
      <motion.div
        className="absolute bottom-[20%] right-[30%] text-emerald-400 opacity-50"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: [10, -10, 10], opacity: [0, 0.5, 0] }}
        transition={{ duration: 5, delay: 1, repeat: Infinity }}
      >
        <Database size={80} strokeWidth={1} />
      </motion.div>

      {/* Central Content */}
      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 1, type: 'spring', bounce: 0.4 }}
          className="mb-8 flex items-center justify-center w-32 h-32 md:w-40 md:h-40 rounded-3xl bg-indigo-600/20 border border-indigo-500/30 backdrop-blur-md shadow-[0_0_40px_rgba(79,70,229,0.3)]"
        >
          <ShieldCheck className="w-16 h-16 md:w-20 md:h-20 text-indigo-400" />
        </motion.div>

        <motion.h1 
          className="text-6xl md:text-8xl lg:text-[7vw] font-bold tracking-tight text-white mb-8 font-sans flex"
          style={{ perspective: 1000 }}
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.05 } }
          }}
        >
          {'FreightCheck'.split('').map((char, i) => (
            <motion.span
              key={i}
              variants={{
                hidden: { y: 100, opacity: 0, rotateX: -90 },
                visible: { y: 0, opacity: 1, rotateX: 0 }
              }}
              transition={{ duration: 0.8, type: 'spring', bounce: 0.4 }}
              className="inline-block drop-shadow-2xl"
            >
              {char}
            </motion.span>
          ))}
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 20, filter: 'blur(10px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          transition={{ duration: 1, delay: 0.8 }}
          className="relative"
        >
          <div className="absolute inset-0 bg-indigo-500/20 blur-xl rounded-full" />
          <p className="text-2xl md:text-4xl lg:text-[2.5vw] font-mono text-indigo-200 tracking-wider relative z-10 px-8 py-4 border border-indigo-500/30 rounded-full bg-slate-900/50 backdrop-blur-sm">
            O Git dos Contratos de Frete
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}