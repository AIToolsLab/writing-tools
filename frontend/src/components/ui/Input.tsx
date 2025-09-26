import React from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export default function Input({ label, className = '', ...rest }: InputProps) {
  return (
    <label className={`block text-sm text-gray-700 ${className}`}>
      {label ? <span className="block mb-1">{label}</span> : null}
      <input
        className="w-full rounded-md border border-gray-200 px-3 py-2 focus:outline-none focus:ring focus:ring-indigo-200"
        {...rest}
      />
    </label>
  );
}
