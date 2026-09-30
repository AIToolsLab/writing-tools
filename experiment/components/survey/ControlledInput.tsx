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
  otherOption?: string;
  exclusiveOption?: string;
}

export default function ControlledInput({
  questionId,
  type,
  placeholder,
  options = [],
  label,
  required = false,
  multiline = true,
  otherOption,
  exclusiveOption,
}: ControlledInputProps) {
  const [inputs, setInputs] = useAtom(surveyInputAtom);
  const value = inputs[questionId] ?? '';
  const otherKey = `${questionId}_other`;

  const otherTextBox = otherOption && (
    <input
      type="text"
      value={String(inputs[otherKey] ?? '')}
      onChange={(e) =>
        setInputs((prev) => ({ ...prev, [otherKey]: e.target.value }))
      }
      placeholder="Please specify"
      aria-label={`${otherOption}: please specify`}
      required
      className="ml-6 w-80 max-w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  );

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
        {value === otherOption && otherTextBox}
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
                let newChecked: string[];
                if (!e.target.checked) {
                  newChecked = checked.filter((item) => item !== option);
                } else if (option === exclusiveOption) {
                  newChecked = [option];
                } else {
                  newChecked = [
                    ...checked.filter((item) => item !== exclusiveOption),
                    option,
                  ];
                }
                handleChange(newChecked);
              }}
              // Requiring every box while none is checked makes the browser
              // demand at least one selection
              required={required && checked.length === 0}
            />
            {option}
          </label>
        ))}
        {otherOption && checked.includes(otherOption) && otherTextBox}
      </fieldset>
    );
  }

  return null;
}
