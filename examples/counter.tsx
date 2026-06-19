import { useState } from "react";

export default function Counter() {
  const [n, setN] = useState(0);
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-100">
      <div className="text-center space-y-6">
        <p className="text-sm uppercase tracking-widest text-slate-400">conjured with react</p>
        <div className="text-7xl font-bold tabular-nums bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
          {n}
        </div>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => setN((v) => v - 1)}
            className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 transition"
          >
            −
          </button>
          <button
            onClick={() => setN(0)}
            className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 active:scale-95 transition text-slate-400"
          >
            reset
          </button>
          <button
            onClick={() => setN((v) => v + 1)}
            className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 active:scale-95 transition"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
