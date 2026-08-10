import { motion } from 'framer-motion';

export function Scene4_Outro() {
  return (
    <motion.div
      className="absolute inset-0 flex flex-col items-center justify-center w-full h-full bg-indigo-600 text-white"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, filter: 'blur(20px)' }}
      transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-indigo-500 via-indigo-600 to-indigo-950" />
      
      {/* Moving lines background */}
      <div className="absolute inset-0 overflow-hidden opacity-30">
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute h-px bg-white w-full"
            style={{ top: `${20 + i * 15}%` }}
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ duration: 3 + i, repeat: Infinity, ease: 'linear' }}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.8, type: 'spring', bounce: 0.5 }}
          className="mb-12 font-black tracking-tighter text-8xl lg:text-[8vw] text-transparent bg-clip-text bg-gradient-to-br from-white to-indigo-200"
        >
          FreightCheck
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
          className="overflow-hidden"
        >
          <p className="text-4xl lg:text-[2.5vw] font-light text-indigo-100 tracking-wide flex">
            {'Previsibilidade em cada centavo.'.split(' ').map((word, i) => (
              <motion.span
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.8 + i * 0.1 }}
                className="mr-2"
              >
                {word}
              </motion.span>
            ))}
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}