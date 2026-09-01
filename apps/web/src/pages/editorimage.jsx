import { useState } from 'react';
import { Rnd } from 'react-rnd';
import ssbLogo from '../assets/ssb.png';

const CANVAS_W = 800;
const CANVAS_H = 500;

export default function EditorImage() {
  const [selected, setSelected] = useState(false);
  const [state, setState] = useState({ x: 100, y: 100, width: 240, height: 160 });

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-slate-50 min-h-screen">
      <h1 className="text-sm font-bold text-slate-700">Image Editor</h1>

      {}
      <div
        style={{ width: CANVAS_W, height: CANVAS_H, position: 'relative', overflow: 'hidden' }}
        className="bg-white border-2 border-slate-300"
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(false);
        }}
      >
        <Rnd
          size={{ width: state.width, height: state.height }}
          position={{ x: state.x, y: state.y }}
          bounds="parent"
          lockAspectRatio
          onDragStop={(_, d) => setState((s) => ({ ...s, x: d.x, y: d.y }))}
          onResizeStop={(_, __, ref, ___, pos) =>
            setState({
              x: pos.x,
              y: pos.y,
              width: parseInt(ref.style.width),
              height: parseInt(ref.style.height),
            })
          }
          style={{
            border: selected ? '2px dashed #0096c7' : '2px dashed transparent',
            boxSizing: 'border-box',
          }}
          onClick={() => setSelected(true)}
        >
          <img
            src={ssbLogo}
            alt="editable"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              pointerEvents: 'none',
              display: 'block',
            }}
          />
        </Rnd>
      </div>

      {}
      <div className="flex items-center gap-3">
        <button
          onClick={() => console.log('Position & Size:', state)}
          className="px-4 py-2 text-xs font-semibold bg-[#0096c7] hover:bg-[#0077b6]
                     text-white rounded-lg transition-all active:scale-95"
        >
          Log State
        </button>
        <span className="text-xs text-slate-400 font-mono">
          x:{state.x} y:{state.y} w:{state.width} h:{state.height}
        </span>
      </div>
    </div>
  );
}
