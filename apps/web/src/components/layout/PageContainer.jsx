import React from 'react';

export const PageContainer = ({ children, className = '' }) => {
  return <div className={`flex flex-col h-full p-2.5 gap-2.5 ${className}`}>{children}</div>;
};

export const AppHeader = ({ title, rightContent, className = '' }) => {
  return (
    <div
      className={`
      flex justify-between items-center
      bg-gradient-to-br from-primary to-primary-dark
      text-white px-1.5 py-1.5 rounded-xl shadow-md
      font-semibold tracking-wide
      ${className}
    `}
    >
      <h2 className="m-0 text-xl font-bold">{title}</h2>
      {rightContent && <div>{rightContent}</div>}
    </div>
  );
};

export const StatusBar = ({ leftContent, rightContent, className = '' }) => {
  return (
    <div
      className={`
      flex justify-between items-center
      bg-[#e9ecef] px-4 py-2.5 rounded-md
      text-sm text-gray-800
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
      ${border ? 'border-2 border-gray-300' : ''}
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
      ${border ? 'border-2 border-gray-300' : ''}
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
