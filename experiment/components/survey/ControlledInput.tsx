'use client';

import { Fragment } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { studyParamsAtom, surveyInputAtom } from '@/contexts/StudyContext';
import { log } from '@/lib/logging';
import { QuestionType } from './types';

interface ControlledInputProps {
  questionId: string;
  type: QuestionType;
  placeholder?: string;
  options?: string[];
  label?: string;
  required?: boolean;
  multiline?: boolean;
  rows?: number;
  otherOption?: string;
  exclusiveOption?: string;
  logChanges?: boolean;
}

export default function ControlledInput({
  questionId,
  type,
  placeholder,
  options = [],
  label,
  required = false,
  multiline = true,
  rows = 3,
  otherOption,
  exclusiveOption,
  logChanges = false,
}: ControlledInputProps) {
  const [inputs, setInputs] = useAtom(surveyInputAtom);
  const { username } = useAtomValue(studyParamsAtom);
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
    setInputs((prev) => {
      const next = { ...prev, [questionId]: newValue };
      // Drop the "please specify" text once Other is no longer selected,
      // so the logged answers don't contain stale text
      const otherSelected = Array.isArray(newValue)
        ? newValue.includes(otherOption)
        : newValue === otherOption;
      if (otherOption && !otherSelected) {
        delete next[otherKey];
      }
      return next;
    });
  };

  if (type === 'text') {
    // Mirrors the task page's documentUpdate logging, so the writing process
    // (e.g., large pastes) can be reconstructed for open-ended tasks
    const handleTextChange = (newValue: string) => {
      handleChange(newValue);
      if (logChanges) {
        log({
          username,
          event: 'surveyInputUpdate',
          extra_data: { questionId, value: newValue, length: newValue.length },
        });
      }
    };

    const baseClassName = "w-full p-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500";

    if (multiline) {
      return (
        <textarea
          value={String(value)}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          rows={rows}
          className={baseClassName}
        />
      );
    }

    return (
      <input
        type="text"
        value={String(value)}
        onChange={(e) => handleTextChange(e.target.value)}
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
          <Fragment key={option}>
            <label className="flex items-center gap-2">
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
            {option === otherOption && value === otherOption && otherTextBox}
          </Fragment>
        ))}
      </fieldset>
    );
  }

  if (type === 'checkbox') {
    const checked = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-2">
        {options.map((option) => (
          <Fragment key={option}>
            <label className="flex items-center gap-2">
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
            {option === otherOption && checked.includes(option) && otherTextBox}
          </Fragment>
        ))}
      </fieldset>
    );
  }

  return null;
}
