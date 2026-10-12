                          <span className="text-[10px] text-slate-400 ml-0.5 w-3">h</span>
                          <span className="relative inline-flex items-center justify-center ml-0.5" style={{width:14,height:14}}>
                            <span key={`alert-${o.is_exceeded ? 'red' : actualPct >= 90 ? 'yellow' : 'none'}`}
                              className={`absolute inset-0 flex items-center justify-center transition-all duration-500 ease-out ${
                                o.is_exceeded || actualPct >= 90 ? 'opacity-100 scale-100' : 'opacity-0 scale-0'
                              }`}>
                              {o.is_exceeded
                                ? <AlertCircle size={14} className="text-red-500 animate-pulse" />
                                : actualPct >= 90
                                ? <AlertTriangle size={14} className="text-amber-500 animate-pulse" />
                                : <span className="w-3 h-3" />
                              }
                            </span>
                          </span>