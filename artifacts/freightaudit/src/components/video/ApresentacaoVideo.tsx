import { useVideoPlayer } from '@/lib/video/hooks';
import { AnimatePresence, motion } from 'framer-motion';

import { Scene0_Intro } from './scenes/Scene0_Intro';
import { Scene1_Context } from './scenes/Scene1_Context';
import { Scene2_Capabilities } from './scenes/Scene2_Capabilities';
import { Scene3_Demo } from './scenes/Scene3_Demo';
import { Scene4_Outro } from './scenes/Scene4_Outro';

const SCENE_DURATIONS = {
  intro: 3500,
  context: 4500,
  capabilities: 5500,
  demo: 7500,
  outro: 4000,
};

export default function ApresentacaoVideo() {
  const { currentScene } = useVideoPlayer({
    durations: SCENE_DURATIONS,
    loop: true,
  });

  return (
    <div className="w-full h-[100dvh] overflow-hidden relative bg-slate-950 font-sans text-slate-50">
      {/* Background layer outside AnimatePresence for continuity */}
      <motion.div 
        className="absolute inset-0 z-0"
        animate={{
          background: currentScene === 4 
            ? 'radial-gradient(ellipse at center, rgba(79, 70, 229, 0.4), rgba(15, 23, 42, 1))'
            : currentScene === 3 
              ? 'radial-gradient(ellipse at top, rgba(239, 68, 68, 0.15), rgba(15, 23, 42, 1))' 
              : 'radial-gradient(ellipse at center, rgba(79, 70, 229, 0.2), rgba(15, 23, 42, 1))'
        }}
        transition={{ duration: 1.5 }}
      />
      <div className="absolute inset-0 z-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=%220 0 200 200%22 xmlns=%22http://www.w3.org/2000/svg%22%3E%3Cfilter id=%22noiseFilter%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.65%22 numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23noiseFilter)%22/%3E%3C/svg%3E")' }} />

      <div className="relative z-10 w-full h-full flex items-center justify-center">
        <AnimatePresence mode="wait">
          {currentScene === 0 && <Scene0_Intro key="intro" />}
          {currentScene === 1 && <Scene1_Context key="context" />}
          {currentScene === 2 && <Scene2_Capabilities key="capabilities" />}
          {currentScene === 3 && <Scene3_Demo key="demo" />}
          {currentScene === 4 && <Scene4_Outro key="outro" />}
        </AnimatePresence>
      </div>
    </div>
  );
}