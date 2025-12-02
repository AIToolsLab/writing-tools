'use client';

import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { log, logThenRedirect } from '@/lib/logging';
import { STUDY_PAGES } from '@/lib/studyConfig';
import { surveyInputAtom } from '@/contexts/StudyContext';
import Survey from '@/components/survey/Survey';
import { introSurveyQuestions } from '@/components/survey/surveyData';

export default function IntroSurvey() {
  const searchParams = useSearchParams();
  const [surveyInputs] = useAtom(surveyInputAtom);
  const username = searchParams.get('username') || '';

  const handleSubmit = async () => {
    // Log survey completion
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', STUDY_PAGES[3]); // Next page is 'start-task'
    const nextUrl = `/study?${params.toString()}`;

    await logThenRedirect(
      {
        username,
        event: 'surveyComplete:intro-survey',
        extra_data: surveyInputs,
      },
      nextUrl
    );
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <Survey
        title="Background Information"
        description="Please tell us a bit about yourself and your experience with AI tools."
        questions={introSurveyQuestions}
        onSubmit={handleSubmit}
        submitButtonText="Continue to Task"
      />
    </div>
  );
}
