'use client';

import { type ReactNode, useState } from 'react';
import { Question, SurveySection } from './types';
import SurveyQuestion from './SurveyQuestion';

interface SurveyProps {
  title?: string;
  description?: string;
  questions?: Question[];
  // When given, each section is shown as its own step with Back/Next buttons
  sections?: SurveySection[];
  onSubmit: () => Promise<void>;
  submitButtonText?: string;
  children?: ReactNode;
}

export default function Survey({
  title,
  description,
  questions = [],
  sections,
  onSubmit,
  submitButtonText = 'Submit',
  children,
}: SurveyProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sectionIndex, setSectionIndex] = useState(0);

  const currentSection = sections?.[sectionIndex];
  const isLastSection = !sections || sectionIndex === sections.length - 1;

  const goToSection = (index: number) => {
    setSectionIndex(index);
    window.scrollTo({ top: 0 });
  };

  // Browser validation only checks the questions on screen, so each
  // section must be complete before Next advances.
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isLastSection) {
      goToSection(sectionIndex + 1);
      return;
    }
    if (isSubmitting) return;
    setIsSubmitting(true);
    await onSubmit();
  };

  const visibleQuestions = currentSection ? currentSection.questions : questions;

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl">
      {title && <h2 className="text-2xl font-bold mb-4">{title}</h2>}
      {description && <p className="text-gray-700 mb-6">{description}</p>}

      {children && <div className="mb-6">{children}</div>}

      {currentSection?.description && (
        <p className="text-gray-700 mb-6">{currentSection.description}</p>
      )}

      <div className="space-y-6">
        {visibleQuestions.map((question) => (
          <SurveyQuestion key={question.id} question={question} />
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        {sections && sectionIndex > 0 && (
          <button
            type="button"
            onClick={() => goToSection(sectionIndex - 1)}
            disabled={isSubmitting}
            className="px-6 py-2 border border-gray-300 rounded font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className="px-6 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700 transition disabled:bg-blue-400 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Submitting...' : isLastSection ? submitButtonText : 'Next'}
        </button>
      </div>
    </form>
  );
}
