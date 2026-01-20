'use client';

import { useAtom } from 'jotai';
import { surveyInputAtom } from '@/contexts/StudyContext';
import { QuestionType } from './types';

interface ControlledInputProps {
  questionId: string;
  type: QuestionType;
  placeholder?: string;
  options?: string[];
  label?: string;
  required?: boolean;
  multiline?: boolean;
}

export default function ControlledInput({
  questionId,
  type,
  placeholder,
  options = [],
  label,
  required = false,
  multiline = true,
}: ControlledInputProps) {
  const [inputs, setInputs] = useAtom(surveyInputAtom);
  const value = inputs[questionId] ?? '';

  const handleChange = (newValue: unknown) => {
    setInputs((prev) => ({
      ...prev,
      [questionId]: newValue,
    }));
  };

  if (type === 'text') {
    const baseClassName = "w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500";

    if (multiline) {
      return (
        <textarea
          value={String(value)}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={3}
          className={baseClassName}
        />
      );
    }

    return (
      <input
        type="text"
        value={String(value)}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className={baseClassName}
      />
    );
  }

  if (type === 'likert' || type === 'radio') {
    return (
      <fieldset className="space-y-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="radio"
              name={questionId}
              value={option}
              checked={value === option}
              onChange={(e) => handleChange(e.target.value)}
              required={required}
            />
            {option}
          </label>
        ))}
      </fieldset>
    );
  }

  if (type === 'checkbox') {
    const checked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        {options.map((option) => (
          <label key={option} className="flex items-center gap-2">
            <input
              type="checkbox"
              value={option}
              checked={checked.includes(option)}
              onChange={(e) => {
                const newChecked = e.target.checked
                  ? [...checked, option]
                  : checked.filter((item) => item !== option);
                handleChange(newChecked);
              }}
            />
            {option}
          </label>
        ))}
      </fieldset>
    );
  }

  return null;
}
