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
    'inline-flex items-center justify-center gap-1 font-semibold rounded-lg cursor-pointer transition-all duration-200 border-none relative text-center select-none';

  const variantClasses = {
    primary:
      'bg-gradient-to-b from-[#4da3ff] to-[#0069d9] text-white shadow-3d-primary active:translate-y-1 active:shadow-3d-primary-active',
    success:
      'bg-gradient-to-b from-[#28a745] to-[#1e7e34] text-white shadow-3d-success active:translate-y-1 active:shadow-3d-success-active',
    danger:
      'bg-gradient-to-b from-[#ff6b6b] to-[#c82333] text-white shadow-3d-danger active:translate-y-1 active:shadow-3d-danger-active',
    warning:
      'bg-gradient-to-b from-[#ffd966] to-[#e0a800] text-[#212529] shadow-3d-warning active:translate-y-1 active:shadow-3d-warning-active',
    secondary:
      'bg-gradient-to-b from-[#adb5bd] to-[#6c757d] text-white shadow-3d-secondary active:translate-y-1 active:shadow-3d-secondary-active',
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
      {icon && size === 'icon' && <img src={icon} alt="" className="w-8 h-8 mb-1.5 invert" />}
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
