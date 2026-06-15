import { motion } from 'framer-motion';

const shimmerStyle = {
  background: 'linear-gradient(90deg,#1e1e28 0%,#2a2a38 50%,#1e1e28 100%)',
  backgroundSize: '200% 100%',
  animation: 'shimmer 1.8s ease-in-out infinite',
};

export default function AlbumSkeleton() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full space-y-5">
      {/* Cover + meta */}
      <div className="flex gap-5">
        <div className="w-40 h-40 sm:w-52 sm:h-52 flex-shrink-0 rounded-2xl" style={shimmerStyle} />
        <div className="flex-1 space-y-3 py-1">
          <div className="h-7 rounded-xl w-3/4" style={shimmerStyle} />
          <div className="h-4 rounded-lg w-1/2" style={shimmerStyle} />
          <div className="h-4 rounded-lg w-2/5" style={shimmerStyle} />
          <div className="flex gap-2 pt-2">
            {[1,2,3].map(i => <div key={i} className="h-6 w-20 rounded-lg" style={shimmerStyle} />)}
          </div>
          <div className="h-10 rounded-xl w-48 mt-3" style={shimmerStyle} />
        </div>
      </div>
      {/* Divider */}
      <div className="h-px bg-border" />
      {/* Track rows */}
      {Array.from({ length: 8 }).map((_, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04 }}
          className="flex items-center gap-3 py-2"
        >
          <div className="w-5 text-right flex-shrink-0" style={{ ...shimmerStyle, height: 12, width: 16, borderRadius: 4 }} />
          <div className="w-10 h-10 flex-shrink-0 rounded-lg" style={shimmerStyle} />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded w-3/5" style={shimmerStyle} />
            <div className="h-3 rounded w-2/5" style={shimmerStyle} />
          </div>
          <div className="h-3 w-9 rounded" style={shimmerStyle} />
        </motion.div>
      ))}
    </motion.div>
  );
}
