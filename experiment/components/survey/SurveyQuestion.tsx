'use client';

import { Question } from './types';
import ControlledInput from './ControlledInput';

interface SurveyQuestionProps {
  question: Question;
}

export default function SurveyQuestion({ question }: SurveyQuestionProps) {
  return (
    <div className="mb-6">
      <label className="block text-base font-medium mb-3">
        {question.text}
        {question.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <ControlledInput
        questionId={question.id}
        type={question.type}
        placeholder={question.placeholder}
        options={question.options}
        required={question.required}
        multiline={question.multiline}
      />
    </div>
  );
}
