import React from 'react';

export const PageContainer = ({ children, className = '' }) => {
  return <div className={`flex flex-col h-full p-3 gap-3 bg-canvas ${className}`}>{children}</div>;
};

export const AppHeader = ({ title, rightContent, className = '' }) => {
  return (
    <div
      className={`
      flex justify-between items-center
      bg-surface/90 text-ink border border-slate-200/80 backdrop-blur
      px-5 py-3 rounded-2xl shadow-soft
      ${className}
    `}
    >
      <h2 className="m-0 flex items-center gap-2 text-lg font-bold tracking-tight [&_svg]:text-brand-600">{title}</h2>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
};

export const StatusBar = ({ leftContent, rightContent, className = '' }) => {
  return (
    <div
      className={`
      flex justify-between items-center
      bg-white border border-slate-200/80 px-4 py-2.5 rounded-xl shadow-sm
      text-sm text-slate-800
      ${className}
    `}
    >
      <div>{leftContent}</div>
      <div>{rightContent}</div>
    </div>
  );
};

export const ContainerHorizontal = ({ children, className = '', border = true }) => {
  return (
    <div
      className={`
      flex flex-row bg-white p-2.5 rounded-xl
      w-screen h-dvh justify-center items-center
      gap-2.5
      ${border ? 'border-2 border-slate-300' : ''}
      ${className}
    `}
    >
      {children}
    </div>
  );
};

export const ContainerVertical = ({ children, className = '', border = true }) => {
  return (
    <div
      className={`
      flex flex-col bg-white p-1.5 rounded-xl
      w-screen h-dvh justify-center items-center
      gap-2.5
      ${border ? 'border-2 border-slate-300' : ''}
      ${className}
    `}
    >
      {children}
    </div>
  );
};

export const MenuGrid = ({ children, className = '' }) => {
  return (
    <div
      className={`
      grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))]
      gap-2.5 flex-1
      ${className}
    `}
    >
      {children}
    </div>
  );
};

export default {
  PageContainer,
  AppHeader,
  StatusBar,
  ContainerHorizontal,
  ContainerVertical,
  MenuGrid,
};
