'use client';

import { useSearchParams } from 'next/navigation';
import { useAtom } from 'jotai';
import { logThenRedirect } from '@/lib/logging';
import { getNextPage, getScenario, letterToCondition } from '@/lib/studyConfig';
import { surveyInputAtom } from '@/contexts/StudyContext';
import Survey from '@/components/survey/Survey';
import { introSurveySections } from '@/components/survey/surveyData';

export default function IntroSurvey() {
  const searchParams = useSearchParams();
  const [surveyInputs] = useAtom(surveyInputAtom);
  const username = searchParams.get('username') || '';
  const conditionCode = (searchParams.get('condition') ||
    'n') as keyof typeof letterToCondition;
  const condition = letterToCondition[conditionCode];
  // getScenario resolves a missing or unknown ID to the default scenario
  const scenarioId = getScenario(searchParams.get('scenario') || undefined).id;

  const handleSubmit = async () => {
    // Log survey completion
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', getNextPage('intro-survey')!);
    const nextUrl = `/study?${params.toString()}`;

    await logThenRedirect(
      {
        username,
        event: 'surveyComplete:intro-survey',
        extra_data: { scenarioId, condition, answers: surveyInputs },
      },
      nextUrl,
    );
  };

  return (
    <div className='max-w-2xl mx-auto p-8'>
      <Survey
        title='Background Information'
        sections={introSurveySections}
        onSubmit={handleSubmit}
        submitButtonText='Continue to Task'
      />
    </div>
  );
}
