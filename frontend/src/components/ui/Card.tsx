import React from 'react';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  elevated?: boolean;
};

export default function Card({ elevated = true, className = '', children, ...rest }: CardProps) {
  const base = 'rounded-lg p-4 bg-white text-gray-900';
  const elevation = elevated ? 'shadow-sm' : '';
  return (
    <div className={`${base} ${elevation} ${className}`} {...rest}>
      {children}
    </div>
  );
}
