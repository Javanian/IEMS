import React from 'react';

const Button = ({
  children,
  variant = 'primary',
  size = 'default',
  icon,
  iconPosition = 'top',
  onClick,
  disabled = false,
  className = '',
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center gap-1 font-semibold rounded-xl cursor-pointer transition duration-200 relative text-center select-none active:scale-[0.98] disabled:active:scale-100';

  const variantClasses = {
    primary: 'border border-transparent bg-brand-600 text-white shadow-glow hover:bg-brand-700',
    success: 'border border-transparent bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
    danger: 'border border-transparent bg-red-600 text-white shadow-sm hover:bg-red-700',
    warning: 'border border-transparent bg-amber-500 text-slate-900 shadow-sm hover:bg-amber-600',
    secondary: 'border border-slate-200 bg-white text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50',
  };

  const sizeClasses = {
    small: 'px-3 py-2.5 text-sm w-[100px] h-[50px]',
    small2: 'px-3 py-1.5 text-sm flex-col h-full w-[150px]',
    default: 'px-4 py-3.5 text-sm',
    icon: 'flex-col p-4 min-h-[110px]',
  };

  const iconClasses = {
    top: 'flex-col',
    left: 'flex-row',
    right: 'flex-row-reverse',
  };

  return (
    <button
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${icon ? iconClasses[iconPosition] : ''}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {icon && size === 'icon' && (
        <img src={icon} alt="" className={`w-8 h-8 mb-1.5 ${variant === 'secondary' ? '' : 'invert'}`} />
      )}
      {icon && size !== 'icon' && <img src={icon} alt="" className="w-5 h-5" />}
      <span
        className={
          size === 'icon' ? 'text-sm font-semibold leading-tight max-w-[100px] break-words' : ''
        }
      >
        {children}
      </span>
    </button>
  );
};

export default Button;
