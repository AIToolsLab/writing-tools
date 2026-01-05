'use client';

import { ReactNode } from 'react';
import { Question } from './types';
import SurveyQuestion from './SurveyQuestion';

interface SurveyProps {
  title?: string;
  description?: string;
  questions: Question[];
  onSubmit: () => Promise<void>;
  submitButtonText?: string;
  children?: ReactNode;
}

export default function Survey({
  title,
  description,
  questions,
  onSubmit,
  submitButtonText = 'Submit',
  children,
}: SurveyProps) {
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {title && <h2 className="text-2xl font-bold mb-4">{title}</h2>}
      {description && <p className="text-gray-700 mb-6">{description}</p>}

      {children && <div className="mb-6">{children}</div>}

      <div className="space-y-6">
        {questions.map((question) => (
          <SurveyQuestion key={question.id} question={question} />
        ))}
      </div>

      <button
        type="submit"
        className="mt-8 px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition"
      >
        {submitButtonText}
      </button>
    </form>
  );
}
