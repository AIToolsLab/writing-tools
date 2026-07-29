'use client'

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getNextPage } from '@/lib/studyConfig';

export default function TaskCompletionPage() {
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleStartPostTaskSurvey = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const params = new URLSearchParams(searchParams.toString())
    params.set('page', getNextPage('debrief')!);
    window.location.href = `/study?${params.toString()}`;
  }

  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="space-y-6 mb-8">
        <section>
          <h2 className="text-2xl font-semibold mb-3 text-foreground">Congratulations!</h2>
          <p className="text-foreground mb-4">
            You have finished the writing task. To complete
            the study, please continue to the follow-up
            questionnaire about your experience with the task.
          </p>
        </section>
      </div>
      <button
        type='button'
        onClick={handleStartPostTaskSurvey}
        disabled={isSubmitting}
        className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:bg-green-400 disabled:cursor-not-allowed"
      >
        {isSubmitting ? 'Loading...' : 'Continue to Post-Task Survey →'}
      </button>
    </div>
  )
}